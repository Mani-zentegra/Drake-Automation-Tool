/*
 * Client tax organizer — one widget, six steps:
 *   Welcome → Personal Information → Dependents → Additional Information → Checklist → Taxes → FBAR → Done
 *
 * Every step keeps what was typed while the client moves back and forth (state.models), "Next" saves the
 * step first, and the step bar shows which steps are saved, changed-but-not-saved or still to do.
 * Steps 1–5 use PortalService; step 6 is the existing FBAR app, opened for the same client via window.FbarApp.
 */
(function () {
  "use strict";
  const { MODULES } = window.PORTAL_SCHEMA;
  const service = window.PortalService;
  const html = window.PortalRender;
  const V = window.PortalValues;
  const dialog = window.FbarDialog;
  const esc = html.esc;
  const $ = (s, r = document) => r.querySelector(s);

  const state = {
    started: false,
    startInfo: null,
    fatal: null,
    clients: [],
    client: null,            // { id, name, spouse }
    view: "welcome",         // "welcome" | module id | "done"
    models: {},              // module id -> model (kept while navigating)
    saved: {},               // module id -> true when Zoho holds a record for the client
    errors: {},              // module id -> { key: message }
    busy: false,
  };

  const modById = (id) => MODULES.find((m) => m.id === id);
  const stepIndex = (id) => MODULES.findIndex((m) => m.id === id);

  /* ---------------- status ---------------- */
  function isDirty(mod) {
    if (mod.custom === "fbar") return !!(window.FbarApp && window.FbarApp.isDirty());
    const model = state.models[mod.id];
    if (!model) return false;
    return service.changes(mod, model).any;
  }

  function statusOf(mod) {
    if (mod.custom !== "fbar" && service.metaOf(mod) && service.metaOf(mod).blocked) return "blocked";
    if (isDirty(mod)) return "unsaved";
    if (mod.custom === "fbar") {
      const add = state.models.additional;
      if (add && add.values.Do_you_have_a_foreign_bank_account === "No") return "notneeded";
      return state.client && window.FbarApp && window.FbarApp.hasRecord(state.client.id) ? "done" : "todo";
    }
    return state.saved[mod.id] ? "done" : "todo";
  }

  const STATUS_TEXT = { done: "Saved", unsaved: "Not saved yet", todo: "To do", blocked: "Unavailable", notneeded: "Not needed" };

  /* ---------------- shell render (FBAR layout: form-head, underline tabs, form-card, centred actions) ---------------- */
  const STATUS_TONE = { done: "ok", notneeded: "ok", unsaved: "warn", blocked: "bad", todo: "" };

  function renderHead() {
    const done = MODULES.filter((m) => ["done", "notneeded"].includes(statusOf(m))).length;
    const who = state.client
      ? `${esc(state.client.name || "New client")}${state.client.spouse ? ` &amp; ${esc(state.client.spouse)}` : ""} · `
      : "";
    $("#ptSub").innerHTML = `${who}${done} of ${MODULES.length} sections complete`;
    const mod = modById(state.view);
    const s = $("#ptSaveState");
    if (mod && mod.custom !== "fbar") {
      const st = statusOf(mod);
      s.textContent = st === "unsaved" ? "Unsaved changes" : (st === "done" ? "Saved" : "");
      s.classList.toggle("dirty", st === "unsaved");
    } else { s.textContent = ""; s.classList.remove("dirty"); }
  }

  function renderSteps() {
    const canOpen = (mod) => mod.id === "personal" || !!state.client;
    $("#ptSteps").innerHTML = MODULES.map((mod, i) => {
      const st = statusOf(mod);
      const cur = state.view === mod.id;
      const mark = st === "done" || st === "notneeded" ? "✓" : i + 1;
      return `<button type="button" role="tab" class="ptab pt-tab st-${st}" data-go="${mod.id}" aria-selected="${cur}" ${canOpen(mod) ? "" : "disabled"}
        title="${esc(mod.title)} — ${STATUS_TEXT[st]}"><span class="pt-no">${mark}</span>${esc(mod.short)}<span class="cnt ${STATUS_TONE[st]}">${STATUS_TEXT[st]}</span></button>`;
    }).join("");
    renderHead();
  }

  function setBusy(text) {
    state.busy = !!text;
    $("#ptBusy").hidden = !text;
    $("#ptBusyText").textContent = text || "";
    document.querySelectorAll("[data-nav]").forEach((b) => { b.disabled = !!text; });
  }

  function toast(text, ms = 3500) {
    const t = $("#ptToast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  function showError(title, err, extra) {
    if (window.console) console.error(title, err && err.kind ? { kind: err.kind, code: err.code } : err);   // no client data logged
    const message = ((err && err.message) || "Unexpected error.").trim();
    return dialog.alert({ title, message: extra ? `${message} ${extra}` : message, details: (err && err.details) || [], tone: "error" });
  }

  function showCard(isFbar) {
    $("#ptCard").hidden = isFbar;
    $("#fbarHost").hidden = !isFbar;
  }

  /* ---------------- welcome ---------------- */
  function renderWelcome() {
    showCard(false);
    const info = state.startInfo;
    const login = info && info.user ? String(info.user).toLowerCase() : "";
    let body;
    if (state.fatal) {
      body = `<div class="pt-alert bad"><b>The organizer can't start.</b> The Personal Information form in Zoho Creator doesn't match this widget:<ul>${
        state.fatal.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
    } else if (!state.started) {
      body = `<div class="gate">Connecting to Zoho Creator…</div>`;
    } else {
      const mine = state.clients.filter((c) => login && c.emails.includes(login));
      const list = state.clients.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      const pick = mine.length === 1 ? mine[0] : (list.length === 1 ? list[0] : null);
      const rows = (pick && !state.showList ? [pick] : list).map((c, i) => `<tr>
          <td class="c-no">${i + 1}</td><td>${esc(c.name || "(no name yet)")}</td><td>${esc(c.spouse || "—")}</td>
          <td class="pt-act"><button type="button" class="btn btn-primary pt-sm" data-client="${esc(c.id)}">${pick && c.id === pick.id ? "Continue" : "Open"}</button></td></tr>`).join("");
      body = list.length
        ? `<div class="sf-title"><h2>${pick && !state.showList ? "Continue your organizer" : "Choose a return"}</h2>
             <span class="meta">${list.length} saved return${list.length === 1 ? "" : "s"}</span></div>
           <div class="sf-wrap"><div class="sf-scroll"><table class="sf-table pt-table pt-list">
             <thead><tr class="cols"><th class="c-no">#</th><th>Taxpayer</th><th>Spouse</th><th class="pt-act"></th></tr></thead>
             <tbody>${rows}</tbody></table></div></div>
           <div class="sf-foot"><button type="button" class="add-new" data-new><span class="plus">+</span> Start a new organizer</button>
             ${pick && list.length > 1 && !state.showList ? '<button type="button" class="add-new" data-show-list>Choose a different return</button>' : ""}</div>`
        : `<div class="gate">No saved organizer yet. Start with your personal information.
             <div class="pt-gate-act"><button type="button" class="btn btn-primary" data-new>Get started</button></div></div>`;
    }
    $("#ptMain").innerHTML = `<div class="record-status">Answer each section in order. Your answers are saved to your account as you go, and you can come back and change them at any time.</div>
      <section class="sf">${body}</section>
      <div class="sf-title pt-mt"><h2>Sections</h2></div>
      <table class="pt-overview"><tbody>${MODULES.map((m, i) => `<tr><td class="c-no">${i + 1}</td><th>${esc(m.title)}</th><td>${esc(m.intro || "")}</td></tr>`).join("")}</tbody></table>`;
    $("#ptFoot").hidden = true;
  }

  /* ---------------- step view ---------------- */
  function renderModule(mod) {
    const i = stepIndex(mod.id);
    const isFbar = mod.custom === "fbar";
    showCard(isFbar);
    const intro = `<div class="record-status"><b>Step ${i + 1} of ${MODULES.length} · ${esc(mod.title)}.</b> ${esc(mod.intro || "")}</div>`;
    if (isFbar) {
      const add = state.models.additional;
      $("#fbarStep").innerHTML = `<b>Step ${i + 1} of ${MODULES.length} · ${esc(mod.title)}.</b> ${esc(mod.intro || "")}`;
      $("#fbarNote").hidden = !(add && add.values.Do_you_have_a_foreign_bank_account === "No");
    } else {
      const m = service.metaOf(mod);
      const model = state.models[mod.id];
      if (m && m.blocked) {
        $("#ptMain").innerHTML = `${intro}<div class="gate"><b>This section isn't available yet.</b> ${esc(m.blocked)}<br>Please continue with the other sections, and let your preparer know.${
          (m.details || []).length ? `<details class="pt-tech"><summary>Technical details for your preparer</summary><ul>${m.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></details>` : ""}</div>`;
      } else if (!model) {
        $("#ptMain").innerHTML = `${intro}<div class="gate">Loading…</div>`;
      } else {
        $("#ptMain").innerHTML = `${intro}<form class="pt-form" id="ptForm" novalidate>${html.moduleHTML(mod, model, state.errors[mod.id] || {})}</form>`;
      }
    }
    const last = i === MODULES.length - 1;
    $("#ptFoot").hidden = false;
    $("#ptPrev").textContent = i === 0 ? "Back" : "Previous";
    $("#ptNext").textContent = last ? "Finish" : (isFbar || (service.metaOf(mod) || {}).blocked ? "Next" : "Save & Next");
    // FBAR's own Save / Reset buttons are driven from this shared action bar, so every step has the same controls.
    $("#ptSave").hidden = !isFbar && !!(service.metaOf(mod) && service.metaOf(mod).blocked);
    $("#ptSave").textContent = isFbar ? "Save FBAR" : "Save";
    $("#ptReset").hidden = !isFbar;
    syncFbarButtons();
  }

  function syncFbarButtons() {
    if (!modById(state.view) || modById(state.view).custom !== "fbar") { $("#ptSave").disabled = false; return; }
    $("#ptSave").disabled = $("#saveBtn").disabled;
    $("#ptReset").disabled = $("#resetBtn").disabled;
  }

  /** Fade the card in when the client moves to another step (not on every re-render while typing). */
  function enter() {
    ["#ptCard", "#fbarHost"].forEach((s) => { const el = $(s); el.classList.remove("pt-enter"); void el.offsetWidth; el.classList.add("pt-enter"); });
  }

  function renderDone() {
    showCard(false);
    $("#ptFoot").hidden = true;
    const rows = MODULES.map((m, i) => {
      const st = statusOf(m);
      return `<tr><td class="c-no">${i + 1}</td><td>${esc(m.title)}</td><td><span class="cnt ${STATUS_TONE[st]}">${STATUS_TEXT[st]}</span></td>
        <td class="pt-act">${["done", "notneeded"].includes(st) ? "" : `<button type="button" class="btn pt-sm" data-go="${m.id}">Open</button>`}</td></tr>`;
    }).join("");
    const all = MODULES.every((m) => ["done", "notneeded", "blocked"].includes(statusOf(m)));
    $("#ptMain").innerHTML = `<div class="note">${all
      ? "All done — thank you. Your information has been saved; your preparer will review it and contact you if anything else is needed."
      : "Some sections still need your attention. Open them below — everything you already saved is kept."}</div>
      <div class="sf-title"><h2>Summary</h2></div>
      <div class="sf-wrap"><div class="sf-scroll"><table class="sf-table pt-table pt-list">
        <thead><tr class="cols"><th class="c-no">#</th><th>Section</th><th>Status</th><th class="pt-act"></th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
      <div class="sf-foot"><button type="button" class="add-new" data-go="${MODULES[0].id}">Review my answers</button>
        <button type="button" class="add-new" data-go="welcome">Back to the start</button></div>`;
  }

  function render() {
    renderSteps();
    if (state.view === "welcome") renderWelcome();
    else if (state.view === "done") renderDone();
    else renderModule(modById(state.view));
  }

  /* ---------------- navigation ---------------- */
  async function open(viewId) {
    if (state.busy) return;
    const leaving = modById(state.view);
    if (leaving && leaving.custom === "fbar" && isDirty(leaving)) {
      const ok = await dialog.confirm({ title: "Your FBAR changes are not saved", message: "Leave this step anyway? Use Save in the FBAR form first to keep them.",
        confirmText: "Leave without saving", danger: true });
      if (!ok) return;
    }
    state.view = viewId;
    render();
    enter();
    const mod = modById(viewId);
    if (!mod) { window.scrollTo(0, 0); return; }
    window.scrollTo(0, 0);
    if (mod.custom === "fbar") {
      setBusy("Opening FBAR…");
      try {
        const ok = await window.FbarApp.showClient(state.client.id);
        if (!ok) toast("FBAR couldn't open this client yet — save Personal Information first.", 5000);
      } catch (err) { showError("Can't open FBAR", err); }
      finally { setBusy(""); renderSteps(); }
      return;
    }
    if (!state.models[mod.id] && !(service.metaOf(mod) && service.metaOf(mod).blocked)) await loadStep(mod);
  }

  async function loadStep(mod, chosenId) {
    setBusy("Loading your information…");
    try {
      const res = await service.loadModule(mod, state.client ? state.client.id : null, chosenId);
      if (res.duplicates.length) {
        setBusy("");
        const id = await dialog.choose({ title: "More than one record found",
          message: `There are ${res.duplicates.length} saved "${mod.title}" records for this return. Choose the one to open; your preparer can remove the extra one.`,
          options: res.duplicates.map((rid) => ({ value: rid, label: `Record ${rid}` })) });
        if (id) await loadStep(mod, id);
        return;
      }
      state.models[mod.id] = res.model;
      state.saved[mod.id] = !!res.model.recordId;
    } catch (err) {
      showError(`Couldn't load ${mod.title}`, err);
    } finally {
      setBusy("");
      if (state.view === mod.id) render();
    }
  }

  async function chooseClient(id) {
    const c = state.clients.find((x) => x.id === id);
    state.client = c ? { id: c.id, name: c.name, spouse: c.spouse } : { id, name: "", spouse: "" };
    state.models = {}; state.saved = { personal: true }; state.errors = {};
    setBusy("Checking your saved steps…");
    try {
      // Which steps already have a saved record (for the step bar); data itself is loaded when a step is opened.
      for (const mod of MODULES.filter((m) => !m.custom && m.id !== "personal" && !(service.metaOf(m) && service.metaOf(m).blocked))) {
        const res = await service.loadModule(mod, state.client.id);
        if (res.model) { state.models[mod.id] = res.model; state.saved[mod.id] = !!res.model.recordId; }
        else state.saved[mod.id] = true;     // duplicates: records exist; chosen when the step is opened
      }
    } catch (err) {
      showError("Couldn't read your saved steps", err);
    } finally { setBusy(""); }
    await open("personal");
    // Load this client's FBAR in the background too, so its step shows "Saved" before it is opened.
    if (window.FbarApp && !window.FbarApp.isDirty()) {
      const forId = state.client.id;
      window.FbarApp.showClient(forId).then(() => { if (state.client && state.client.id === forId) renderSteps(); }).catch(() => { /* shown when FBAR is opened */ });
    }
  }

  async function startNew() {
    state.client = null; state.models = {}; state.saved = {}; state.errors = {};
    await open("personal");
  }

  /* ---------------- editing ---------------- */
  function readInput(el) {
    if (el.type === "checkbox") {
      const scope = el.closest(".pt-choices");
      return [...scope.querySelectorAll('input[type="checkbox"]')].filter((x) => x.checked).map((x) => x.value);
    }
    return el.value;
  }

  function findRow(model, grid, uid) { return (model.grids[grid] || []).find((r) => r._uid === uid); }

  function onInput(e) {
    const el = e.target;
    const mod = modById(state.view);
    const model = mod && state.models[mod.id];
    if (!model || !el.closest("#ptForm")) return;
    if (el.type === "file") {
      const files = [...el.files];
      if (!files.length) return;
      if (el.dataset.f) (model.pending[el.dataset.f] = model.pending[el.dataset.f] || []).push(...files);
      else { const row = findRow(model, el.dataset.g, el.dataset.row); (row.pending[el.dataset.c] = row.pending[el.dataset.c] || []).push(...files); }
      afterEdit(mod, true);
      return;
    }
    if (el.dataset.f) model.values[el.dataset.f] = readInput(el);
    else if (el.dataset.g) { const row = findRow(model, el.dataset.g, el.dataset.row); if (row) row.values[el.dataset.c] = readInput(el); }
    else return;
    const errs = state.errors[mod.id];
    const key = el.dataset.f || `${el.dataset.g}|${el.dataset.row}|${el.dataset.c}`;
    if (errs && errs[key]) { delete errs[key]; const box = el.closest(".form-row, td"); if (box) { box.classList.remove("invalid"); const m = box.querySelector(".err"); if (m) m.remove(); } }
    // Choices can show / hide follow-up questions: redraw on change of a choice, not on every keystroke.
    afterEdit(mod, e.type === "change" && (el.tagName === "SELECT" || el.type === "radio" || el.type === "checkbox"));
  }

  function afterEdit(mod, rerender) {
    if (rerender) {
      // Keep the page and each list table where the client left them.
      const y = window.scrollY;
      const x = {};
      document.querySelectorAll("#ptForm [data-sec] .sf-scroll").forEach((s) => { x[s.closest("[data-sec]").dataset.sec] = s.scrollLeft; });
      render();
      document.querySelectorAll("#ptForm [data-sec] .sf-scroll").forEach((s) => { const k = s.closest("[data-sec]").dataset.sec; if (x[k]) s.scrollLeft = x[k]; });
      window.scrollTo(0, y);
    } else {
      renderSteps();
    }
  }

  async function onClick(e) {
    const t = e.target.closest("button, [data-go]");
    if (!t || state.busy) return;
    const mod = modById(state.view);
    const model = mod && state.models[mod.id];
    if (t.dataset.go) { e.preventDefault(); await open(t.dataset.go); return; }
    if (t.dataset.client) { await chooseClient(t.dataset.client); return; }
    if ("new" in t.dataset) { await startNew(); return; }
    if ("showList" in t.dataset) { state.showList = true; renderWelcome(); return; }
    if (!model) return;
    if (t.dataset.addrow) {
      const sec = mod.sections.find((s) => s.grid === t.dataset.addrow);
      model.grids[sec.grid].push(service.emptyRow(mod, sec));
      afterEdit(mod, true);
      return;
    }
    if (t.dataset.delrow) {
      const rows = model.grids[t.dataset.g];
      const row = rows.find((r) => r._uid === t.dataset.delrow);
      if (row && service.rowIsUsed(row)) {
        const ok = await dialog.confirm({ title: "Remove this entry?", message: "It is removed from Zoho Creator when you save this step.", confirmText: "Remove", danger: true });
        if (!ok) return;
      }
      model.grids[t.dataset.g] = rows.filter((r) => r._uid !== t.dataset.delrow);
      afterEdit(mod, true);
      return;
    }
    if (t.dataset.unpend !== undefined) {
      const list = t.dataset.f ? model.pending[t.dataset.f] : findRow(model, t.dataset.g, t.dataset.row).pending[t.dataset.c];
      list.splice(Number(t.dataset.unpend), 1);
      afterEdit(mod, true);
    }
  }

  /* ---------------- validation + save ---------------- */
  function validateStep(mod, model) {
    const errors = {};
    const m = service.metaOf(mod);
    const visible = (sec) => !sec.showIf || sec.showIf(model.values);
    mod.sections.forEach((sec) => {
      if (sec.grid) {
        const cols = m.grids.get(sec.grid) || new Map();
        model.grids[sec.grid].filter(service.rowIsUsed).forEach((row) => {
          if (service.lockedFileRows(mod, model, sec.grid).includes(row)) return;
          cols.forEach((field, col) => {
            const kind = V.kindOf(field);
            if (["lookup", "file", "unknown"].includes(kind)) return;
            const msg = V.validate(kind, row.values[col], { required: field.mandatory, maxChar: field.max_char });
            if (msg) errors[`${sec.grid}|${row._uid}|${col}`] = msg;
          });
        });
        return;
      }
      sec.fields.map((f) => (typeof f === "string" ? { name: f } : f)).forEach((f) => {
        const field = m.fields.get(f.name);
        const kind = V.kindOf(field);
        if (kind === "file") return;
        const shown = visible(sec) && (!f.showIf || f.showIf(model.values));
        const msg = V.validate(kind, model.values[f.name], { required: shown && field.mandatory, maxChar: field.max_char });
        if (msg) errors[f.name] = msg;
      });
    });
    (m.extra || []).forEach((field) => {
      const kind = V.kindOf(field);
      if (kind === "file") return;
      const msg = V.validate(kind, model.values[field.link_name], { required: field.mandatory, maxChar: field.max_char });
      if (msg) errors[field.link_name] = msg;
    });
    if (mod.id === "personal" && !state.client) {
      const name = ["Taxpayer_First_Name", "Taxpayer_Last_Name"].filter((n) => V.isBlank(model.values[n]));
      name.forEach((n) => { errors[n] = errors[n] || "Required"; });
    }
    return errors;
  }

  const clientHasSpouse = () => {
    const p = state.models.personal;
    return !!(p && ["Spouse_First_Name", "Spouse_Last_Name"].some((n) => !V.isBlank(p.values[n])));
  };

  /** Save the visible step. Resolves true when Zoho holds it (or nothing changed), false otherwise. */
  async function saveStep() {
    const mod = modById(state.view);
    if (!mod || mod.custom) return true;
    const m = service.metaOf(mod);
    if (m && m.blocked) return true;
    const model = state.models[mod.id];
    if (!model) return false;
    const errors = validateStep(mod, model);
    state.errors[mod.id] = errors;
    if (Object.keys(errors).length) {
      render();
      const first = document.querySelector("#ptForm .invalid");
      if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
      await dialog.alert({ title: "A few answers need attention", message: `Please check the ${Object.keys(errors).length} highlighted item(s).`, tone: "warning" });
      return false;
    }
    if (model.recordId && !service.changes(mod, model).any) return true;
    setBusy(model.recordId ? "Saving your changes…" : "Saving…");
    try {
      const res = await service.saveModule(mod, model, { clientHasSpouse: clientHasSpouse() });
      state.models[mod.id] = res.model;
      state.saved[mod.id] = true;
      if (mod.id === "personal") {
        const v = res.model.values;
        const join = (parts) => parts.map((p) => v[p]).filter((x) => !V.isBlank(x)).join(" ");
        state.client = { id: res.recordId, name: join(["Taxpayer_First_Name", "Taxpayer_Middle_Name", "Taxpayer_Last_Name"]),
          spouse: join(["Spouse_First_Name", "Spouse_Middle_Name", "Spouse_Last_Name"]) };
        const known = state.clients.find((c) => c.id === res.recordId);
        if (known) Object.assign(known, { name: state.client.name, spouse: state.client.spouse });
        else state.clients.push({ id: res.recordId, name: state.client.name, spouse: state.client.spouse, emails: [] });
      }
      setBusy("");
      render();
      if (res.problems.length) {
        await dialog.alert({ title: "Saved — please double-check", tone: "warning",
          message: "Zoho saved this step, but some values read back differently. The form now shows what Zoho holds.", details: res.problems });
      }
      if (res.uploadFailures.length) {
        await dialog.alert({ title: "Some files were not uploaded", tone: "warning",
          message: "Your answers were saved, but these documents did not upload. Add them again and save.", details: res.uploadFailures });
      }
      if (!res.problems.length && !res.uploadFailures.length && !res.nothing) toast(res.created ? "Saved." : "Changes saved.");
      return true;
    } catch (err) {
      setBusy("");
      showError("This step was not saved", err, "Your answers are still on screen — nothing was lost.");
      return false;
    }
  }

  async function next() {
    const mod = modById(state.view);
    if (!mod) return;
    if (!(await saveStep())) return;
    const i = stepIndex(mod.id);
    if (i === MODULES.length - 1) { await open("done"); return; }
    await open(MODULES[i + 1].id);
  }

  async function prev() {
    const mod = modById(state.view);
    const i = mod ? stepIndex(mod.id) : 0;
    await open(i <= 0 ? "welcome" : MODULES[i - 1].id);   // answers stay in memory; the step shows "Not saved yet"
  }

  /* ---------------- start ---------------- */
  async function startUp() {
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onInput);
    $("#ptNext").addEventListener("click", next);
    $("#ptPrev").addEventListener("click", prev);
    const onFbar = () => { const m = modById(state.view); return !!(m && m.custom === "fbar"); };
    $("#ptSave").addEventListener("click", () => (onFbar() ? $("#saveBtn").click() : saveStep()));
    $("#ptReset").addEventListener("click", () => { if (onFbar()) $("#resetBtn").click(); });
    document.addEventListener("fbar:status", renderSteps);
    // FBAR enables / disables its buttons while it loads and saves; the shared bar follows.
    new MutationObserver(syncFbarButtons).observe($("#fbarApp"), { subtree: true, attributes: true, attributeFilter: ["disabled"] });
    window.addEventListener("beforeunload", (e) => {
      if (MODULES.some((m) => isDirty(m))) { e.preventDefault(); e.returnValue = ""; }
    });
    render();
    setBusy("Connecting to Zoho Creator…");
    try {
      state.startInfo = await service.start();
      if (state.startInfo.fatal.length) { state.fatal = state.startInfo.fatal; return; }
      Object.entries(state.startInfo.problems).forEach(([id, list]) => console.warn(`[organizer] step "${id}" is unavailable:`, list));
      state.clients = await service.loadClients();
      state.started = true;
    } catch (err) {
      showError("Can't start the tax organizer", err);
    } finally {
      setBusy("");
      render();
    }
  }

  startUp();
})();
