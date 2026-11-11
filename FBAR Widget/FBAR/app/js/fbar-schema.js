/*
 * FBAR subform schema — the columns of the "owned separately" and "owned jointly" subforms.
 *
 * Source: "2024 Personal Tax Organizer.xlsx", sheets "FBAR - Taxpayer" and "FBAR - Spouse".
 *   In the workbook every account is a column (Account 1–10); here every account is a ROW and every
 *   spreadsheet row becomes a COLUMN. `row` / `jointRow` keep the link to the spreadsheet row.
 *   `zoho` = Zoho Creator subform field link name — filled in during the integration phase.
 *
 * Column kinds
 *   money     amount in Rupees                            usd       calculated US$ (read only) = money / rate
 *   choice    dropdown                                    yesno     Yes / No dropdown
 *   combo     dropdown that also accepts a typed value    rate      exchange rate (Rupees per US$)
 *   text      free text                                   tin       SSN / TIN
 *
 * Picklist values come from FBAR_CONFIG (= the FBAR1 form definition); the Zoho link names live in
 * FBAR_CONFIG.columns, not here.
 */
(function (global) {
  "use strict";

  const PICK = global.FBAR_CONFIG.picklists;
  const DEFAULT_RATE = 85.577;       // organizer default (B31:K31, B55:K55)
  const FBAR_THRESHOLD_USD = 10000;

  const OPTIONS = {
    // "Other" is the UI side of the picklist's "others option" (the typed text is what Zoho stores).
    accountType: PICK.accountType.concat("Other"),
    yesNo: ["No", "Yes"],
    relationship: PICK.relationship.slice(),
  };

  /* Header groups (shown above the column headers). */
  const GROUPS = {
    max: "Maximum value of the account",
    type: "Account type & status",
    inst: "Financial institution",
    income: "Interest, dividends & tax",
    fx: "Currency",
    joint: "Joint owner",
  };

  /*
   * Column order = the order requested (1–19), joint-owner columns appended for the joint subform.
   * `label` may be a function (person) => text where the two sheets word a row differently.
   */
  const ACCOUNT_COLUMNS = [
    { key: "maxValue", group: "max", label: "Maximum Value of the Account in Rupees", kind: "money", required: true, width: 170, row: 11, jointRow: 35,
      help: "Highest balance during the year. For life insurance, state the cash value." },
    { key: "maxValueUsd", group: "max", label: "Maximum Value of the Account in US$", kind: "usd", of: "maxValue", roundUp: true, width: 150, row: 12, jointRow: 36,
      help: "Maximum value ÷ exchange rate, rounded up to the next whole dollar." },
    { key: "accountType", group: "type", label: "Type of Account", kind: "choice", options: OPTIONS.accountType, required: true, width: 150, row: 13, jointRow: 37,
      placeholder: "Select" },
    { key: "otherDetails", group: "type", label: "If Other, Mention Details", kind: "text", width: 210, row: 14, jointRow: 38,
      enabledIf: { accountType: "Other" }, requiredIf: { accountType: "Other" }, placeholder: "e.g. Life insurance policy" },
    { key: "openedInYear", group: "type", label: "Account Opened During Tax Year", kind: "yesno", default: "No", placeholder: "Select", width: 130, row: 15, jointRow: 39 },
    { key: "closedInYear", group: "type", label: "Account Closed During Tax Year", kind: "yesno", default: "No", placeholder: "Select", width: 130, row: 16, jointRow: 40 },
    { key: "institutionName", group: "inst", label: "Name of the Financial Institution", kind: "text", required: true, width: 230, row: 17, jointRow: 41,
      placeholder: "e.g. State Bank of India" },
    { key: "accountNumber", group: "inst", label: "Account Number", kind: "text", required: true, mono: true, width: 180, row: 18, jointRow: 42 },
    { key: "address1", group: "inst", label: "Address Line 1", kind: "text", required: true, width: 220, row: 20, jointRow: 44, placeholder: "Branch, street" },
    { key: "address2", group: "inst", label: "Address Line 2", kind: "text", width: 200, row: 21, jointRow: 45, placeholder: "Area, city" },
    { key: "address3", group: "inst", label: "Address Line 3", kind: "text", width: 200, row: 22, jointRow: 46, placeholder: "State, PIN, country" },
    { key: "interest", group: "income", label: "Interest Received/Accrued in Rupees", kind: "money", width: 160, row: 23, jointRow: 47 },
    { key: "interestUsd", group: "income", label: "Interest Received/Accrued in US$", kind: "usd", of: "interest", width: 140, row: 24, jointRow: 48 },
    { key: "dividends", group: "income", kind: "money", width: 170, row: 25, jointRow: 49,
      label: (p) => p === "spouse" ? "Dividend/Capital Gains Distributed in Rupees" : "Dividend Distributed in Rupees" },
    { key: "dividendsUsd", group: "income", kind: "usd", of: "dividends", width: 150, row: 26, jointRow: 50,
      label: (p) => p === "spouse" ? "Dividend/Capital Gains Distributed in US$" : "Dividend Distributed in US$" },
    { key: "taxPaid", group: "income", label: "Tax Paid Outside US in Rupees", kind: "money", width: 160, row: 27, jointRow: 51 },
    { key: "taxPaidUsd", group: "income", label: "Tax Paid Outside US in US$", kind: "usd", of: "taxPaid", width: 140, row: 28, jointRow: 52 },
    { key: "currency", group: "fx", label: "Foreign Currency Account Maintained", kind: "choice", placeholder: "Select", width: 150, row: 30, jointRow: 54 },
    { key: "exchangeRate", group: "fx", label: "Exchange Rate Used (Rupees/US$)", kind: "rate", default: DEFAULT_RATE, required: true, width: 150, row: 31, jointRow: 55 },
  ];

  const JOINT_COLUMNS = [
    { key: "jointRelationship", group: "joint", label: "Joint Owner Relationship", kind: "combo", options: OPTIONS.relationship, width: 160, jointRow: 56,
      placeholder: "Select or type", help: "Pick a relationship or type another one." },
    { key: "jointFirstName", group: "joint", label: "Joint Owner First Name", kind: "text", required: true, width: 170, jointRow: 57 },
    { key: "jointLastName", group: "joint", label: "Joint Owner Last Name", kind: "text", required: true, width: 170, jointRow: 58 },
    { key: "jointTin", group: "joint", label: "Joint Owner SSN or TIN", kind: "tin", mono: true, width: 170, jointRow: 59,
      placeholder: "XXX-XX-XXXX", help: "US SSN/ITIN, or the foreign tax ID (e.g. PAN) if there is none." },
  ];

  const SUBFORMS = [
    { id: "separate", title: "Financial Accounts Owned Separately", columns: ACCOUNT_COLUMNS, sheetRows: "10–31" },
    { id: "joint", title: "Financial Accounts Owned Jointly", columns: ACCOUNT_COLUMNS.concat(JOINT_COLUMNS), sheetRows: "34–59" },
  ];

  const PERSONS = [
    { id: "taxpayer", label: "FBAR - Taxpayer", sheet: "FBAR - Taxpayer" },
    { id: "spouse", label: "FBAR - Spouse", sheet: "FBAR - Spouse",
      note: "Fill in only if the spouse's financial assets exceed the $10,000 maximum limit." },
  ];

  const NOTES = [
    "For life insurance, state the cash value in the maximum value of the account.",
    "If the filer has signature authority on any account and no financial interest in the account, such accounts are to be detailed as well.",
    "Enter Rupees and it will be converted to US$ with the exchange rate.",
    "Account opened and closed default to No — change to Yes as necessary.",
    { text: "If you have foreign mutual funds you will need to file PFIC Form 8621. Reach out to the office for the worksheet and details.", only: "taxpayer" },
  ];

  let uidSeq = 0;
  /** New, independent row with the spreadsheet defaults. Each row gets a stable id (later: the Zoho subform row ID). */
  function newRow(subformId, values) {
    const sf = SUBFORMS.find((s) => s.id === subformId);
    // _uid: stable id inside the widget; _zohoId: subform row ID in Zoho (null until saved);
    // _address: the full Zoho address object, so hidden parts (state, postal code, country…) survive an update.
    const row = { _uid: "r" + (++uidSeq), _zohoId: null, _address: null, _extra: null };
    sf.columns.forEach((c) => { if (c.kind !== "usd") row[c.key] = c.default !== undefined ? c.default : ""; });
    return Object.assign(row, values || {});
  }

  const labelOf = (col, personId) => (typeof col.label === "function" ? col.label(personId) : col.label);

  const toNumber = (v) => { const n = parseFloat(String(v ?? "").replace(/[,\s]/g, "")); return Number.isFinite(n) ? n : 0; };

  /*
   * US$ value of a row = Rupees / exchange rate. The maximum value is rounded UP to the whole dollar
   * (FBAR rule); income and tax are rounded to cents. The UI and the Zoho payload both use this.
   */
  function usdValue(row, usdCol) {
    const rate = toNumber(row.exchangeRate);
    const raw = row[usdCol.of];
    if (!(rate > 0) || raw === undefined || raw === null || String(raw).trim() === "") return 0;
    const value = toNumber(raw) / rate;
    return usdCol.roundUp ? Math.ceil(value) : Math.round(value * 100) / 100;
  }

  /*
   * Choices of Foreign_Currency_Account_Maintained, per subform ("taxpayer.separate", ...), exactly as
   * Zoho Creator has them (read from META.getFields at start-up). Each subform has its own picklist in
   * Creator, so the lists are kept apart. There is no built-in list.
   */
  const currencyChoices = {};
  function setCurrencyChoices(person, section, values) { currencyChoices[`${person}.${section}`] = values.slice(); }
  const currencyChoicesFor = (person, section) => currencyChoices[`${person}.${section}`] || [];

  /** The options a choice column offers in one subform. */
  const choicesFor = (col, person, section) => (col.key === "currency" ? currencyChoicesFor(person, section) : col.options);

  global.FBAR_SCHEMA = Object.freeze({
    DEFAULT_RATE, FBAR_THRESHOLD_USD, OPTIONS, GROUPS, SUBFORMS, PERSONS, NOTES,
    newRow, labelOf, usdValue, toNumber, setCurrencyChoices, currencyChoicesFor, choicesFor,
  });
})(window);
