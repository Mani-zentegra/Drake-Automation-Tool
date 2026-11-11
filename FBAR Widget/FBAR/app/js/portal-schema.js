/*
 * Client tax organizer — module layout, transcribed from "ALL DS FORMS.txt" (Creator export, 11-Nov-2026).
 *
 * This file only decides WHERE and HOW fields are shown to the client (step order, sections, friendly
 * labels, help text, when a section is relevant). It does not define fields: every link name below is
 * checked at start-up against ZOHO.CREATOR.META.getFields, and field types / picklist choices / required
 * flags always come from that live metadata. A link name that Creator does not have stops the widget with
 * a clear message — nothing is invented, skipped or replaced by demo data.
 *
 * Field entry:  "Link_Name"  or  { name, label?, help?, dateOnly?, wide? }
 * Section:      { id, title, intro?, fields: [...] }  or  { id, title, intro?, grid: "Subform_Link_Name", columns?: {...} }
 *               showIf(values) -> boolean  hides a section that does not apply (its values are kept and still saved)
 */
(function (global) {
  "use strict";

  const STATUS_NEEDS_DAYS = (v) => {
    const s = String(v.Residential_Status || "");
    return s !== "" && s !== "US Citizen" && s !== "Green Card Holder";
  };
  const isYes = (v, field) => String(v[field] || "") === "Yes";
  const MARRIED = ["Married Filing Jointly", "Married Filing Separately"];

  const MODULES = [
    {
      id: "personal",
      title: "Personal Information",
      short: "Personal Info",
      form: "Personal_Info",
      report: "All_Personal_Infos",
      clientLink: null,                 // this record IS the client
      intro: "Tell us who is filing. This is the base of your tax return — the other steps are linked to it.",
      // Staff-only fields in Personal_Info: never shown to or changed by the client (kept as they are in Zoho).
      internal: ["Drake_Status", "Drake_Message", "Taxpayer_Full_Name", "Spouse_Full_Name"],
      sections: [
        { id: "filing", title: "Filing Status", fields: [{ name: "Filing_Status", help: "Choose how you will file for the tax year." }] },
        {
          id: "taxpayer", title: "Taxpayer Information",
          fields: ["Taxpayer_First_Name", "Taxpayer_Middle_Name", "Taxpayer_Last_Name",
            "Taxpayer_DOB", { name: "Taxpayer_SSN", label: "Social Security Number" }, "Taxpayer_Occupation",
            "Taxpayer_Main_Phone", "Taxpayer_Other_Phone", "Taxpayer_Email"],
        },
        {
          id: "spouse", title: "Spouse Information",
          intro: "Only needed when you are married.",
          showIf: (v) => MARRIED.includes(String(v.Filing_Status || "")),
          fields: ["Spouse_First_Name", "Spouse_Middle_Name", "Spouse_Last_Name",
            "Spouse_DOB", { name: "Spouse_SSN_ITIN", label: "Spouse Social Security / ITIN" }, "Spouse_Occupation",
            "Spouse_Main_Phone", "Spouse_Other_Phone", "Spouse_Email"],
        },
        {
          id: "address", title: "Mailing Address",
          fields: [{ name: "Mailing_Address", label: "Street address", wide: true }, "City", "State_Field", { name: "Zip", label: "ZIP code" }],
        },
        { id: "residency", title: "Your Residential Status", fields: ["Residential_Status"] },
        {
          id: "days", title: "Days present in the US",
          intro: "Required for non-citizens who are not Green Card holders.",
          showIf: STATUS_NEEDS_DAYS,
          fields: ["Days_Present_in_US_2025", "Days_Present_in_US_2024", "Days_Present_in_US_2023"],
        },
        {
          id: "deposit", title: "Direct Deposit for Refunds / Debits",
          intro: "Where the IRS should send a refund, or take a payment from.",
          fields: ["Bank_Name", { name: "Routing_Number", label: "Routing number" }, "Account_Number", "Account_Type"],
        },
      ],
    },
    {
      id: "dependents",
      title: "Dependents",
      short: "Dependents",
      form: "Dependents",
      report: "All_Dependents",
      clientLink: "Tax_Payer_Full_name",
      intro: "Add each child or other dependent you support. Leave the list empty if you have none.",
      sections: [
        {
          id: "list", title: "Dependents Information", grid: "Dependents_Information",
          addLabel: "Add a dependent", itemLabel: "Dependent",
          columns: {
            Dependents_Name: { label: "Full name" },
            Date_of_Birth: { dateOnly: true },
            Social_Security_ITIN: { label: "SSN / ITIN" },
            Mos_In_Home: { label: "Months in your home", help: "Months the dependent lived with you during the year (0–12)." },
          },
        },
        { id: "notes", title: "Notes to Preparer", fields: [{ name: "Notes_to_Preparer", label: "Anything else we should know?", wide: true }] },
      ],
    },
    {
      id: "additional",
      questions: true,                  // yes/no questionnaire: every answer lines up in one column
      title: "Additional Information",
      short: "Additional Info",
      form: "Additional_Information",
      report: "All_Additional_Information",
      clientLink: "Tax_Payer_Full_name",
      intro: "A few yes/no questions that tell us which parts of your return apply to you.",
      sections: [
        {
          id: "foreign", title: "Foreign accounts",
          fields: [
            "Do_you_have_a_foreign_bank_account",
            { name: "Country_of_Foreign_Account", showIf: (v) => isYes(v, "Do_you_have_a_foreign_bank_account") },
            { name: "Are_you_required_to_file_for_FBAR", showIf: (v) => isYes(v, "Do_you_have_a_foreign_bank_account"),
              help: "FBAR is required when the combined highest balance of your foreign accounts was over $10,000 at any time in the year." },
            { name: "Would_you_want_us_to_file_for_FBAR", showIf: (v) => isYes(v, "Do_you_have_a_foreign_bank_account") },
            { name: "FBAR_for", showIf: (v) => isYes(v, "Do_you_have_a_foreign_bank_account") },
          ],
        },
        {
          id: "income", title: "Income and assets",
          fields: [
            { name: "Do_you_have_self_employment_income", label: "Do you have self-employment income (1099-NEC, 1099-K or cash)?" },
            { name: "Did_you_receive_sell_exchange_gift_or_acquire_financial_interest_in_Digital_Asset",
              label: "Did you receive, sell, exchange, gift or acquire a financial interest in a digital asset (e.g. crypto)?" },
            "Do_you_own_Foreign_Mutual_Funds",
            "Do_you_have_rental_property",
          ],
        },
        {
          id: "health", title: "Health insurance",
          fields: [
            { name: "Drop_DownDid_you_and_family_have_health_insurance", label: "Did you and your family have health insurance?" },
            { name: "Upload_1095A_if_Market_Place_coverage", label: "Form 1095-A (only for Marketplace coverage)",
              help: "Upload it if your insurance was bought through the Health Insurance Marketplace." },
          ],
        },
        { id: "lived", title: "States lived in during the tax year", grid: "States_lived_in_during_the_tax_year", addLabel: "Add a state", itemLabel: "State" },
        { id: "worked", title: "States worked in during the tax year", grid: "States_worked_in_during_the_tax_year", addLabel: "Add a state", itemLabel: "State" },
      ],
    },
    {
      id: "checklist",
      title: "Checklist",
      short: "Checklist",
      form: "Checklist",
      report: "All_Checklist",
      clientLink: "Tax_Payer_Full_name",
      intro: "List your W-2s and 1099-INTs and upload a copy of each document.",
      sections: [
        {
          id: "w2", title: "W-2 (wages)", grid: "W2", addLabel: "Add a W-2", itemLabel: "W-2",
          columns: { Type_field: { label: "Whose W-2" }, Company_Name: { label: "Employer / company name" } },
          // Lookups to Personal_Info inside each row: filled automatically with this client's record.
          autoLookups: true,
        },
        {
          id: "int", title: "1099-INT (interest income)", grid: "Interest_Income", addLabel: "Add a 1099-INT", itemLabel: "1099-INT",
          columns: { Type_field: { label: "Whose 1099-INT" } },
          autoLookups: true,
        },
      ],
    },
    {
      id: "taxes",
      title: "Taxes (Estimated Tax)",
      short: "Taxes",
      form: "Estimated_Tax",
      report: "All_Taxes",
      // Estimated_Tax has no field that links a record to the client (see ALL DS FORMS.txt). This is the lookup the
      // other forms use; the start-up check reports clearly if Creator does not have it, and the step stays closed.
      clientLink: "Tax_Payer_Full_name",
      intro: "Record each federal estimated tax payment you made, with the payment confirmation.",
      sections: [
        {
          id: "federal", title: "Federal estimated tax payments", grid: "FEDERAL_ESTIMATED_TAX_PAYMENTS", addLabel: "Add a payment", itemLabel: "Payment",
          columns: { Date_Time: { label: "Date paid" }, Installment_Paid: { label: "Payment confirmation" } },
        },
      ],
    },
    {
      id: "fbar",
      title: "FBAR",
      short: "FBAR",
      custom: "fbar",                   // the existing FBAR app (fbar-*.js), unchanged
      intro: "Foreign bank and financial accounts (FinCEN Form 114).",
    },
  ];

  global.PORTAL_SCHEMA = Object.freeze({ MODULES });
})(window);
