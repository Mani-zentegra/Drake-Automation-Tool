SAMPLE TEST PACKETS (2025) - all people, SSNs (900-xx test range), EINs and amounts are FICTITIOUS.

Sample1_Nguyen_Single  (5 pages)  W-2 x2 (box 12 D/DD/W, state ID), 1099-INT, 1098-E, 1098-T (graduate box ticked)
Sample2_Okafor-Lindqvist_MFJ (11 pages)  client cover letter (should be ignored), W-2 taxpayer + W-2 spouse,
        1099-NEC, 1099-MISC (rents), 1099-K (spouse), 1099-G (state refund), 1098 (property tax in box 10),
        1099-SA, 5498-SA, 1099-Q
Sample3_Delgado_Retiree (9 pages)  SSA-1099, 1099-R pension + 1099-R IRA (IRA box ticked), 1099-INT Treasury (box 3),
        1099-DIV (foreign tax, 199A, exempt-interest), CORRECTED 1099-INT, W-2G, 5498 (RMD), 1099-OID all zero

Each PDF has a matching *_answer_key.csv (page, form, field, expected value).

Check the extractor:  python tests/check_samples.py tests/sample_packets   (run from Tax_Extraction_Tool)
Make more / change values:  python make_samples.py <output folder>    (needs reportlab)

Result with the current taxflow extractor (2026-11-06): 176 of 181 values correct, every form detected,
cover page ignored, zero-value 1099-OID flagged. Known extractor gaps:
  1. 1099-NEC box 1 reads 5000.00 (picks up "$5,000" from the box 2 label text)
  2. 1099-K recipient TIN not read (label "PAYEE'S TIN" not in catalog)
  3. 1099-SA box 3 distribution code reads "4" (the next box number) instead of "1"
  4. 1099-SA box 5 account type reads "ARCHER MSA" instead of the ticked HSA box
  5. 1099-Q payer TIN not read (label "PAYER'S/TRUSTEE'S TIN" not in catalog)
