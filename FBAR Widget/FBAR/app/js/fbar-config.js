/*
 * Zoho Creator configuration for the FBAR widget.
 *
 * Every link name below was taken from the form definition of FBAR1 ("form FBAR1.txt") and from the
 * existing project config (Personal_Info / All_Personal_Infos in services/zoho_api.py).
 * At start-up fbar-service.js checks these names against the live Creator metadata and stops with a
 * clear message if anything is missing — nothing is skipped silently and there are no fallbacks.
 */
(function (global) {
  "use strict";

  const FBAR_CONFIG = {
    // App link name comes from ZOHO.CREATOR.UTIL.getInitParams() at runtime.
    forms: {
      fbar: "FBAR1",
      personalInfo: "Personal_Info",
    },

    reports: {
      personalInfo: "All_Personal_Infos",
      // Report of form FBAR1 (confirmed by the app owner). Checked against META.getReports() at start-up.
      fbar: "FBAR1_Report",
    },

    // Parent-level fields of FBAR1.
    parentFields: {
      taxpayer: "Tax_Payer_Full_name",    // lookup -> Personal_Info record ID
      taxYear: "Tax_Year",                 // single line text
      spouse: "Spouse_Full_name",          // lookup -> Personal_Info record ID
    },

    /*
     * Personal_Info fields that make up the names shown in the Taxpayer / Spouse dropdowns.
     * Personal_Info has no single full-name field; the names are stored in parts. These link names are
     * the ones already mapped from Personal_Info in config/field_mappings.json and are re-checked against
     * META.getFields at start-up. The label is the non-empty parts joined with spaces ("Abdul R Basith");
     * the FBAR lookups still store only the Personal_Info record ID.
     */
    personalInfoFields: {
      taxpayerName: ["Taxpayer_First_Name", "Taxpayer_Middle_Name", "Taxpayer_Last_Name"],
      spouseName: ["Spouse_First_Name", "Spouse_Middle_Name", "Spouse_Last_Name"],
    },

    // UI person + section -> FBAR1 subform (grid) link name.
    subforms: {
      taxpayer: { separate: "Taxpayer_Separately", joint: "Taxpayer_Jointly" },
      spouse: { separate: "Spouse_Separately", joint: "Spouse_Jointly" },
    },

    /*
     * Subform columns: UI key -> Zoho column link name.
     * `kind` tells the mapper how to convert the value; `jointOnly` columns exist only in *_Jointly.
     */
    columns: [
      { key: "maxValue", zoho: "Maximum_value_of_the_account_in_Rupees", kind: "number" },
      { key: "maxValueUsd", zoho: "Maximum_value_of_the_account_in_US", kind: "usd" },
      // Picklist Bank / Securities with "others option": a typed "other" value is stored as the value itself,
      // so the UI's Type of Account + "If Other, Mention Details" pair maps onto this one field.
      { key: "accountType", zoho: "Type_of_Account", kind: "accountType" },
      { key: "openedInYear", zoho: "Account_Opened_During_Tax_Year", kind: "text" },
      { key: "closedInYear", zoho: "Account_Closed_During_Tax_Year", kind: "text" },
      { key: "institutionName", zoho: "Name_of_the_Financial_Institution", kind: "text" },
      { key: "accountNumber", zoho: "Account_Number", kind: "text" },
      { key: "address", zoho: "Address", kind: "address" },
      { key: "interest", zoho: "Interest_Received_Accrued_in_Rupees", kind: "number" },
      { key: "interestUsd", zoho: "Interest_Received_Accrued_in_US", kind: "usd" },
      { key: "dividends", zoho: "Dividend_Distributed_in_Rupees", kind: "number" },
      { key: "dividendsUsd", zoho: "Dividend_Distributed_in_US", kind: "usd" },
      { key: "taxPaid", zoho: "Tax_Paid_Outside_US_in_Rupees", kind: "number" },
      { key: "taxPaidUsd", zoho: "Tax_Paid_Outside_US_in_US", kind: "usd" },
      { key: "currency", zoho: "Foreign_Currency_Account_Maintained", kind: "text" },
      { key: "exchangeRate", zoho: "Exchange_Rate_Used_Rupees_US", kind: "number" },
      { key: "jointRelationship", zoho: "Joint_Owner_Relationship", kind: "text", jointOnly: true },
      { key: "jointFirstName", zoho: "Joint_Owner_First_Name", kind: "text", jointOnly: true },
      { key: "jointLastName", zoho: "Joint_Owner_Last_Name", kind: "text", jointOnly: true },
      { key: "jointTin", zoho: "Joint_Owner_SSN_or_TIN", kind: "text", jointOnly: true },
    ],

    // Address sub-fields shown in the UI. district_city is labelled "Address Line 3" in FBAR1.
    // The hidden parts (state_province, postal_Code, country, latitude, longitude) are kept as received.
    addressParts: { address1: "address_line_1", address2: "address_line_2", address3: "district_city" },

    // Picklist values exactly as defined in FBAR1.
    picklists: {
      accountType: ["Bank", "Securities"],
      yesNo: ["Yes", "No"],
      // Foreign_Currency_Account_Maintained has no list here on purpose: its choices are read from Zoho
      // (META.getFields) for each subform at start-up, so changes made in Creator show up without a code change.
      relationship: ["Spouse", "Father", "Mother", "Son", "Daughter", "Sibling"],
    },

    requestTimeoutMs: 30000,
    pageSize: 200,
  };

  global.FBAR_CONFIG = Object.freeze(FBAR_CONFIG);
})(window);
