/*
 * HTML for one organizer step (steps 1–5), drawn with the FBAR widget's own building blocks (fbar.css):
 *   section title  .sf-title h2           parent fields  .form-grid > .form-row (label left, control right)
 *   inputs         .inp / select.inp.sel  lists          .sf-wrap > .sf-scroll > table.sf-table (# column, cells .cell, delete column)
 *   add a row      .add-new "+ Add New"   errors         .err, .invalid
 * Inputs carry data-* attributes that portal-app.js reads back (data-f = parent field, data-g/data-row/data-c = list cell).
 */
(function (global) {
  "use strict";
  const V = global.PortalValues;
  const service = global.PortalService;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7zm4 2v8h2v-8zm4 0v8h2v-8z"/></svg>';
  const LOCK = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3z"/></svg>';

  /** Label for the client: the layout's friendly label, else Creator's display name (trimmed of stray spaces). */
  function labelOf(opts, field, linkName) {
    if (opts && opts.label) return opts.label;
    const d = String((field && field.display_name) || linkName || "").replace(/\s+/g, " ").trim();
    return d || linkName;
  }

  const tip = (text) => (text ? `<span class="tip" title="${esc(text)}">?</span>` : "");

  /** `cls` is "inp" for form rows and "cell" for table cells (the two FBAR control styles). */
  function control(kind, field, value, attrs, opts = {}, cls = "inp") {
    const choices = V.choicesOf(field);
    switch (kind) {
      case "textarea":
        return `<textarea class="${cls} pt-area" rows="${cls === "cell" ? 1 : 3}" ${attrs}>${esc(value)}</textarea>`;
      case "select": {
        const all = !V.isBlank(value) && !choices.includes(String(value)) ? choices.concat(String(value)) : choices;
        const selCls = cls === "inp" ? "inp sel" : "cell";
        return `<select class="${selCls} ${V.isBlank(value) ? "placeholder" : ""}" ${attrs}><option value="">-Select-</option>${
          all.map((c) => `<option value="${esc(c)}" ${String(value) === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
      }
      case "radio": {
        const group = `rg-${attrs.replace(/ id="[^"]*"| aria-label="[^"]*"/g, "").replace(/\W+/g, "_")}`;   // one group per field / cell
        const plain = attrs.replace(/ id="[^"]*"/, "");
        return `<div class="pt-choices" role="radiogroup">${choices.map((c) =>
          `<label class="pt-choice"><input type="radio" name="${group}" value="${esc(c)}" ${String(value) === c ? "checked" : ""} ${plain}><span>${esc(c)}</span></label>`).join("")}</div>`;
      }
      case "checkboxes": {
        const set = new Set(Array.isArray(value) ? value : []);
        const plain = attrs.replace(/ id="[^"]*"/, "");
        return `<div class="pt-choices">${choices.map((c) =>
          `<label class="pt-choice"><input type="checkbox" value="${esc(c)}" ${set.has(c) ? "checked" : ""} ${plain}><span>${esc(c)}</span></label>`).join("")}</div>`;
      }
      case "date":
        return `<input class="${cls}" type="date" value="${esc(value)}" ${attrs}>`;
      case "datetime":
        return opts.dateOnly
          ? `<input class="${cls}" type="date" value="${esc(value)}" ${attrs}>`
          : `<input class="${cls}" type="datetime-local" value="${esc(value)}" ${attrs}>`;
      case "integer":
        return `<input class="${cls} num" inputmode="numeric" value="${esc(value)}" ${attrs} autocomplete="off">`;
      case "decimal":
        return `<input class="${cls} num" inputmode="decimal" value="${esc(value)}" ${attrs} autocomplete="off">`;
      case "email":
        return `<input class="${cls}" type="email" value="${esc(value)}" ${attrs} autocomplete="off" spellcheck="false">`;
      case "phone":
        return `<input class="${cls}" type="tel" value="${esc(value)}" ${attrs} autocomplete="off">`;
      case "unknown":   // a Zoho field type this widget can't edit safely: shown, never sent on save
        return `<input class="${cls}" value="${esc(value)}" ${attrs.replace(/data-(f|g|row|c)="[^"]*"/g, "")} disabled title="This field can't be changed here">`;
      default:
        return `<input class="${cls}" value="${esc(value)}" ${field && field.max_char ? `maxlength="${field.max_char}"` : ""} ${attrs} autocomplete="off" spellcheck="false">`;
    }
  }

  function fileBox(existing, pending, attrs, multiple, locked) {
    const have = (existing || []).map((p) => `<span class="pt-file saved" title="Uploaded">${esc(V.fileName(p))}</span>`).join("");
    const add = (pending || []).map((f, i) => `<span class="pt-file new" title="Uploads when you save">${esc(f.name)}<button type="button" class="pt-x" data-unpend="${i}" ${attrs} aria-label="Remove ${esc(f.name)}">×</button></span>`).join("");
    const picker = locked ? "" : `<label class="pt-upload"><input type="file" ${multiple ? "multiple" : ""} ${attrs} hidden><span>${(existing || []).length || (pending || []).length ? "+ Add file" : "Upload file"}</span></label>`;
    return `<div class="pt-files">${have}${add}${picker}${!have && !add && locked ? '<span class="pt-muted">No file</span>' : ""}</div>`;
  }

  /* ---------------- parent fields: FBAR form rows ---------------- */
  const isLong = (label) => label.length > 34;

  function fieldRow(mod, model, opts, errors, qa) {
    const m = service.metaOf(mod);
    const field = m.fields.get(opts.name);
    const kind = V.kindOf(field);
    const label = labelOf(opts, field, opts.name);
    const req = field && field.mandatory ? ' <span class="req" title="Required">*</span>' : "";
    const err = errors[opts.name];
    const attrs = `data-f="${esc(opts.name)}"`;
    const input = kind === "file"
      ? fileBox(model.files[opts.name], model.pending[opts.name], attrs, false, false)
      : control(kind, field, model.values[opts.name], `${attrs} id="f-${esc(opts.name)}" aria-label="${esc(label)}"`, opts);
    // Long questions read better across the full width (question left, answer right). In a step made of such
    // questions (qa), every field uses that row so all answers line up in one column.
    const shape = opts.wide || kind === "textarea" ? "wide" : (qa || isLong(label) ? "q" : "");
    return `<div class="form-row ${shape} ${err ? "invalid" : ""}">
      <label for="f-${esc(opts.name)}">${esc(label)}${req}${tip(opts.help)}</label>
      <div class="pt-ctl">${input}${err ? `<span class="err">${esc(err)}</span>` : ""}</div>
    </div>`;
  }

  /* ---------------- lists: FBAR subform tables ---------------- */
  const COL_WIDTH = { text: 200, textarea: 240, email: 210, phone: 150, integer: 110, decimal: 120, date: 150, datetime: 200,
    select: 170, radio: 200, checkboxes: 240, file: 230, url: 200, time: 120 };

  function gridTable(mod, model, sec, errors) {
    const cols = [...(service.metaOf(mod).grids.get(sec.grid) || new Map()).entries()]
      .filter(([, f]) => V.kindOf(f) !== "lookup");    // row lookups are filled automatically
    const rows = model.grids[sec.grid] || [];
    const locked = model.recordId ? service.lockedFileRows(mod, model, sec.grid) : [];
    const lockedIds = new Set(locked.map((r) => r._uid));
    const colOpts = (c) => (sec.columns && sec.columns[c]) || {};
    const item = sec.itemLabel || "row";

    const head = `<thead><tr class="cols"><th class="c-no">#</th>${cols.map(([col, field]) => {
      const o = colOpts(col);
      const w = o.dateOnly ? COL_WIDTH.date : (COL_WIDTH[V.kindOf(field)] || 180);
      return `<th style="min-width:${w}px">${esc(labelOf(o, field, col))}${field.mandatory ? '<span class="req" title="Required">*</span>' : ""}${tip(o.help)}</th>`;
    }).join("")}<th class="c-del" aria-label="Remove"></th></tr></thead>`;

    const body = rows.length ? rows.map((row, i) => {
      const isLocked = lockedIds.has(row._uid);
      const cells = cols.map(([col, field]) => {
        const kind = V.kindOf(field);
        const o = colOpts(col);
        const label = labelOf(o, field, col);
        const attrs = `data-g="${esc(sec.grid)}" data-row="${row._uid}" data-c="${esc(col)}" ${isLocked ? "disabled" : ""}`;
        const err = errors[`${sec.grid}|${row._uid}|${col}`];
        const input = kind === "file"
          ? fileBox(row.files[col], row.pending[col], attrs, true, isLocked)
          : control(kind, field, row.values[col], `${attrs} aria-label="${esc(label)} ${i + 1}"`, o, "cell");
        return `<td${err ? ' class="invalid"' : ""}>${input}${err ? `<span class="err">${esc(err)}</span>` : ""}</td>`;
      }).join("");
      const del = isLocked
        ? `<span class="pt-lock" title="Documents uploaded — this ${esc(item.toLowerCase())} is kept as is">${LOCK}</span>`
        : `<button type="button" class="del-btn" data-delrow="${row._uid}" data-g="${esc(sec.grid)}" title="Remove ${esc(item.toLowerCase())} ${i + 1}" aria-label="Remove ${esc(item.toLowerCase())} ${i + 1}">${TRASH}</button>`;
      return `<tr${isLocked ? ' class="pt-locked"' : ""}><td class="c-no">${i + 1}</td>${cells}<td class="c-del">${del}</td></tr>`;
    }).join("") : `<tr class="empty-row"><td colspan="${cols.length + 2}">Nothing added yet. Click “Add New” to add one.</td></tr>`;

    const used = rows.filter(service.rowIsUsed).length;
    const meta = `<span class="meta">${used ? `${used} added` : "None added"}</span>`;
    const foot = locked.length
      ? `<div class="pt-locknote">This list already has uploaded documents. Changing it would remove them in Zoho Creator, so it is kept as is — ask your preparer if something needs to be added or corrected.</div>`
      : `<button type="button" class="add-new" data-addrow="${esc(sec.grid)}"><span class="plus">+</span> Add New</button>`;
    return { meta, html: `<div class="sf-wrap"><div class="sf-scroll"><table class="sf-table pt-table">${head}<tbody>${body}</tbody></table></div></div>
      <div class="sf-foot">${foot}</div>` };
  }

  /** Whole step. `errors` maps "Field" or "Grid|rowUid|Column" to a message. */
  function moduleHTML(mod, model, errors = {}) {
    const m = service.metaOf(mod);
    const sections = mod.sections.filter((s) => !s.showIf || s.showIf(model.values) || sectionHasData(s, model));
    const extra = (m.extra || []).map((f) => ({ name: f.link_name }));
    // A questionnaire step (schema: questions: true) uses one question-and-answer layout for all its fields.
    const qa = !!mod.questions;
    const title = (sec, meta) => `<div class="sf-title"><h2>${esc(sec.title)}</h2>${meta || ""}${sec.intro ? `<span class="meta">${esc(sec.intro)}</span>` : ""}</div>`;
    const blocks = sections.map((sec) => {
      if (sec.grid) {
        const t = gridTable(mod, model, sec, errors);
        return `<section class="sf pt-sf" data-sec="${sec.id}">${title(sec, t.meta)}${t.html}</section>`;
      }
      const rows = sec.fields.map((f) => (typeof f === "string" ? { name: f } : f))
        .filter((f) => !f.showIf || f.showIf(model.values) || !V.isBlank(model.values[f.name]) || (model.files[f.name] || []).length)
        .map((f) => fieldRow(mod, model, f, errors, qa)).join("");
      return `<section class="sf pt-sf" data-sec="${sec.id}">${title(sec)}<div class="form-grid pt-fields">${rows}</div></section>`;
    });
    if (extra.length) {
      blocks.push(`<section class="sf pt-sf">${title({ title: "Other details" })}<div class="form-grid pt-fields">${
        extra.map((f) => fieldRow(mod, model, f, errors, qa)).join("")}</div></section>`);
    }
    return blocks.join("");
  }

  function sectionHasData(sec, model) {
    if (sec.grid) return (model.grids[sec.grid] || []).length > 0;
    return sec.fields.some((f) => { const n = typeof f === "string" ? f : f.name; return !V.isBlank(model.values[n]); });
  }

  global.PortalRender = { moduleHTML, esc, labelOf };
})(window);
