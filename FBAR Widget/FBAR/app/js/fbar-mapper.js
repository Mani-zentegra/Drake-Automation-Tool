/*
 * Converts between FBAR1 records (Zoho) and the widget's model.
 *
 * Model: { recordId, taxpayerId, spouseId, taxYear,
 *          taxpayer: { separate: [rows], joint: [rows] }, spouse: { separate: [rows], joint: [rows] } }
 * A row is a plain object keyed by the UI column keys (fbar-schema.js) plus _uid / _zohoId / _address.
 */
(function (global) {
  "use strict";
  const CFG = global.FBAR_CONFIG;
  const S = global.FBAR_SCHEMA;

  const PERSONS = ["taxpayer", "spouse"];
  const SECTIONS = ["separate", "joint"];

  class MappingError extends Error {
    constructor(message) { super(message); this.name = "MappingError"; }
  }

  const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
  const columnsFor = (section) => CFG.columns.filter((c) => !c.jointOnly || section === "joint");
  const usdColumn = (section, key) => S.SUBFORMS.find((s) => s.id === section).columns.find((c) => c.key === key);

  /* Zoho returns numbers as strings ("1850000.00"); the UI keeps plain digits. */
  function numberFromZoho(value) {
    if (isBlank(value)) return "";
    const n = parseFloat(String(value).replace(/,/g, ""));
    return Number.isFinite(n) ? String(n) : "";
  }

  /* Lookup values arrive as { ID, <display field>, zc_display_value }. */
  const lookupId = (value) => (value && typeof value === "object" ? String(value.ID || "") : "");

  /* ---------------- Zoho -> model ---------------- */

  function rowFromZoho(zohoRow, section, subformName) {
    // A subform row that only carries ID / display_value means Zoho sent a summary, not the row data.
    // Editing on top of that would wipe the real values on save, so stop here instead.
    const keys = Object.keys(zohoRow).filter((k) => k !== "ID" && k !== "display_value" && k !== "zc_display_value");
    if (!keys.length && zohoRow.display_value !== undefined) {
      throw new MappingError(`Zoho returned only a summary for the rows of ${subformName}, not their values.`);
    }

    const values = {};
    // Columns the widget does not show are kept and sent back, because a save replaces the whole row.
    const known = new Set(columnsFor(section).map((c) => c.zoho).concat(["ID", "display_value", "zc_display_value"]));
    const extra = {};
    Object.entries(zohoRow).forEach(([k, v]) => {
      if (known.has(k) || isBlank(v)) return;
      if (typeof v === "object") {
        throw new MappingError(`Column "${k}" of ${subformName} is not handled by the widget; saving would lose its value.`);
      }
      extra[k] = v;
    });
    values._extra = extra;
    columnsFor(section).forEach((col) => {
      const raw = zohoRow[col.zoho];
      switch (col.kind) {
        case "usd":
          break;                                   // recalculated from Rupees and the exchange rate
        case "number":
          values[col.key] = numberFromZoho(raw);
          break;
        case "accountType":
          if (isBlank(raw)) { values.accountType = ""; values.otherDetails = ""; }
          else if (CFG.picklists.accountType.includes(raw)) { values.accountType = raw; values.otherDetails = ""; }
          else { values.accountType = "Other"; values.otherDetails = raw; }   // value typed via "others option"
          break;
        case "address": {
          const address = raw && typeof raw === "object" ? raw : {};
          Object.entries(CFG.addressParts).forEach(([uiKey, part]) => { values[uiKey] = address[part] || ""; });
          values._address = raw && typeof raw === "object" ? stripDisplay(raw) : null;
          break;
        }
        default:
          values[col.key] = isBlank(raw) ? "" : String(raw);
      }
    });
    values._zohoId = String(zohoRow.ID || "") || null;
    // Values loaded from Zoho win over the new-row defaults ("No", 85.577); an empty Yes/No stays empty.
    return Object.assign(S.newRow(section), values);
  }

  function stripDisplay(obj) {
    const copy = Object.assign({}, obj);
    delete copy.zc_display_value;
    delete copy.display_value;
    return copy;
  }

  function fromZohoRecord(record) {
    const P = CFG.parentFields;
    const model = {
      recordId: String(record.ID),
      taxpayerId: lookupId(record[P.taxpayer]),
      spouseId: lookupId(record[P.spouse]),
      taxYear: isBlank(record[P.taxYear]) ? "" : String(record[P.taxYear]),
    };
    PERSONS.forEach((person) => {
      model[person] = {};
      SECTIONS.forEach((section) => {
        const name = CFG.subforms[person][section];
        const rows = Array.isArray(record[name]) ? record[name] : [];
        model[person][section] = rows.map((r) => rowFromZoho(r, section, name));
      });
    });
    return model;
  }

  /** Model for an FBAR that does not exist in Zoho yet: one empty row per subform (as on a new form). */
  function emptyModel(taxpayerId, spouseId, taxYear) {
    const model = { recordId: null, taxpayerId, spouseId, taxYear };
    PERSONS.forEach((person) => {
      model[person] = {};
      SECTIONS.forEach((section) => { model[person][section] = [S.newRow(section)]; });
    });
    return model;
  }

  /* ---------------- model -> Zoho ---------------- */

  /*
   * One subform row for the payload.
   *
   * Zoho Creator (v2.1 update) REPLACES a subform with the rows sent for it and rejects rows that carry
   * their "ID" (HTTP 404, code 2930) — verified against the live FBAR1_Report. So every row is sent
   * complete and without ID; blank values are left out. Subforms that are not sent stay untouched.
   * Values of columns this widget does not show (row._extra) are sent back unchanged so nothing is lost.
   */
  function rowToZoho(row, section) {
    const out = Object.assign({}, row._extra || {});
    const put = (field, value) => { if (!isBlank(value)) out[field] = value; };

    columnsFor(section).forEach((col) => {
      switch (col.kind) {
        case "usd": {
          const usdCol = usdColumn(section, col.key);
          if (!isBlank(row[usdCol.of])) put(col.zoho, S.usdValue(row, usdCol));
          break;
        }
        case "number":
          if (!isBlank(row[col.key])) put(col.zoho, S.toNumber(row[col.key]));
          break;
        case "accountType":
          put(col.zoho, row.accountType === "Other" ? (row.otherDetails || "").trim() : row.accountType);
          break;
        case "address": {
          // Hidden parts received from Zoho (country, postal code, ...) are kept; the UI parts overwrite theirs.
          const address = {};
          Object.entries(row._address || {}).forEach(([part, v]) => { if (typeof v === "string" && v.trim()) address[part] = v; });
          Object.entries(CFG.addressParts).forEach(([uiKey, part]) => {
            const v = (row[uiKey] || "").trim();
            if (v) address[part] = v; else delete address[part];
          });
          if (Object.keys(address).length) out[col.zoho] = address;
          break;
        }
        default:
          put(col.zoho, typeof row[col.key] === "string" ? row[col.key].trim() : row[col.key]);
      }
    });
    return out;
  }

  /** The rows of one subform that go to Zoho: loaded rows and new rows with data; rows with no value at all are left out. */
  function rowsToSend(model, person, section, isUsed) {
    return model[person][section]
      .filter((row) => row._zohoId || isUsed(row, section))
      .filter((row) => Object.keys(rowToZoho(row, section)).length > 0);
  }

  /**
   * Payload for FBAR1. `changedSubforms` (Set of "person.section") limits which subforms are sent on an
   * update, so a section nobody touched is never rewritten. A sent subform is replaced as a whole, so it
   * always carries all of its rows (an empty list removes every row). `isUsed` decides which UI rows are real accounts.
   */
  function toZohoPayload(model, { changedSubforms = null, isUsed }) {
    const P = CFG.parentFields;
    const data = {
      [P.taxpayer]: model.taxpayerId,
      [P.spouse]: model.spouseId || "",
      [P.taxYear]: String(model.taxYear).trim(),
    };
    PERSONS.forEach((person) => SECTIONS.forEach((section) => {
      if (changedSubforms && !changedSubforms.has(`${person}.${section}`)) return;
      data[CFG.subforms[person][section]] = rowsToSend(model, person, section, isUsed).map((row) => rowToZoho(row, section));
    }));
    return data;
  }

  /* A short fingerprint of a row, used to check that what Zoho stored matches what was sent. */
  function fingerprint(row) {
    const type = row.accountType === "Other" ? row.otherDetails : row.accountType;
    return [row.institutionName, row.accountNumber, S.toNumber(row.maxValue), type].map((v) => String(v ?? "").trim()).join("|");
  }

  global.FbarMapper = { MappingError, fromZohoRecord, emptyModel, toZohoPayload, rowToZoho, rowsToSend, fingerprint, lookupId, PERSONS, SECTIONS };
})(window);
