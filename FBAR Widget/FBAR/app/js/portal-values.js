/*
 * Field kinds and value conversion between the widget's inputs and Zoho Creator.
 *
 * Kinds come from META.getFields type codes (verified list in "zoho creator widget backend prompt.txt"):
 *   1 text · 2 textarea · 3 email · 5 number · 6 decimal · 7 percent · 8 currency · 10 date · 11 date-time
 *   12 picklist (or lookup when is_lookup_field) · 13 radio · 14 multi-select · 15 checkboxes · 17 url
 *   27 phone · 34 time · 46 file upload
 * Dates travel as the app's format "dd-MMM-yyyy" (application date format in ALL DS FORMS.txt) and
 * date-times as "dd-MMM-yyyy HH:mm:ss"; the browser inputs use ISO (yyyy-mm-dd / yyyy-mm-ddThh:mm).
 */
(function (global) {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && !v.length);

  /** A stored Creator file / image value: "/api/v2.1/{scope}/{app}/report/{report}/{id}/{field}/download?filepath=…" */
  const FILE_PATH = /\/download\?filepath=/;
  const looksLikeFile = (raw) => (Array.isArray(raw) ? raw.length > 0 && raw.every((x) => FILE_PATH.test(String(x))) : FILE_PATH.test(String(raw || "")));

  function kindOf(field) {
    if (!field) return "unknown";
    if (field._kind) return field._kind;             // set when a stored value proved the field holds files (see learnKind)
    if (field.is_lookup_field) return "lookup";
    switch (Number(field.type)) {
      case 1: return "text";
      case 2: return "textarea";
      case 3: return "email";
      case 5: return "integer";
      case 6: case 7: case 8: return "decimal";
      case 10: return "date";
      case 11: return "datetime";
      case 12: return "select";
      case 13: return "radio";
      case 14: case 15: return "checkboxes";
      case 17: return "url";
      case 27: return "phone";
      case 34: return "time";
      // File upload: 46 in the Widget SDK reference, 19 in Creator's REST field list; 18 = image upload (same upload API).
      case 18: case 19: case 46: return "file";
      default:
        return Array.isArray(field.subform_fields || field.fields || field.subFormFields) ? "grid" : "unknown";
    }
  }

  /**
   * If Zoho reports a type code this widget doesn't know but the stored value is a Creator file path, the field holds
   * files: remember that on the metadata object so it is shown as an upload, never as an editable text box.
   */
  function learnKind(field, raw) {
    if (field && !field._kind && kindOf(field) !== "file" && kindOf(field) !== "lookup" && looksLikeFile(raw)) {
      field._kind = "file";
      if (global.console) console.warn(`[organizer] field "${field.link_name}" has Zoho type ${field.type} but stores files — shown as an upload.`);
    }
    return kindOf(field);
  }

  const choicesOf = (field) => (Array.isArray(field && field.choices) ? field.choices : [])
    .map((c) => (c && typeof c === "object" ? (c.value ?? c.key) : c))
    .filter((v) => typeof v === "string" && v !== "");

  /* ---------------- dates ---------------- */
  /** "18-Jun-2026" or "18-Jun-2026 01:56:04" -> { date: "2026-06-18", time: "01:56" } (null when unreadable) */
  function parseZohoDate(text) {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(text || "").trim());
    if (!m) return null;
    const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
    if (mon < 0) return null;
    return { date: `${m[3]}-${pad(mon + 1)}-${pad(m[1])}`, time: m[4] !== undefined ? `${pad(m[4])}:${m[5]}` : "" };
  }
  /** "2026-06-18" -> "18-Jun-2026" */
  function toZohoDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : "";
  }

  /* ---------------- Zoho -> input value ---------------- */
  function fromZoho(kind, raw, opts = {}) {
    if (raw === undefined || raw === null) return kind === "checkboxes" ? [] : "";
    switch (kind) {
      case "date": { const d = parseZohoDate(raw); return d ? d.date : ""; }
      case "datetime": {
        const d = parseZohoDate(raw);
        if (!d) return "";
        return opts.dateOnly ? d.date : `${d.date}T${d.time || "00:00"}`;
      }
      case "checkboxes": return Array.isArray(raw) ? raw.map(String) : String(raw).split(",").map((s) => s.trim()).filter(Boolean);
      case "lookup": return typeof raw === "object" ? String(raw.ID || "") : String(raw);
      case "file": return Array.isArray(raw) ? raw.filter(Boolean).map(String) : (raw ? [String(raw)] : []);
      case "url": return typeof raw === "object" ? String(raw.url || raw.value || "") : String(raw);
      default: return typeof raw === "object" ? String(raw.zc_display_value ?? raw.display_value ?? "") : String(raw);
    }
  }

  /* ---------------- input value -> Zoho payload ---------------- */
  /** Returns undefined for "leave this field out" (blank values are not sent, files never go in a payload). */
  function toZoho(kind, value, opts = {}) {
    if (kind === "file" || kind === "unknown" || kind === "grid") return undefined;
    if (isBlank(value)) return undefined;
    switch (kind) {
      case "date": return toZohoDate(value) || undefined;
      case "datetime": {
        if (opts.dateOnly) { const d = toZohoDate(value); return d ? `${d} 00:00:00` : undefined; }
        const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(value));
        return m ? `${toZohoDate(m[1])} ${m[2]}:${m[3]}:00` : undefined;
      }
      case "integer": return String(value).replace(/[,\s]/g, "");
      case "decimal": return String(value).replace(/[,\s]/g, "");
      case "checkboxes": return value.map(String);
      case "lookup": return String(value);
      default: return String(value).trim();
    }
  }

  /** Error text for a value Zoho would reject, or "" */
  function validate(kind, value, { required, label, maxChar } = {}) {
    if (isBlank(value)) return required ? "Required" : "";
    const v = Array.isArray(value) ? value : String(value).trim();
    switch (kind) {
      case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Enter a valid email address";
      case "integer": return /^-?[\d,]+$/.test(v) ? "" : "Whole numbers only";
      case "decimal": return /^-?[\d,]*\.?\d+$/.test(v) ? "" : "Numbers only";
      case "date": return toZohoDate(v) ? "" : "Enter a valid date";
      case "datetime": return /^\d{4}-\d{2}-\d{2}/.test(v) ? "" : "Enter a valid date";
      default:
        if (maxChar && typeof v === "string" && v.length > maxChar) return `Too long — at most ${maxChar} characters`;
        return "";
    }
  }

  /** File name shown to the client for a stored Creator file path ("…?filepath=1781774815047528_tenor.gif"). */
  function fileName(path) {
    const s = String(path || "");
    const fp = /filepath=([^&]+)/.exec(s);
    const base = decodeURIComponent(fp ? fp[1] : s.split("/").pop() || s);
    const us = base.indexOf("_");
    return us > 0 && /^\d+$/.test(base.slice(0, us)) ? base.slice(us + 1) : base;
  }

  /* Comparable form of an input value (dirty tracking). */
  const comparable = (v) => (Array.isArray(v) ? v.slice().sort().join("\u0001") : String(v ?? "").trim());

  global.PortalValues = { kindOf, learnKind, choicesOf, fromZoho, toZoho, validate, fileName, comparable, isBlank, parseZohoDate, toZohoDate };
})(window);
