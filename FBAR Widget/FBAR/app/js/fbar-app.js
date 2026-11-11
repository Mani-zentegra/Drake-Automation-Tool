/*
 * FBAR widget UI — dynamic subforms (one row per financial account), connected to Zoho Creator.
 *
 * state.data is the FBAR model (see fbar-mapper.js): state.data[person][section] is an array of rows.
 * Every row has a stable `_uid`, so adding, deleting or editing one row never touches another.
 * All Zoho communication goes through FbarService; this file only renders and handles user input.
 */
(function () {
  "use strict";
  const S = window.FBAR_SCHEMA;
  const service = window.FbarService;
  const dialog = window.FbarDialog;

  const state = {
    data: null,              // FBAR model of the selected taxpayer / spouse / year (null until selected)
    people: [],              // Personal_Info records: { id, taxpayerName, spouseName }
    person: "taxpayer",      // visible tab
    dirty: false,
    changed: new Set(),      // "person.section" keys edited since the last load / save
    loadedSnapshot: null,    // fingerprints of the loaded rows (save verification)
    lastDeleted: null,
    ready: false,            // Zoho connection verified
  };

  /* ---------------- helpers ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
  // US$ is shown with cents — the same value that is saved to the Zoho USD fields.
  const fmtUsd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Amounts are Rupees (the Zoho fields are INR currency fields): Indian digit grouping, e.g. 18,50,000.
  const fmtLocal = (v) => (isBlank(v) ? "" : num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

  const subform = (id) => S.SUBFORMS.find((s) => s.id === id);
  const rowsOf = (sfId, personId = state.person) => state.data[personId][sfId];
  const findRow = (sfId, uid) => rowsOf(sfId).find((r) => r._uid === uid);

  const usd = (row, col) => S.usdValue(row, col);     // shared with the Zoho payload (fbar-schema.js)

  const matches = (cond, row) => !cond || Object.entries(cond).every(([k, v]) => row[k] === v);
  const enabled = (col, row) => matches(col.enabledIf, row);
  const required = (col, row) => !!col.required || (col.requiredIf ? matches(col.requiredIf, row) : false);

  /* A row counts as an account once anything other than the defaults is entered. */
  function isUsed(row, sfId) {
    return subform(sfId).columns.some((c) => {
      if (c.kind === "usd") return false;
      return c.default !== undefined ? String(row[c.key]) !== String(c.default) : !isBlank(row[c.key]);
    });
  }

  function cellError(col, row) {
    if (col.kind === "usd" || !enabled(col, row)) return "";
    const v = row[col.key];
    if (required(col, row) && isBlank(v)) return "Required";
    if (col.kind === "rate" && !(num(v) > 0)) return "Must be above 0";
    if (col.kind === "money" && !isBlank(v) && !/^-?[\d,\s]*\.?\d*$/.test(String(v).trim())) return "Numbers only";
    if (col.kind === "tin" && !isBlank(v) && /^[\d\s-]+$/.test(v) && String(v).replace(/\D/g, "").length !== 9) return "SSN/ITIN = 9 digits";
    return "";
  }
  /* A picklist value saved earlier that is no longer one of Zoho's choices (e.g. after the list was changed in Creator). */
  function staleChoice(col, row, personId, sfId) {
    if (col.key !== "currency" || isBlank(row[col.key])) return "";
    return S.choicesFor(col, personId, sfId).includes(String(row[col.key])) ? "" : "Not in Zoho's list — choose again";
  }

  const rowErrors = (row, sfId) => (isUsed(row, sfId) ? subform(sfId).columns.filter((c) => cellError(c, row)).length : 0);

  function totals(personId) {
    const t = { accounts: 0, missing: 0, maxUsd: 0, incomeUsd: 0, taxUsd: 0 };
    S.SUBFORMS.forEach((sf) => rowsOf(sf.id, personId).forEach((row) => {
      if (!isUsed(row, sf.id)) return;
      t.accounts++;
      if (rowErrors(row, sf.id)) t.missing++;
      const col = (k) => sf.columns.find((c) => c.key === k);
      t.maxUsd += usd(row, col("maxValueUsd"));
      t.incomeUsd += usd(row, col("interestUsd")) + usd(row, col("dividendsUsd"));
      t.taxUsd += usd(row, col("taxPaidUsd"));
    }));
    return t;
  }

  /* `sfId` is the section of the visible person; it is recorded so only edited subforms are sent. */
  function markDirty(sfId, personId = state.person) {
    state.dirty = true;
    if (sfId) state.changed.add(`${personId}.${sfId}`);
    const el = $("#saveState"); el.textContent = "Unsaved changes"; el.classList.add("dirty");
    document.dispatchEvent(new CustomEvent("fbar:status"));
  }

  function markClean(text) {
    state.dirty = false;
    state.changed.clear();
    const el = $("#saveState"); el.classList.remove("dirty"); el.textContent = text || "";
    document.dispatchEvent(new CustomEvent("fbar:status"));
  }

  function setBusy(text) {
    $("#busy").hidden = !text;
    $("#busyText").textContent = text || "";
    $("#saveBtn").disabled = !!text || !state.data;
    $("#resetBtn").disabled = !!text || !state.data;
  }

  function toast(html, ms = 3500) {
    const t = $("#toast");
    t.innerHTML = html; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; state.lastDeleted = null; }, ms);
  }

  /* ---------------- render ---------------- */
  function renderPersonTabs() {
    $("#personTabs").innerHTML = S.PERSONS.map((p) => {
      const n = state.data ? totals(p.id).accounts : 0;
      const name = personName(p.id);
      return `<button type="button" role="tab" class="ptab" data-person="${p.id}" aria-selected="${state.person === p.id}">
        ${esc(p.label)}${name ? ` <span class="pname">· ${esc(name)}</span>` : ""}<span class="cnt">${n} account${n === 1 ? "" : "s"}</span></button>`;
    }).join("");
  }

  function personName(personId) {
    const id = state.data ? (personId === "taxpayer" ? state.data.taxpayerId : state.data.spouseId) : "";
    const p = state.people.find((x) => x.id === id);
    return p ? (personId === "taxpayer" ? p.taxpayerName : p.spouseName) : "";
  }

  function renderHeader() {
    const p = S.PERSONS.find((x) => x.id === state.person);
    $("#taxYear").textContent = (state.data && state.data.taxYear) || $("#taxYearInput").value || "–";
    const note = $("#personNote");
    note.hidden = !p.note; note.textContent = p.note || "";
    $("#notesList").innerHTML = S.NOTES
      .filter((n) => typeof n === "string" || n.only === state.person)
      .map((n) => `<li>${esc(typeof n === "string" ? n : n.text)}</li>`).join("");
  }

  function renderTotals() {
    if (!state.data) { $("#totals").innerHTML = ""; return; }
    const t = totals(state.person);
    const over = t.maxUsd > S.FBAR_THRESHOLD_USD;
    $("#totals").innerHTML = `
      <div class="t"><div class="k">Accounts entered</div><div class="v">${t.accounts}</div></div>
      <div class="t"><div class="k">Aggregate maximum value</div><div class="v">${fmtUsd(t.maxUsd)}</div></div>
      <div class="t"><div class="k">Interest + dividends</div><div class="v">${fmtUsd(t.incomeUsd)}</div></div>
      <div class="t"><div class="k">Tax paid outside US</div><div class="v">${fmtUsd(t.taxUsd)}</div></div>
      <div class="t ${over ? "req" : "ok"}"><div class="k">FBAR status (limit ${fmtUsd(S.FBAR_THRESHOLD_USD)})</div>
        <div class="v">${over ? "FBAR required" : "Below the limit"}</div></div>`;
  }

  function headHTML(sf) {
    // group header row: consecutive columns with the same group share one cell
    const groups = [];
    sf.columns.forEach((c) => {
      const last = groups[groups.length - 1];
      if (last && last.id === c.group) last.span++; else groups.push({ id: c.group, span: 1 });
    });
    const groupRow = `<tr class="groups"><th class="c-no"></th>${groups.map((g) =>
      `<th colspan="${g.span}" data-group="${g.id}">${esc(S.GROUPS[g.id])}</th>`).join("")}<th class="c-del"></th></tr>`;
    const colRow = `<tr class="cols"><th class="c-no">#</th>${sf.columns.map((c) => {
      const tip = c.help ? `<span class="tip" title="${esc(c.help)}">?</span>` : "";
      const req = c.required ? '<span class="req" title="Required">*</span>' : "";
      return `<th class="${c.kind === "usd" ? "is-calc" : ""}" style="min-width:${c.width}px;width:${c.width}px">${esc(S.labelOf(c, state.person))}${req}${tip}</th>`;
    }).join("")}<th class="c-del" aria-label="Delete"></th></tr>`;
    return `<thead>${groupRow}${colRow}</thead>`;
  }

  function cellHTML(sf, col, row) {
    const v = row[col.key];
    const attrs = `data-uid="${row._uid}" data-sf="${sf.id}" data-key="${col.key}" aria-label="${esc(S.labelOf(col, state.person))}"`;
    const err = isUsed(row, sf.id) ? cellError(col, row) || staleChoice(col, row, state.person, sf.id) : "";
    const tdCls = err ? ' class="invalid"' : "";
    const errHTML = err ? `<span class="err">${esc(err)}</span>` : "";
    let inner;
    switch (col.kind) {
      case "usd": {
        const val = usd(row, col);
        return `<td><div class="calc ${val ? "" : "zero"}" data-usd="${col.key}" data-uid="${row._uid}">${fmtUsd(val || 0)}</div></td>`;
      }
      case "money":
        inner = `<input class="cell num" ${attrs} data-money="1" inputmode="decimal" value="${esc(fmtLocal(v))}" placeholder="0" autocomplete="off">`;
        break;
      case "rate":
        inner = `<input class="cell num" ${attrs} inputmode="decimal" value="${esc(v)}" autocomplete="off">`;
        break;
      case "combo":   // picklist with Zoho's "others option": pick a value or type another
        inner = `<input class="cell" ${attrs} list="dl-${col.key}" value="${esc(v)}" placeholder="${esc(col.placeholder || "")}" autocomplete="off">`;
        break;
      case "choice":
      case "yesno": {
        const opts = col.kind === "yesno" ? S.OPTIONS.yesNo : S.choicesFor(col, state.person, sf.id);
        const ph = col.placeholder ? `<option value="" ${isBlank(v) ? "selected" : ""}>${esc(col.placeholder)}</option>` : "";
        // a value stored in Zoho that is not in the list is still shown (and kept), never silently replaced
        const all = !isBlank(v) && !opts.includes(String(v)) ? opts.concat(String(v)) : opts;
        inner = `<select class="cell ${isBlank(v) ? "placeholder" : ""}" ${attrs}>${ph}${all.map((o) =>
          `<option value="${esc(o)}" ${String(v) === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
        break;
      }
      default: {
        const dis = enabled(col, row) ? "" : "disabled";
        const ph = enabled(col, row) ? (col.placeholder || "") : "Only for type Other";
        inner = `<input class="cell ${col.mono ? "mono" : ""}" ${attrs} value="${esc(dis ? "" : v)}" placeholder="${esc(ph)}" ${dis} autocomplete="off" spellcheck="false">`;
      }
    }
    return `<td${tdCls}>${inner}${errHTML}</td>`;
  }

  function rowHTML(sf, row, i) {
    return `<tr data-uid="${row._uid}"><td class="c-no">${i + 1}</td>${sf.columns.map((c) => cellHTML(sf, c, row)).join("")}
      <td class="c-del"><button type="button" class="del-btn" data-del="${row._uid}" data-sf="${sf.id}" title="Delete account ${i + 1}" aria-label="Delete account ${i + 1}">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7zm4 2v8h2v-8zm4 0v8h2v-8z"/></svg></button></td></tr>`;
  }

  function footHTML(sf, rows) {
    const used = rows.filter((r) => isUsed(r, sf.id));
    const cells = sf.columns.map((c, idx) => {
      if (c.kind === "usd") return `<td data-total="${c.key}">${fmtUsd(used.reduce((s, r) => s + usd(r, c), 0))}</td>`;
      return "<td></td>";
    }).join("");
    return `<tfoot><tr><td class="c-no lbl">Total</td>${cells}<td class="c-del"></td></tr></tfoot>`;
  }

  function sectionMeta(sf, rows) {
    const used = rows.filter((r) => isUsed(r, sf.id)).length;
    const missing = rows.filter((r) => rowErrors(r, sf.id)).length;
    return missing
      ? `<span class="meta warn">${used} account${used === 1 ? "" : "s"} · ${missing} with missing required fields</span>`
      : `<span class="meta">${used} account${used === 1 ? "" : "s"}</span>`;
  }

  function renderSubform(sfId) {
    const sf = subform(sfId);
    const rows = rowsOf(sfId);
    const body = rows.length ? rows.map((r, i) => rowHTML(sf, r, i)).join("")
      : `<tr class="empty-row"><td colspan="${sf.columns.length + 2}">No accounts. Click “Add New” to add one.</td></tr>`;
    const host = $(`#sf-${sfId}`);
    const scroll = host ? host.querySelector(".sf-scroll") : null;
    const keep = scroll ? { x: scroll.scrollLeft, y: scroll.scrollTop } : null;
    const html = `
      <div class="sf-title"><h2>${esc(sf.title)}</h2><span data-meta>${sectionMeta(sf, rows)}</span></div>
      <div class="sf-wrap" data-wrap="${sf.id}">
        <div class="sf-scroll" data-scroll="${sf.id}"><table class="sf-table">${headHTML(sf)}<tbody>${body}</tbody>${footHTML(sf, rows)}</table></div>
      </div>
      <div class="sf-foot">
        <button type="button" class="add-new" data-add="${sf.id}"><span class="plus">+</span> Add New</button>
        ${navHTML(sf)}
      </div>`;
    if (host) {
      host.innerHTML = html;
      if (keep) { const s = host.querySelector(".sf-scroll"); s.scrollLeft = keep.x; s.scrollTop = keep.y; }
    } else {
      $("#subforms").insertAdjacentHTML("beforeend", `<section class="sf" id="sf-${sfId}">${html}</section>`);
    }
    updateNav(sfId);
  }

  /* ---------------- horizontal navigation (column groups + arrows) ---------------- */
  const STICKY_LEFT = 46;   // width of the sticky "#" column

  function navHTML(sf) {
    const groups = [...new Set(sf.columns.map((c) => c.group))];
    const arrow = (dir, d) => `<button type="button" class="nav-arrow" data-nav="${sf.id}" data-dir="${dir}" aria-label="${dir < 0 ? "Scroll left" : "Scroll right"}">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg></button>`;
    return `<div class="sf-nav" role="toolbar" aria-label="Jump to columns">
      ${arrow(-1, "M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z")}
      <div class="nav-chips">${groups.map((g) =>
        `<button type="button" class="nav-chip" data-jump="${sf.id}" data-group="${g}">${esc(S.GROUPS[g])}</button>`).join("")}</div>
      ${arrow(1, "M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z")}
    </div>`;
  }

  /* Edge fades, arrow states and the highlighted chip follow the scroll position. */
  function updateNav(sfId) {
    const scroll = document.querySelector(`[data-scroll="${sfId}"]`);
    const wrap = document.querySelector(`[data-wrap="${sfId}"]`);
    if (!scroll || !wrap) return;
    const max = scroll.scrollWidth - scroll.clientWidth;
    const x = scroll.scrollLeft;
    const scrollable = max > 2;
    wrap.classList.toggle("can-left", scrollable && x > 2);
    wrap.classList.toggle("can-right", scrollable && x < max - 2);
    const nav = document.querySelector(`#sf-${sfId} .sf-nav`);
    if (!nav) return;
    nav.classList.toggle("is-static", !scrollable);
    nav.querySelector('[data-dir="-1"]').disabled = !scrollable || x <= 2;
    nav.querySelector('[data-dir="1"]').disabled = !scrollable || x >= max - 2;
    // active group = the one covering the most of the visible area
    const viewL = x + STICKY_LEFT, viewR = x + scroll.clientWidth - 48;
    let active = null, best = -1;
    scroll.querySelectorAll("thead tr.groups th[data-group]").forEach((th) => {
      const seen = Math.min(viewR, th.offsetLeft + th.offsetWidth) - Math.max(viewL, th.offsetLeft);
      if (seen > best) { best = seen; active = th.dataset.group; }
    });
    const ths = scroll.querySelectorAll("thead tr.groups th[data-group]");
    if (ths.length && x <= 2) active = ths[0].dataset.group;                     // at the start: first group
    if (ths.length && scrollable && x >= max - 2) active = ths[ths.length - 1].dataset.group;   // at the end: last group
    // a chip that was just clicked stays highlighted while the table rests where that click took it
    const pin = scroll.dataset.pin;
    if (pin && Math.abs(x - Math.min(max, +scroll.dataset.pinX)) <= 4) active = pin;
    nav.querySelectorAll(".nav-chip").forEach((c) => c.classList.toggle("on", c.dataset.group === active));
  }

  function jumpTo(sfId, group) {
    const scroll = document.querySelector(`[data-scroll="${sfId}"]`);
    const th = scroll && scroll.querySelector(`thead tr.groups th[data-group="${group}"]`);
    if (!th) return;
    const left = Math.max(0, th.offsetLeft - STICKY_LEFT);
    scroll.dataset.pin = group; scroll.dataset.pinX = left;
    scroll.scrollTo({ left, behavior: "smooth" });
  }

  function scrollStep(sfId, dir) {
    const scroll = document.querySelector(`[data-scroll="${sfId}"]`);
    if (scroll) scroll.scrollBy({ left: dir * Math.round(scroll.clientWidth * 0.7), behavior: "smooth" });
  }

  function renderAll() {
    renderPersonTabs(); renderHeader(); renderTotals();
    $("#subforms").innerHTML = "";
    renderGate();
    if (!state.data) return;
    S.SUBFORMS.forEach((sf) => renderSubform(sf.id));
    const combos = S.SUBFORMS.flatMap((sf) => sf.columns).filter((c) => c.kind === "combo");
    $("#subforms").insertAdjacentHTML("beforeend", [...new Map(combos.map((c) => [c.key, c])).values()].map((c) =>
      `<datalist id="dl-${c.key}">${c.options.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>`).join(""));
  }

  /* Message shown instead of the subforms until a taxpayer and tax year are chosen. */
  function renderGate() {
    const gate = $("#gate");
    if (state.data) { gate.hidden = true; return; }
    gate.hidden = false;
    gate.textContent = state.ready ? "Select the taxpayer and tax year to load or start their FBAR." : "Connecting to Zoho Creator…";
  }

  /* Update calculated cells, errors and totals in place while typing (keeps focus and caret). */
  function refreshRow(sfId, uid) {
    const sf = subform(sfId);
    const row = findRow(sfId, uid);
    const tr = document.querySelector(`#sf-${sfId} tr[data-uid="${uid}"]`);
    if (!row || !tr) return;
    sf.columns.forEach((c) => {
      if (c.kind === "usd") {
        const box = tr.querySelector(`[data-usd="${c.key}"]`); const val = usd(row, c);
        box.textContent = fmtUsd(val || 0); box.classList.toggle("zero", !val);
        return;
      }
      const input = tr.querySelector(`[data-key="${c.key}"]`); if (!input) return;
      const td = input.closest("td");
      const err = isUsed(row, sfId) ? cellError(c, row) : "";
      td.classList.toggle("invalid", !!err);
      let msg = td.querySelector(".err");
      if (err) { if (!msg) { msg = document.createElement("span"); msg.className = "err"; td.appendChild(msg); } msg.textContent = err; }
      else if (msg) msg.remove();
    });
    const rows = rowsOf(sfId);
    const used = rows.filter((r) => isUsed(r, sfId));
    sf.columns.filter((c) => c.kind === "usd").forEach((c) => {
      const cell = document.querySelector(`#sf-${sfId} [data-total="${c.key}"]`);
      if (cell) cell.textContent = fmtUsd(used.reduce((s, r) => s + usd(r, c), 0));
    });
    document.querySelector(`#sf-${sfId} [data-meta]`).innerHTML = sectionMeta(sf, rows);
    renderTotals(); renderPersonTabs();
  }

  /* ---------------- actions ---------------- */
  function addRow(sfId) {
    const row = S.newRow(sfId);
    rowsOf(sfId).push(row);
    markDirty(sfId); renderSubform(sfId); renderTotals(); renderPersonTabs();
    const tr = document.querySelector(`#sf-${sfId} tr[data-uid="${row._uid}"]`);
    if (tr) {
      tr.classList.add("flash");
      const scroll = tr.closest(".sf-scroll"); scroll.scrollLeft = 0;
      tr.scrollIntoView({ block: "nearest" });
      const first = tr.querySelector("[data-key]"); if (first) first.focus({ preventScroll: true });
    }
  }

  function deleteRow(sfId, uid) {
    const rows = rowsOf(sfId);
    const i = rows.findIndex((r) => r._uid === uid);
    if (i < 0) return;
    const [removed] = rows.splice(i, 1);
    state.lastDeleted = { person: state.person, sfId, index: i, row: removed };
    markDirty(sfId); renderSubform(sfId); renderTotals(); renderPersonTabs();
    const note = removed._zohoId ? " It is deleted in Zoho when you save." : "";
    toast(`Account ${i + 1} removed.${note} <button type="button" data-undo="1">Undo</button>`, 6000);
  }

  function undoDelete() {
    const d = state.lastDeleted; if (!d) return;
    rowsOf(d.sfId, d.person).splice(d.index, 0, d.row);
    markDirty(d.sfId, d.person);
    state.lastDeleted = null;
    $("#toast").hidden = true;
    if (d.person !== state.person) showPerson(d.person);
    else renderAll();
  }

  /* Switch the Taxpayer / Spouse tab. Each person's tables start at the first column. */
  function showPerson(personId) {
    if (personId !== state.person) document.querySelectorAll(".sf-scroll").forEach((s) => { s.scrollLeft = 0; });
    state.person = personId;
    renderAll();
  }

  function setCell(el) {
    const { sf, uid, key } = el.dataset;
    const row = findRow(sf, uid); if (!row) return;
    row[key] = el.dataset.money ? el.value.replace(/[^\d.,-]/g, "").replace(/,/g, "") : el.value;
    markDirty(sf);
    return row;
  }

  /* ---------------- events ---------------- */
  function bind() {
    const app = $("#fbarApp");

    app.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-person]");
      if (tab) return showPerson(tab.dataset.person);
      if (!state.data) return;
      const add = e.target.closest("[data-add]");
      if (add) return addRow(add.dataset.add);
      const del = e.target.closest("[data-del]");
      if (del) return deleteRow(del.dataset.sf, del.dataset.del);
      if (e.target.closest("[data-undo]")) return undoDelete();
      const jump = e.target.closest("[data-jump]");
      if (jump) return jumpTo(jump.dataset.jump, jump.dataset.group);
      const step = e.target.closest("[data-nav]");
      if (step) return scrollStep(step.dataset.nav, +step.dataset.dir);
    });

    app.addEventListener("input", (e) => {
      const el = e.target.closest("input.cell[data-key]");
      if (!el) return;
      setCell(el);
      refreshRow(el.dataset.sf, el.dataset.uid);
    });

    app.addEventListener("change", (e) => {
      const el = e.target.closest("select.cell[data-key]");
      if (!el) return;
      const row = setCell(el);
      el.classList.toggle("placeholder", isBlank(el.value));
      if (el.dataset.key === "accountType") {
        // switches the "If Other, Mention Details" cell on or off
        if (el.dataset.key === "accountType" && row.accountType !== "Other") row.otherDetails = "";
        const focusKey = el.dataset.key, uid = el.dataset.uid, sf = el.dataset.sf;
        renderSubform(sf); renderTotals();
        const again = document.querySelector(`#sf-${sf} [data-uid="${uid}"][data-key="${focusKey}"]`); if (again) again.focus();
      } else {
        refreshRow(el.dataset.sf, el.dataset.uid);
      }
    });

    // show raw digits while editing an amount, formatted (e.g. 18,50,000) when leaving it
    app.addEventListener("focusin", (e) => {
      const el = e.target.closest("[data-money]"); if (!el) return;
      const row = findRow(el.dataset.sf, el.dataset.uid); if (!row) return;
      el.value = row[el.dataset.key] || "";
      el.select();   // replacing the text drops the browser's select-all; restore it so typing replaces the amount
    });
    app.addEventListener("focusout", (e) => {
      const el = e.target.closest("[data-money]"); if (!el) return;
      const row = findRow(el.dataset.sf, el.dataset.uid); if (row) el.value = fmtLocal(row[el.dataset.key]);
    });

    $("#saveBtn").addEventListener("click", saveFbar);
    $("#resetBtn").addEventListener("click", resetFbar);
    $("#taxpayerSelect").addEventListener("change", onTaxpayerChange);
    $("#spouseSelect").addEventListener("change", () => selectionChanged());
    $("#taxYearInput").addEventListener("change", () => selectionChanged());
  }

  /* ---------------- Zoho: selection, load, save ---------------- */

  const selection = () => ({
    taxpayerId: $("#taxpayerSelect").value,
    spouseId: $("#spouseSelect").value,
    taxYear: $("#taxYearInput").value.trim(),
  });

  function fillPeople() {
    const option = (id, name) => `<option value="${esc(id)}">${esc(name)}</option>`;
    const byName = (key) => state.people.filter((p) => p[key]).sort((a, b) => a[key].localeCompare(b[key]));
    $("#taxpayerSelect").innerHTML = '<option value="">-Select-</option>' + byName("taxpayerName").map((p) => option(p.id, p.taxpayerName)).join("");
    // Two Personal_Info records can hold the same spouse name: then say whose spouse each entry is.
    const spouses = byName("spouseName");
    const repeated = (name) => spouses.filter((p) => p.spouseName === name).length > 1;
    const spouseLabel = (p) => (repeated(p.spouseName) && p.taxpayerName ? `${p.spouseName} (spouse of ${p.taxpayerName})` : p.spouseName);
    $("#spouseSelect").innerHTML = '<option value="">-Select-</option>' + spouses.map((p) => option(p.id, spouseLabel(p))).join("");
    ["#taxpayerSelect", "#spouseSelect", "#taxYearInput"].forEach((id) => { $(id).disabled = false; });
  }

  /* The spouse normally belongs to the same Personal_Info record as the taxpayer. */
  function onTaxpayerChange() {
    // The spouse always follows the chosen taxpayer's own Personal_Info record; never keep the previous one.
    const person = state.people.find((p) => p.id === $("#taxpayerSelect").value);
    $("#spouseSelect").value = person && person.spouseName ? person.id : "";
    selectionChanged();
  }

  let lastSelection = null;

  async function selectionChanged() {
    const sel = selection();
    if (lastSelection && state.dirty) {
      const ok = await dialog.confirm({ title: "Discard unsaved changes?", message: "You changed this FBAR but did not save it. Load the other selection anyway?",
        confirmText: "Discard changes", danger: true });
      if (!ok) { restoreSelection(lastSelection); return; }
    }
    if (!sel.taxpayerId || !/^\d{4}$/.test(sel.taxYear)) {
      state.data = null; lastSelection = sel; markClean(""); setStatus("");
      if (sel.taxYear && !/^\d{4}$/.test(sel.taxYear)) setStatus("Enter the tax year as four digits, e.g. 2025.", "warn");
      setBusy(""); renderAll();
      return;
    }
    await loadFor(sel);
  }

  function restoreSelection(sel) {
    $("#taxpayerSelect").value = sel.taxpayerId;
    $("#spouseSelect").value = sel.spouseId;
    $("#taxYearInput").value = sel.taxYear;
  }

  async function loadFor(sel) {
    setBusy("Loading the FBAR record from Zoho…");
    try {
      const matches = await service.findRecords(sel.taxpayerId, sel.spouseId, sel.taxYear);
      let recordId = matches.length ? String(matches[0].ID) : null;
      if (matches.length > 1) { setBusy(""); recordId = await chooseDuplicate(matches); setBusy("Loading the FBAR record from Zoho…"); }
      if (matches.length > 1 && !recordId) { setBusy(""); restoreSelection(lastSelection || { taxpayerId: "", spouseId: "", taxYear: sel.taxYear }); return; }
      const model = recordId ? await service.loadRecord(recordId) : FbarMapper.emptyModel(sel.taxpayerId, sel.spouseId, sel.taxYear);
      applyModel(model, recordId ? "Loaded from Zoho" : "");
      lastSelection = sel;
      setStatus(recordId
        ? `Editing the saved FBAR record (ID ${recordId}).`
        : "No FBAR record exists yet for this taxpayer, spouse and year — saving creates it.", recordId ? "ok" : "info");
    } catch (err) {
      state.data = null; renderAll(); setBusy("");
      showError("Could not load the FBAR record", err);
    } finally {
      setBusy("");
    }
  }

  async function chooseDuplicate(records) {
    return dialog.choose({
      title: "More than one FBAR record matches",
      message: `${records.length} FBAR records exist for this taxpayer, spouse and tax year. Choose the one to open, and remove the duplicate in Zoho Creator.`,
      options: records.map((r) => ({ value: String(r.ID), label: `Record ID ${r.ID}`, detail: r.Tax_Year ? `Tax year ${r.Tax_Year}` : "" })),
    });
  }

  function applyModel(model, savedText) {
    // the selected Personal_Info records stay in charge of the names; the model keeps the IDs
    state.data = model;
    state.loadedSnapshot = service.snapshot(model);
    S.SUBFORMS.forEach((sf) => FbarMapper.PERSONS.forEach((p) => {
      if (!model[p][sf.id].length) model[p][sf.id].push(S.newRow(sf.id));   // show one empty row to type in
    }));
    markClean(savedText);
    renderAll();
  }

  function setStatus(text, tone = "info") {
    const el = $("#recordStatus");
    el.textContent = text;
    el.className = `record-status ${text ? "tone-" + tone : ""}`;
  }

  /* ---------------- save ---------------- */

  function validateBeforeSave() {
    const blocking = [];
    const warnings = [];
    const sel = selection();
    if (!sel.taxpayerId) blocking.push("Select the taxpayer.");
    if (!/^\d{4}$/.test(sel.taxYear)) blocking.push("Enter the tax year as four digits.");
    FbarMapper.PERSONS.forEach((person) => S.SUBFORMS.forEach((sf) => {
      const label = `${person === "taxpayer" ? "Taxpayer" : "Spouse"} — ${sf.title}`;
      state.data[person][sf.id].forEach((row, i) => {
        if (!isUsed(row, sf.id)) return;
        // Only subforms that will be sent are checked against Zoho's current picklist.
        const sent = !state.data.recordId || state.changed.has(`${person}.${sf.id}`);
        sf.columns.forEach((col) => {
          const err = cellError(col, row) || (sent ? staleChoice(col, row, person, sf.id) : "");
          if (!err) return;
          const msg = `${label}, account ${i + 1}: ${S.labelOf(col, person)} — ${err}`;
          (err === "Required" ? warnings : blocking).push(msg);
        });
        if (row.accountType === "Other" && isBlank(row.otherDetails)) blocking.push(`${label}, account ${i + 1}: describe the "Other" account type.`);
      });
    }));
    const spouseRows = S.SUBFORMS.some((sf) => state.data.spouse[sf.id].some((r) => isUsed(r, sf.id)));
    if (spouseRows && !sel.spouseId) warnings.push("Spouse accounts are filled in but no spouse is selected.");
    return { blocking: [...new Set(blocking)], warnings };
  }

  async function saveFbar() {
    if (!state.data) return;
    const { blocking, warnings } = validateBeforeSave();
    if (blocking.length) {
      await dialog.alert({ title: "Fix these before saving", message: "Some values can't be saved to Zoho:", details: blocking.slice(0, 12), tone: "error" });
      return;
    }
    if (warnings.length) {
      const ok = await dialog.confirm({ title: "Some details are missing", message: "Save anyway? You can complete them later.",
        details: warnings.slice(0, 12), confirmText: "Save anyway" });
      if (!ok) return;
    }
    if (state.data.recordId && !state.changed.size) { toast("Nothing has changed since the last save."); return; }

    const sel = selection();
    Object.assign(state.data, { taxpayerId: sel.taxpayerId, spouseId: sel.spouseId, taxYear: sel.taxYear });
    setBusy(state.data.recordId ? "Saving changes to Zoho…" : "Creating the FBAR record in Zoho…");
    try {
      const result = await service.save(state.data, { changedSubforms: new Set(state.changed), isUsed, loadedSnapshot: state.loadedSnapshot });
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      applyModel(result.model, `Saved to Zoho at ${time}`);
      lastSelection = selection();
      setStatus(`Editing the saved FBAR record (ID ${result.recordId}).`, "ok");
      setBusy("");
      if (result.problems.length) {
        await dialog.alert({ title: "Saved, but Zoho shows differences", tone: "warning",
          message: "Zoho accepted the save, but the record read back from Zoho does not fully match what was sent. The table now shows what Zoho holds.",
          details: result.problems });
      } else {
        toast(result.created ? "FBAR record created in Zoho." : "FBAR saved to Zoho.");
      }
    } catch (err) {
      setBusy("");
      showError("The FBAR was not saved", err, "Your changes are still on screen — nothing was lost. Try saving again.");
    } finally {
      setBusy("");
    }
  }

  async function resetFbar() {
    if (!state.data) return;
    if (state.dirty) {
      const ok = await dialog.confirm({ title: "Discard unsaved changes?", message: "Reload the FBAR from Zoho and drop your unsaved changes?",
        confirmText: "Discard changes", danger: true });
      if (!ok) return;
    }
    state.dirty = false;
    await loadFor(selection());
  }

  function showError(title, err, extra) {
    const details = (err && err.details) || [];
    const message = (err && err.message) || "Unexpected error.";
    if (window.console) console.error(title, err && err.kind ? { kind: err.kind, code: err.code } : err);   // no record data logged
    const sentence = /[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`;
    return dialog.alert({ title, message: extra ? `${sentence} ${extra}` : sentence, details, tone: "error" });
  }

  /* ---------------- start-up ---------------- */

  async function startUp() {
    bind();
    $("#taxYearInput").value = String(new Date().getFullYear() - 1);   // FBAR is filed for the previous year
    renderAll();
    setBusy("Connecting to Zoho Creator…");
    try {
      const info = await service.start();
      info.notes.forEach((note) => console.warn("[FBAR widget]", note));
      state.ready = true;
      setBusy("Loading taxpayers…");
      state.people = await service.loadPeople();
      fillPeople();
      if (!state.people.length) setStatus("No records found in Personal_Info — add the taxpayer there first.", "warn");
      renderAll();
    } catch (err) {
      setBusy("");
      $("#gate").textContent = "The widget could not connect to Zoho Creator.";
      state.startError = err;
      // Inside the tax organizer the message is shown when the client opens the FBAR step, not over the welcome page.
      if (!window.PORTAL_SCHEMA) showError("Can't start the FBAR widget", err);
    } finally {
      setBusy("");
    }
  }

  document.addEventListener("scroll", (e) => {
    const el = e.target;
    if (el && el.dataset && el.dataset.scroll) updateNav(el.dataset.scroll);
  }, true);
  window.addEventListener("resize", () => S.SUBFORMS.forEach((sf) => updateNav(sf.id)));
  window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

  // Sideways scrolling: Shift + mouse wheel, the column navigator or the arrows. A plain wheel always scrolls the page.

  /* ---------------- hook for the client tax organizer (portal-app.js) ----------------
   * Lets the organizer open FBAR for the client it already knows, using the normal selection flow above
   * (same load / duplicate / unsaved-changes handling). Nothing here changes how FBAR loads or saves. */
  const ready = startUp();
  window.FbarApp = {
    ready,
    isDirty: () => state.dirty,
    /** True when an FBAR record is loaded/saved for this client (as taxpayer). */
    hasRecord: (clientId) => !!(state.data && state.data.recordId) && $("#taxpayerSelect").value === String(clientId),
    async showClient(clientId) {
      await ready;
      if (!state.ready) { if (state.startError) throw state.startError; return false; }
      if (!state.people.some((p) => p.id === String(clientId))) {     // a client created in this session
        state.people = await service.loadPeople();
        fillPeople();
      }
      if (!state.people.some((p) => p.id === String(clientId))) return false;
      ["#taxpayerSelect", "#spouseSelect"].forEach((id) => { $(id).disabled = true; });   // the organizer fixes the client
      if ($("#taxpayerSelect").value !== String(clientId)) {
        $("#taxpayerSelect").value = String(clientId);
        onTaxpayerChange();
      }
      return true;
    },
  };

  window.FBARApp = { state, renderAll, totals, isUsed };   // debugging aid
})();
