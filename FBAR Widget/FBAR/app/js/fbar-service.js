/*
 * FBAR record operations on top of ZohoApi + FbarMapper.
 *
 *   start()            connect, verify the live Creator metadata, resolve the FBAR1 report
 *   loadPeople()       taxpayer / spouse names from Personal_Info
 *   findRecords()      FBAR1 records for a taxpayer + spouse + tax year
 *   loadRecord(id)     one FBAR1 record with its four subforms
 *   save(model, ...)   create or update, then read the record back and verify it
 */
(function (global) {
  "use strict";
  const CFG = global.FBAR_CONFIG;
  const S = global.FBAR_SCHEMA;
  const api = global.ZohoApi;
  const mapper = global.FbarMapper;

  class FbarError extends Error {
    constructor(message, details = []) { super(message); this.name = "FbarError"; this.details = details; }
  }

  const state = { fbarReport: null };

  /* ---------------- start-up checks ---------------- */

  const SUBFORM_NAMES = () => mapper.PERSONS.flatMap((p) => mapper.SECTIONS.map((s) => CFG.subforms[p][s]));

  /* The SDK documents fields as a flat list; grid fields may carry their columns under one of these keys. */
  function nestedColumns(field) {
    const list = field.subform_fields || field.fields || field.subFormFields || null;
    return Array.isArray(list) ? list : null;
  }

  async function verifyFbarForm(problems, notes) {
    const fields = await api.getFields(CFG.forms.fbar);
    const byName = new Map(fields.map((f) => [f.link_name, f]));
    Object.values(CFG.parentFields).concat(SUBFORM_NAMES()).forEach((name) => {
      if (!byName.has(name)) problems.push(`Field "${name}" is missing in form ${CFG.forms.fbar}.`);
    });

    // Subform columns are checked against the metadata, and the currency picklist of each subform is
    // taken from it. Without that list the widget stops: it never offers values Zoho may not have.
    const currencyField = CFG.columns.find((c) => c.key === "currency").zoho;
    mapper.PERSONS.forEach((person) => mapper.SECTIONS.forEach((section) => {
      const name = CFG.subforms[person][section];
      const field = byName.get(name);
      if (!field) return;
      const columns = nestedColumns(field);
      if (!columns) { problems.push(`Zoho did not return the columns of subform ${name}, so the "${currencyField}" choices can't be read.`); return; }
      const have = new Set(columns.map((c) => c.link_name));
      CFG.columns.filter((c) => !c.jointOnly || section === "joint").forEach((c) => {
        if (!have.has(c.zoho)) problems.push(`Column "${c.zoho}" is missing in subform ${name}.`);
      });
      const currency = columns.find((c) => c.link_name === currencyField);
      const choices = currency && Array.isArray(currency.choices)
        ? currency.choices.map((ch) => (ch && typeof ch === "object" ? ch.value : ch)).filter((v) => typeof v === "string" && v.trim())
        : [];
      if (currency && !choices.length) problems.push(`Column "${currencyField}" of subform ${name} has no choices in Zoho Creator.`);
      S.setCurrencyChoices(person, section, choices);
    }));
    // Different lists in the four subforms are allowed, but usually a typo in Creator: say so.
    const lists = mapper.PERSONS.flatMap((p) => mapper.SECTIONS.map((s) => [CFG.subforms[p][s], S.currencyChoicesFor(p, s).join(", ")]));
    if (new Set(lists.map(([, l]) => l)).size > 1) {
      notes.push(`The "${currencyField}" choices differ between subforms: ${lists.map(([n, l]) => `${n}: ${l || "none"}`).join("; ")}.`);
    }
  }

  async function verifyPersonalInfo(problems) {
    const fields = await api.getFields(CFG.forms.personalInfo);
    const names = new Set(fields.map((f) => f.link_name));
    const missing = Object.values(CFG.personalInfoFields).flat().filter((name) => !names.has(name));
    missing.forEach((name) => problems.push(`Field "${name}" is missing in form ${CFG.forms.personalInfo}.`));
    if (missing.length) {
      // Show what the form really has, so the right link names can be put in FBAR_CONFIG.personalInfoFields.
      const nameFields = fields.filter((f) => /name/i.test(f.link_name) || /name/i.test(f.display_name || ""))
        .map((f) => `${f.link_name} ("${f.display_name}")`);
      problems.push(`Name fields that ${CFG.forms.personalInfo} does have: ${nameFields.length ? nameFields.join(", ") : "none found"}.`);
    }
  }

  /* The FBAR1 report: the configured name, or the single report whose name refers to FBAR. */
  function resolveFbarReport(reports, problems) {
    const linkNames = reports.map((r) => r.link_name);
    if (CFG.reports.fbar) {
      if (!linkNames.includes(CFG.reports.fbar)) problems.push(`Report "${CFG.reports.fbar}" (FBAR_CONFIG.reports.fbar) does not exist.`);
      return CFG.reports.fbar;
    }
    const candidates = reports.filter((r) => /fbar/i.test(r.link_name) || /fbar/i.test(r.display_name || ""));
    if (candidates.length === 1) return candidates[0].link_name;
    const list = candidates.length ? candidates.map((r) => r.link_name).join(", ") : "none";
    problems.push(`Could not tell which report shows the ${CFG.forms.fbar} form (reports mentioning FBAR: ${list}). `
      + "Set FBAR_CONFIG.reports.fbar in js/fbar-config.js.");
    return null;
  }

  async function start() {
    await api.init();
    const problems = [];
    const notes = [];
    const [forms, reports] = await Promise.all([api.getForms(), api.getReports()]);
    const formNames = forms.map((f) => f.link_name);
    Object.values(CFG.forms).forEach((name) => {
      if (!formNames.includes(name)) problems.push(`Form "${name}" does not exist in app "${api.appName}".`);
    });
    if (!reports.some((r) => r.link_name === CFG.reports.personalInfo)) {
      problems.push(`Report "${CFG.reports.personalInfo}" does not exist in app "${api.appName}".`);
    }
    state.fbarReport = resolveFbarReport(reports, problems);
    if (formNames.includes(CFG.forms.fbar)) await verifyFbarForm(problems, notes);
    if (formNames.includes(CFG.forms.personalInfo)) await verifyPersonalInfo(problems);

    if (problems.length) throw new FbarError("The FBAR form in Zoho Creator does not match what this widget expects.", problems);
    return { appName: api.appName, user: api.initParams.loginUser, fbarReport: state.fbarReport, notes };
  }

  /* ---------------- people (Personal_Info) ---------------- */

  /* Text, or a Name field object ({ first_name, last_name, zc_display_value }). */
  function nameText(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (value.zc_display_value) return String(value.zc_display_value).trim();
    return [value.prefix, value.first_name, value.last_name, value.suffix].filter(Boolean).join(" ").trim();
  }

  /* Full name from its parts, e.g. Taxpayer_First_Name + Taxpayer_Middle_Name + Taxpayer_Last_Name. */
  const fullName = (record, parts) => parts.map((field) => nameText(record[field])).filter(Boolean).join(" ");

  async function loadPeople() {
    const records = await api.getAllRecords(CFG.reports.personalInfo);
    const F = CFG.personalInfoFields;
    return records.map((r) => ({
      id: String(r.ID),                       // this ID is what the FBAR1 lookups store
      taxpayerName: fullName(r, F.taxpayerName),
      spouseName: fullName(r, F.spouseName),
    }));
  }

  /* ---------------- FBAR records ---------------- */

  const quote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const asLookupId = (id) => (/^\d+$/.test(String(id)) ? String(id) : quote(id));

  /** All FBAR1 records for this taxpayer + tax year whose spouse also matches (both empty counts as a match). */
  async function findRecords(taxpayerId, spouseId, taxYear) {
    const P = CFG.parentFields;
    const criteria = `(${P.taxpayer} == ${asLookupId(taxpayerId)} && ${P.taxYear} == ${quote(String(taxYear).trim())})`;
    const records = await api.getAllRecords(state.fbarReport, criteria);
    return records.filter((r) => mapper.lookupId(r[P.spouse]) === String(spouseId || ""));
  }

  async function loadRecord(recordId) {
    const record = await api.getRecordById(state.fbarReport, recordId);
    try {
      return mapper.fromZohoRecord(record);
    } catch (err) {
      if (err instanceof mapper.MappingError) {
        throw new FbarError("This FBAR record can't be edited safely in the widget.", [err.message,
          "Nothing was changed. Edit the record in Zoho Creator, or contact the developer."]);
      }
      throw err;
    }
  }

  /* ---------------- save ---------------- */

  /* Compare the record Zoho now holds with what was sent; any difference is reported, not hidden. */
  function verifySaved(sentModel, savedModel, changedSubforms) {
    const problems = [];
    mapper.PERSONS.forEach((person) => mapper.SECTIONS.forEach((section) => {
      const name = CFG.subforms[person][section];
      const saved = savedModel[person][section].map(mapper.fingerprint).sort();
      const key = `${person}.${section}`;
      if (changedSubforms && !changedSubforms.has(key)) {
        const before = (sentModel._loaded && sentModel._loaded[key]) || null;
        if (before && before.join() !== saved.join()) problems.push(`${name} changed although it was not edited.`);
        return;
      }
      const sent = mapper.rowsToSend(sentModel, person, section, sentModel._isUsed).map(mapper.fingerprint).sort();
      if (sent.length !== saved.length) problems.push(`${name}: sent ${sent.length} account(s), Zoho now has ${saved.length}.`);
      else if (sent.join() !== saved.join()) problems.push(`${name}: the saved values differ from what was sent.`);
    }));
    return problems;
  }

  /** Fingerprints of what was loaded, so an update can prove untouched subforms stayed the same. */
  function snapshot(model) {
    const snap = {};
    mapper.PERSONS.forEach((p) => mapper.SECTIONS.forEach((s) => {
      snap[`${p}.${s}`] = model[p][s].filter((r) => r._zohoId).map(mapper.fingerprint).sort();
    }));
    return snap;
  }

  /**
   * Create or update. Update sends only the edited subforms; Zoho replaces each sent subform with the rows
   * sent (its row IDs change), and leaves the others as they were. Afterwards the record is read back from
   * Zoho and compared with what was sent; the returned model is the one Zoho now holds.
   */
  async function save(model, { changedSubforms, isUsed, loadedSnapshot }) {
    let recordId = model.recordId;
    if (!recordId) {
      // Someone may have created the record since it was loaded: never add a duplicate.
      const existing = await findRecords(model.taxpayerId, model.spouseId, model.taxYear);
      if (existing.length) {
        throw new FbarError("An FBAR record for this taxpayer, spouse and tax year already exists in Zoho.",
          ["Reload it before saving so nothing is duplicated or overwritten."]);
      }
      recordId = await api.addRecord(CFG.forms.fbar, mapper.toZohoPayload(model, { isUsed }));
      if (!recordId) throw new FbarError("Zoho did not return the new record's ID — the save could not be confirmed.");
    } else {
      await api.updateRecordById(state.fbarReport, recordId, mapper.toZohoPayload(model, { changedSubforms, isUsed }));
    }

    const saved = await loadRecord(recordId);
    const problems = verifySaved(Object.assign({}, model, { _isUsed: isUsed, _loaded: loadedSnapshot }),
      saved, model.recordId ? changedSubforms : null);
    return { model: saved, recordId, created: !model.recordId, problems };
  }

  global.FbarService = { FbarError, start, loadPeople, findRecords, loadRecord, save, snapshot, get fbarReport() { return state.fbarReport; } };
})(window);
