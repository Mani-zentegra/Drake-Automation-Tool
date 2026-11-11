/*
 * Data layer of the client tax organizer (all Zoho Creator traffic for steps 1–5; FBAR keeps its own service).
 *
 *   start()                       connect, read live metadata of every module, check the layout against it
 *   loadClients()                 Personal_Info records this user can see
 *   loadModule(mod, clientId)     the module's record for this client (or an empty model)
 *   saveModule(mod, model, ...)   create / update, read the record back and compare, then upload new files
 *
 * Facts this relies on (verified against the live app, see fbar-mapper.js and the SDK reference):
 *   - an update REPLACES a subform with the rows sent, and rows carrying their "ID" are rejected;
 *   - lookups store the Personal_Info record ID; search criteria compare lookups with the bare ID;
 *   - "no records" comes back as error code 9280 (ZohoApi.getAllRecords turns it into []).
 */
(function (global) {
  "use strict";
  const api = global.ZohoApi;
  const V = global.PortalValues;
  const { MODULES } = global.PORTAL_SCHEMA;

  class PortalError extends Error {
    constructor(message, details = []) { super(message); this.name = "PortalError"; this.details = details; }
  }

  /** meta[moduleId] = { fields: Map, grids: Map<grid, Map<col, field>>, blocked: string|null, extra: [field] } */
  const meta = {};
  let uid = 0;
  const nextUid = () => `r${++uid}`;

  const nestedColumns = (field) => {
    const list = field && (field.subform_fields || field.fields || field.subFormFields);
    return Array.isArray(list) ? list : null;
  };
  const fieldName = (f) => (typeof f === "string" ? f : f.name);

  /* ---------------- start-up ---------------- */
  async function checkModule(mod, formNames, reportNames) {
    const problems = [];
    if (!formNames.has(mod.form)) problems.push(`Form "${mod.form}" does not exist in Zoho Creator.`);
    if (!reportNames.has(mod.report)) problems.push(`Report "${mod.report}" does not exist in Zoho Creator.`);
    if (problems.length) return { problems };

    const fields = await api.getFields(mod.form);
    const byName = new Map(fields.map((f) => [f.link_name, f]));
    const grids = new Map();
    const placed = new Set(mod.internal || []);

    mod.sections.forEach((sec) => {
      if (sec.grid) {
        placed.add(sec.grid);
        const g = byName.get(sec.grid);
        if (!g) { problems.push(`Subform "${sec.grid}" is missing in form ${mod.form}.`); return; }
        const cols = nestedColumns(g);
        if (!cols) { problems.push(`Zoho did not return the columns of subform ${sec.grid} in form ${mod.form}.`); return; }
        grids.set(sec.grid, new Map(cols.map((c) => [c.link_name, c])));
        Object.keys(sec.columns || {}).forEach((c) => {
          if (!grids.get(sec.grid).has(c)) problems.push(`Column "${c}" is missing in subform ${sec.grid} of form ${mod.form}.`);
        });
      } else {
        sec.fields.forEach((f) => {
          placed.add(fieldName(f));
          if (!byName.has(fieldName(f))) problems.push(`Field "${fieldName(f)}" is missing in form ${mod.form}.`);
        });
      }
    });

    let blocked = null;
    let linkGrid = null;
    if (mod.clientLink) {
      placed.add(mod.clientLink);
      const link = byName.get(mod.clientLink);
      // The client lookup may sit on the form, or (Estimated_Tax) as a column of one of its subforms: then every row
      // carries the client and the record belongs to the client its rows point at.
      if (!link) {
        const host = mod.sections.find((s) => s.grid && grids.has(s.grid) && (grids.get(s.grid).get(mod.clientLink) || {}).is_lookup_field);
        if (host) linkGrid = host.grid;
      }
      if (!linkGrid && (!link || !link.is_lookup_field)) {
        blocked = "This step hasn't been set up for your account yet, so nothing can be saved here for now.";
        problems.push(`Form "${mod.form}" has no lookup field "${mod.clientLink}" to Personal_Info, so its records can't be linked to a client.`);
      }
    }
    // Fields Creator has that the layout does not place yet are still shown (in "Other details"), so none is left out.
    // Fields the layout places but whose Zoho type this widget doesn't know: shown read-only, and listed here so the
    // type code can be added to PortalValues.kindOf.
    const unknownTypes = [];
    placed.forEach((n) => { const f = byName.get(n); if (f && V.kindOf(f) === "unknown" && !(mod.internal || []).includes(n)) unknownTypes.push(`${n} (type ${f.type})`); });
    grids.forEach((cols, g) => cols.forEach((f, c) => { if (V.kindOf(f) === "unknown") unknownTypes.push(`${g}.${c} (type ${f.type})`); }));
    if (unknownTypes.length && global.console) console.warn(`[organizer] ${mod.form}: field types not recognised, shown read-only:`, unknownTypes.join(", "));
    const extra = fields.filter((f) => !placed.has(f.link_name) && !["unknown", "grid", "lookup"].includes(V.kindOf(f)));
    meta[mod.id] = { fields: byName, grids, blocked, extra, linkGrid };
    return { problems };
  }

  async function start() {
    await api.init();
    const [forms, reports] = await Promise.all([api.getForms(), api.getReports()]);
    const formNames = new Set(forms.map((f) => f.link_name));
    const reportNames = new Set(reports.map((r) => r.link_name));
    const result = { appName: api.appName, user: api.initParams.loginUser, problems: {}, fatal: [] };
    for (const mod of MODULES.filter((m) => !m.custom)) {
      const { problems } = await checkModule(mod, formNames, reportNames);
      if (problems.length) {
        result.problems[mod.id] = problems;
        if (mod.id === "personal") result.fatal = problems;     // every other step depends on Personal_Info
        // The client sees a plain message; the technical reasons go to the console for the preparer / developer.
        meta[mod.id] = Object.assign(meta[mod.id] || {}, {
          blocked: "This step hasn't been set up for your account yet, so nothing can be saved here for now.", details: problems });
      }
    }
    return result;
  }

  const metaOf = (mod) => meta[mod.id];

  /* ---------------- clients ---------------- */
  function nameText(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    return String(value.zc_display_value || "").trim();
  }
  const joined = (r, parts) => parts.map((p) => nameText(r[p])).filter(Boolean).join(" ");

  async function loadClients() {
    const personal = MODULES.find((m) => m.id === "personal");
    const records = await api.getAllRecords(personal.report);
    return records.map((r) => ({
      id: String(r.ID),
      name: joined(r, ["Taxpayer_First_Name", "Taxpayer_Middle_Name", "Taxpayer_Last_Name"]),
      spouse: joined(r, ["Spouse_First_Name", "Spouse_Middle_Name", "Spouse_Last_Name"]),
      emails: [nameText(r.Taxpayer_Email), nameText(r.Spouse_Email)].filter(Boolean).map((e) => e.toLowerCase()),
    }));
  }

  /* ---------------- model ---------------- */
  function sectionFields(mod) {
    const out = [];
    mod.sections.forEach((s) => { if (!s.grid) s.fields.forEach((f) => out.push(typeof f === "string" ? { name: f } : f)); });
    (metaOf(mod).extra || []).forEach((f) => out.push({ name: f.link_name }));
    return out;
  }
  const gridSections = (mod) => mod.sections.filter((s) => s.grid);
  const colOpts = (sec, col) => (sec.columns && sec.columns[col]) || {};

  function emptyRow(mod, sec) {
    const cols = metaOf(mod).grids.get(sec.grid) || new Map();
    const values = {};
    cols.forEach((field, name) => { values[name] = V.kindOf(field) === "checkboxes" ? [] : ""; });
    return { _uid: nextUid(), _rowId: null, values, files: {}, pending: {} };
  }

  function emptyModel(mod, clientId) {
    const m = metaOf(mod);
    const values = {};
    sectionFields(mod).forEach((f) => { values[f.name] = V.kindOf(m.fields.get(f.name)) === "checkboxes" ? [] : ""; });
    const grids = {};
    gridSections(mod).forEach((sec) => { grids[sec.grid] = []; });
    return { recordId: null, clientId, values, files: {}, pending: {}, grids, snapshot: null };
  }

  function rowFromZoho(mod, sec, zrow) {
    const keys = Object.keys(zrow).filter((k) => !["ID", "display_value", "zc_display_value"].includes(k));
    if (!keys.length && zrow.display_value !== undefined) {
      throw new PortalError(`Zoho returned only a summary for the rows of ${sec.grid}, not their values.`,
        ["Nothing was changed. This list can't be edited safely here — contact your preparer."]);
    }
    const row = emptyRow(mod, sec);
    row._rowId = String(zrow.ID || "") || null;
    (metaOf(mod).grids.get(sec.grid) || new Map()).forEach((field, col) => {
      const kind = V.learnKind(field, zrow[col]);
      const v = V.fromZoho(kind, zrow[col], colOpts(sec, col));
      if (kind === "file") row.files[col] = v; else row.values[col] = v;
    });
    return row;
  }

  function modelFromRecord(mod, record, clientId) {
    const m = metaOf(mod);
    const model = emptyModel(mod, clientId);
    model.recordId = String(record.ID);
    sectionFields(mod).forEach((f) => {
      const kind = V.learnKind(m.fields.get(f.name), record[f.name]);
      const v = V.fromZoho(kind, record[f.name], f);
      if (kind === "file") model.files[f.name] = v; else model.values[f.name] = v;
    });
    gridSections(mod).forEach((sec) => {
      const rows = Array.isArray(record[sec.grid]) ? record[sec.grid] : [];
      model.grids[sec.grid] = rows.map((r) => rowFromZoho(mod, sec, r));
    });
    model.snapshot = snapshot(mod, model);
    return model;
  }

  function snapshot(mod, model) {
    const s = { values: {}, grids: {} };
    Object.entries(model.values).forEach(([k, v]) => { s.values[k] = V.comparable(v); });
    Object.entries(model.grids).forEach(([g, rows]) => { s.grids[g] = gridFingerprint(rows); });
    return s;
  }
  const rowFingerprint = (row) => Object.keys(row.values).sort().map((k) => `${k}=${V.comparable(row.values[k])}`).join("\u0001")
    + (Object.values(row.pending || {}).some((l) => l && l.length) ? "\u0001+files" : "");
  // Blank rows are never saved, so adding an empty row is not a change.
  const gridFingerprint = (rows) => rows.filter((r) => rowIsUsed(r)).map(rowFingerprint).join("\u0002");

  /** Which parent fields / grids differ from what was loaded. */
  function changes(mod, model) {
    const snap = model.snapshot || { values: {}, grids: {} };
    const fields = Object.keys(model.values).filter((k) => V.comparable(model.values[k]) !== (snap.values[k] ?? ""));
    const grids = Object.keys(model.grids).filter((g) => gridFingerprint(model.grids[g]) !== (snap.grids[g] ?? ""));
    const files = Object.keys(model.pending).filter((k) => model.pending[k] && model.pending[k].length);
    return { fields, grids, files, any: fields.length + grids.length + files.length > 0 };
  }

  /* ---------------- load ---------------- */
  const asLookupId = (id) => (/^\d+$/.test(String(id)) ? String(id) : `"${String(id).replace(/"/g, '\\"')}"`);

  /** true / false when the rows show the lookup; null when the report leaves that column out (Zoho only returns
   *  the columns the report displays). */
  function rowLinks(rec, grid, col, clientId) {
    const rows = (Array.isArray(rec[grid]) ? rec[grid] : []).filter((r) => r && col in r);
    if (!rows.length) return null;
    return rows.some((r) => String(r[col] && typeof r[col] === "object" ? r[col].ID : r[col]) === String(clientId));
  }

  async function findModuleRecords(mod, clientId) {
    const linkGrid = metaOf(mod) && metaOf(mod).linkGrid;
    if (!linkGrid) return api.getAllRecords(mod.report, `(${mod.clientLink} == ${asLookupId(clientId)})`);
    // Lookup inside a subform: ask Zoho with a subform criterion, then confirm each match from the full record. If Zoho
    // does not accept the criterion, read every record of the report and keep the ones whose rows point at the client.
    // Verified live: Zoho filters on the subform lookup server-side. Rows are re-checked when the report shows the column.
    let candidates;
    let filtered = true;
    try {
      candidates = await api.getAllRecords(mod.report, `(${linkGrid}.${mod.clientLink} == ${asLookupId(clientId)})`);
    } catch (err) {
      if (global.console) console.warn(`[organizer] ${mod.report}: subform criterion not accepted (${err.message}); checking every record.`);
      candidates = await api.getAllRecords(mod.report);
      filtered = false;
    }
    return candidates.filter((rec) => {
      const linked = rowLinks(rec, linkGrid, mod.clientLink, clientId);
      return linked === null ? filtered : linked;
    });
  }

  /** { model, duplicates } — duplicates lists record IDs when the client has more than one record in this form. */
  async function loadModule(mod, clientId, chosenId) {
    if (mod.id === "personal") {
      if (!clientId) return { model: emptyModel(mod, null), duplicates: [] };
      const rec = await api.getRecordById(mod.report, clientId);
      return { model: modelFromRecord(mod, rec, clientId), duplicates: [] };
    }
    const found = chosenId ? [{ ID: chosenId }] : await findModuleRecords(mod, clientId);
    if (found.length > 1 && !chosenId) return { model: null, duplicates: found.map((r) => String(r.ID)) };
    if (!found.length) return { model: emptyModel(mod, clientId), duplicates: [] };
    const rec = await api.getRecordById(mod.report, String(found[0].ID));
    return { model: modelFromRecord(mod, rec, clientId), duplicates: [] };
  }

  /* ---------------- save ---------------- */
  function rowPayload(mod, sec, row, clientId, clientHasSpouse) {
    const out = {};
    (metaOf(mod).grids.get(sec.grid) || new Map()).forEach((field, col) => {
      const kind = V.kindOf(field);
      if (kind === "lookup") {
        // Checklist rows carry lookups to Personal_Info: they always point at this client's record. A subform that holds
        // the module's client link (Estimated_Tax) sets it on every row.
        if (col === mod.clientLink && metaOf(mod).linkGrid === sec.grid) out[col] = String(clientId);
        else if (sec.autoLookups && (col !== "Spouse_Full_Name" || clientHasSpouse)) out[col] = String(clientId);
        return;
      }
      const v = V.toZoho(kind, row.values[col], colOpts(sec, col));
      if (v !== undefined) out[col] = v;
    });
    return out;
  }
  const rowIsUsed = (row) => Object.values(row.values).some((v) => !V.isBlank(v))
    || Object.values(row.pending || {}).some((l) => l && l.length) || Object.values(row.files || {}).some((l) => l && l.length);

  function payloadFor(mod, model, ch, ctx) {
    const m = metaOf(mod);
    const data = {};
    const fieldsToSend = model.recordId ? ch.fields : Object.keys(model.values);
    fieldsToSend.forEach((name) => {
      const f = m.fields.get(name);
      const kind = V.kindOf(f);
      const opts = sectionFields(mod).find((x) => x.name === name) || {};
      const v = V.toZoho(kind, model.values[name], opts);
      if (v !== undefined) data[name] = v;
      else if (model.recordId && kind !== "file") data[name] = kind === "checkboxes" ? [] : "";   // a cleared value is cleared in Zoho too
    });
    if (mod.clientLink && !model.recordId && !m.linkGrid) data[mod.clientLink] = String(model.clientId);
    const sentRows = {};
    gridSections(mod).forEach((sec) => {
      if (model.recordId && !ch.grids.includes(sec.grid)) return;            // untouched subforms are not sent
      const rows = model.grids[sec.grid].filter(rowIsUsed);
      sentRows[sec.grid] = rows;
      data[sec.grid] = rows.map((r) => rowPayload(mod, sec, r, model.clientId, ctx.clientHasSpouse));
    });
    return { data, sentRows };
  }

  /** Rows whose uploaded documents would be lost if this subform were sent again (Zoho replaces the whole subform). */
  function lockedFileRows(mod, model, gridName) {
    return (model.grids[gridName] || []).filter((r) => r._rowId && Object.values(r.files).some((l) => l && l.length));
  }

  function compareSaved(mod, sentModel, saved, ch) {
    const problems = [];
    const fieldsToCheck = sentModel.recordId ? ch.fields : Object.keys(sentModel.values);
    fieldsToCheck.forEach((name) => {
      const kind = V.kindOf(metaOf(mod).fields.get(name));
      if (kind === "file") return;
      if (V.comparable(sentModel.values[name]) !== V.comparable(saved.values[name])) {
        problems.push(`"${name}": sent "${V.comparable(sentModel.values[name])}", Zoho now has "${V.comparable(saved.values[name])}".`);
      }
    });
    gridSections(mod).forEach((sec) => {
      if (sentModel.recordId && !ch.grids.includes(sec.grid)) return;
      const sent = sentModel.grids[sec.grid].filter(rowIsUsed).length;
      const now = saved.grids[sec.grid].length;
      if (sent !== now) problems.push(`${sec.title}: sent ${sent} row(s), Zoho now has ${now}.`);
    });
    return problems;
  }

  async function uploadPending(mod, model, sentRows, recordId, saved) {
    const failures = [];
    const parent = Object.entries(model.pending).filter(([, list]) => list && list.length);
    for (const [field, list] of parent) {
      for (const file of list) {
        try { await api.uploadFile({ report_name: mod.report, id: recordId, field_name: field, file }); }
        catch (err) { failures.push(`${file.name}: ${err.message}`); }
      }
    }
    // Subform files: the rows Zoho now holds are matched to the rows sent, in order (row IDs are new after a save).
    for (const sec of gridSections(mod)) {
      const sent = sentRows[sec.grid];
      if (!sent) continue;
      const savedRows = saved.grids[sec.grid];
      for (let i = 0; i < sent.length; i++) {
        const pending = Object.entries(sent[i].pending || {}).filter(([, list]) => list && list.length);
        if (!pending.length) continue;
        const target = savedRows[i];
        if (!target || !target._rowId) { failures.push(`${sec.title}, row ${i + 1}: Zoho did not return the row, so its files were not uploaded.`); continue; }
        for (const [col, list] of pending) {
          for (const file of list) {
            try {
              await api.uploadFile({ report_name: mod.report, id: target._rowId, parent_id: recordId, field_name: `${sec.grid}.${col}`, file });
            } catch (err) { failures.push(`${sec.title}, row ${i + 1}, ${file.name}: ${err.message}`); }
          }
        }
      }
    }
    return failures;
  }

  /**
   * Create or update the module record. Returns { model (as Zoho now holds it), recordId, created, problems, uploadFailures }.
   * Throws PortalError before sending anything when the save would delete documents already uploaded.
   */
  async function saveModule(mod, model, ctx = {}) {
    if (metaOf(mod).blocked) throw new PortalError(metaOf(mod).blocked, metaOf(mod).details || []);
    const ch = changes(mod, model);
    if (model.recordId && !ch.any) return { model, recordId: model.recordId, created: false, problems: [], uploadFailures: [], nothing: true };

    for (const g of (model.recordId ? ch.grids : [])) {
      const locked = lockedFileRows(mod, model, g);
      if (locked.length) {
        const sec = gridSections(mod).find((s) => s.grid === g);
        throw new PortalError(`"${sec.title}" already has uploaded documents.`, [
          "Zoho Creator replaces this whole list on every change, which would delete the documents already uploaded.",
          "Nothing was saved. Undo the change to this list, or ask your preparer to update it."]);
      }
    }

    // Records linked through their rows: with no rows the record would belong to no one.
    const linkGrid = metaOf(mod).linkGrid;
    if (linkGrid && !model.grids[linkGrid].some(rowIsUsed)) {
      if (!model.recordId) return { model, recordId: null, created: false, problems: [], uploadFailures: [], nothing: true };
      if (ch.grids.includes(linkGrid)) {
        throw new PortalError("At least one entry has to stay in this list.", [
          "Each entry is what links this record to you, so removing every one would detach it from your organizer.",
          "Nothing was saved. Keep one entry, or ask your preparer to remove the record."]);
      }
    }

    let recordId = model.recordId;
    const { data, sentRows } = payloadFor(mod, model, ch, ctx);
    if (!recordId) {
      if (mod.clientLink) {
        const existing = await findModuleRecords(mod, model.clientId);
        if (existing.length) throw new PortalError(`A ${mod.title} record already exists for this client.`, ["Reload this step before saving, so nothing is duplicated."]);
      }
      recordId = await api.addRecord(mod.form, data);
      if (!recordId) throw new PortalError("Zoho did not return the new record's ID — the save could not be confirmed.");
    } else if (Object.keys(data).length) {
      await api.updateRecordById(mod.report, recordId, data);
    }

    let savedRecord = await api.getRecordById(mod.report, recordId);
    let saved = modelFromRecord(mod, savedRecord, model.clientId || (mod.id === "personal" ? recordId : null));
    const problems = compareSaved(mod, model, saved, ch);
    const hasUploads = ch.files.length || Object.values(sentRows).some((rows) => rows.some((r) => Object.values(r.pending || {}).some((l) => l && l.length)));
    let uploadFailures = [];
    if (hasUploads) {
      uploadFailures = await uploadPending(mod, model, sentRows, recordId, saved);
      savedRecord = await api.getRecordById(mod.report, recordId);
      saved = modelFromRecord(mod, savedRecord, saved.clientId);
    }
    return { model: saved, recordId, created: !model.recordId, problems, uploadFailures };
  }

  global.PortalService = {
    PortalError, start, loadClients, loadModule, saveModule, changes, emptyRow, metaOf, lockedFileRows, sectionFields, rowIsUsed,
  };
})(window);
