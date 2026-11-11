/*
 * Thin wrapper around the Zoho Creator Widget SDK v2 (ZOHO.CREATOR.*).
 *
 * Authentication: the widget runs inside Creator, so every call uses the logged-in user's session.
 * There is no client secret, refresh token or access token in this code and none must be added.
 *
 * Every call: times out after FBAR_CONFIG.requestTimeoutMs, turns SDK errors into ZohoApiError with a
 * user-friendly message, and checks for Zoho's success code (3000). Only READ calls are retried
 * (once, on timeout / rate limit) so a save can never be sent twice.
 */
(function (global) {
  "use strict";
  const CFG = global.FBAR_CONFIG;

  const SUCCESS = 3000;
  const NO_RECORDS = 9280;

  class ZohoApiError extends Error {
    constructor(kind, message, details = {}) {
      super(message);
      this.name = "ZohoApiError";
      this.kind = kind;            // sdk-missing | not-in-creator | timeout | session | permission | rate-limit | no-records | zoho
      this.code = details.code;
      this.status = details.status;
      this.zohoMessage = details.zohoMessage;
    }
  }

  function withTimeout(promise, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ZohoApiError("timeout",
        `Zoho Creator did not answer in time (${label}). Check your connection and try again.`)), CFG.requestTimeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /* SDK rejections come as { status, responseText }, plain strings, or resolved bodies with code != 3000. */
  function toApiError(raw, label) {
    if (raw instanceof ZohoApiError) return raw;
    let status = raw && raw.status;
    let body = null;
    if (raw && typeof raw.responseText === "string") {
      try { body = JSON.parse(raw.responseText); } catch (e) { body = { message: raw.responseText }; }
    } else if (raw && typeof raw === "object" && "code" in raw) {
      body = raw;
    }
    const code = body && body.code;
    const zohoMessage = (body && (body.message || body.description)) || (typeof raw === "string" ? raw : "");
    const details = { code, status, zohoMessage };

    if (code === NO_RECORDS) return new ZohoApiError("no-records", "No records found.", details);
    if (status === 401 || code === 1030 || /oauth|token|session/i.test(zohoMessage)) {
      return new ZohoApiError("session", "Your Zoho session has expired. Reload the page and sign in again.", details);
    }
    if (status === 403 || /permission|not authori[sz]ed/i.test(zohoMessage)) {
      return new ZohoApiError("permission", `You don't have permission for this action in Zoho Creator (${label}).`, details);
    }
    if (status === 429 || /limit/i.test(zohoMessage)) {
      return new ZohoApiError("rate-limit", "Zoho Creator's API limit was reached. Wait a minute and try again.", details);
    }
    const why = zohoMessage ? `: ${zohoMessage}` : "";
    return new ZohoApiError("zoho", `Zoho Creator refused the request (${label})${why}`, details);
  }

  async function call(label, fn, { retryable = false } = {}) {
    const attempts = retryable ? 2 : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await withTimeout(Promise.resolve().then(fn), label);
        if (response && response.code !== undefined && response.code !== SUCCESS) throw response;
        return response;
      } catch (raw) {
        const err = toApiError(raw, label);
        const transient = err.kind === "timeout" || err.kind === "rate-limit";
        if (transient && attempt < attempts) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  const ZohoApi = {
    ZohoApiError,
    appName: null,
    initParams: null,

    /**
     * Must run before any other call. Resolves the app link name from the Creator session.
     *
     * The current SDK build (js.zohostatic.com/creator/widgets/version/2.0) connects by itself: it waits
     * for Creator's "Load" message from the parent page, and every API call waits for that handshake.
     * Builds that expose ZOHO.CREATOR.init() still get it called first. getInitParams() therefore only
     * answers once the widget is really connected to Creator.
     */
    async init() {
      if (global.FBAR_SDK_LOAD_FAILED) {
        throw new ZohoApiError("sdk-missing", "The Zoho Creator Widget SDK could not be downloaded from js.zohostatic.com. "
          + "Check the internet connection, proxy or firewall, then reload.");
      }
      const sdk = global.ZOHO && global.ZOHO.CREATOR;
      if (!sdk || !sdk.UTIL || !sdk.DATA) {
        throw new ZohoApiError("sdk-missing", "The Zoho Creator Widget SDK did not load. Reload the page.");
      }
      if (global.top === global) {
        // Opened directly (e.g. https://127.0.0.1:5000/app/widget.html): there is no Creator page to connect to.
        throw new ZohoApiError("not-in-creator", "This widget only works inside Zoho Creator. Open it from the Creator app, "
          + "or from Creator's widget preview while \"zet run\" is running — not directly in the browser.");
      }
      if (typeof sdk.init === "function") await call("connect to Zoho Creator", () => sdk.init());
      this.initParams = await call("connect to Zoho Creator", () => sdk.UTIL.getInitParams());
      this.appName = this.initParams.appLinkName;
      if (!this.appName) throw new ZohoApiError("zoho", "Zoho Creator did not return the application name.");
      return this.initParams;
    },

    getForms() {
      return call("list forms", () => ZOHO.CREATOR.META.getForms({ app_name: this.appName }), { retryable: true })
        .then((r) => r.forms || []);
    },

    getReports() {
      return call("list reports", () => ZOHO.CREATOR.META.getReports({ app_name: this.appName }), { retryable: true })
        .then((r) => r.reports || []);
    },

    getFields(formName) {
      return call(`read fields of ${formName}`, () => ZOHO.CREATOR.META.getFields({ app_name: this.appName, form_name: formName }),
        { retryable: true }).then((r) => r.fields || []);
    },

    getRecordById(reportName, id) {
      return call(`read record ${id}`, () => ZOHO.CREATOR.DATA.getRecordById({
        app_name: this.appName, report_name: reportName, id: String(id),
      }), { retryable: true }).then((r) => r.data);
    },

    /**
     * All records of a report (200 per page). "No records" becomes an empty list: Zoho Creator answers a
     * search with no match with HTTP 400 and code 9280 (the browser logs that 400 in the console; it is
     * not an error). Any other 400 is still reported.
     */
    async getAllRecords(reportName, criteria) {
      const all = [];
      for (let page = 1; ; page++) {
        const config = { app_name: this.appName, report_name: reportName, page, pageSize: CFG.pageSize };
        if (criteria) config.criteria = criteria;
        let rows;
        try {
          rows = (await call(`read ${reportName}`, () => ZOHO.CREATOR.DATA.getRecords(config), { retryable: true })).data || [];
        } catch (err) {
          if (err.kind === "no-records") break;
          throw err;
        }
        all.push(...rows);
        if (rows.length < CFG.pageSize) break;
      }
      return all;
    },

    addRecord(formName, data) {
      return call(`create ${formName} record`, () => ZOHO.CREATOR.DATA.addRecords({
        app_name: this.appName, form_name: formName, payload: { data },
      })).then((r) => r.data && r.data.ID);
    },

    updateRecordById(reportName, id, data) {
      return call(`update record ${id}`, () => ZOHO.CREATOR.DATA.updateRecordById({
        app_name: this.appName, report_name: reportName, id: String(id), payload: { data },
      })).then((r) => r.data && r.data.ID);
    },
  };

  global.ZohoApi = ZohoApi;
})(window);
