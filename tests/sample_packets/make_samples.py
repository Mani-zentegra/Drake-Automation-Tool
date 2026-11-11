"""Generate fictitious IRS-style 2025 tax packets for testing the Drake extraction tool.
All names, SSNs (900-series / 000 test ranges), EINs and amounts are invented."""
import csv, os, sys
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)
W, H = letter
M = 36            # margin

def money(v):
    return f"{v:,.2f}"

class Packet:
    def __init__(self, name):
        self.name = name
        self.c = canvas.Canvas(os.path.join(OUT, name + ".pdf"), pagesize=letter)
        self.c.setTitle(name.replace("_", " "))
        self.page = 0
        self.key = []        # (page, form, field, expected)

    def new_page(self):
        if self.page:
            self.c.showPage()
        self.page += 1

    def expect(self, form, field, value):
        self.key.append((self.page, form, field, value))

    def save(self):
        self.c.save()
        with open(os.path.join(OUT, self.name + "_answer_key.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["page", "form", "field", "expected_value"])
            w.writerows(self.key)

    # ---------- drawing primitives
    def cell(self, x, y, w, h, label, value="", align="right", vsize=9, check=None):
        c = self.c
        c.setLineWidth(0.6); c.rect(x, y, w, h)
        fs = 6.2
        avail = w - 5 - (14 if check is not None else 0)
        lines = []
        for para in label.split("\n"):
            cur = ""
            for word in para.split(" "):
                t = (cur + " " + word).strip()
                if c.stringWidth(t, "Helvetica", fs) <= avail or not cur:
                    cur = t
                else:
                    lines.append(cur); cur = word
            lines.append(cur)
        step = 7 if len(lines) <= 2 or h >= 30 else 6.1
        c.setFont("Helvetica", fs if step == 7 else 5.6)
        for i, ln in enumerate(lines):
            c.drawString(x + 2.5, y + h - 7.5 - i * step, ln)
        if check is not None:
            bx = x + w - 12
            c.rect(bx, y + h - 11, 7, 7)
            if check:
                c.setFont("Helvetica-Bold", 7.5); c.drawString(bx + 1.2, y + h - 10.2, "X")
        if value != "":
            c.setFont("Courier-Bold", vsize)
            vy = y + 4 if h < 30 else y + h - 9 - 7 * len(lines) - 4
            vals = value.split("\n") if isinstance(value, str) else [value]
            for i, v in enumerate(vals):
                if align == "right":
                    c.drawRightString(x + w - 4, vy - i * 10, v)
                else:
                    c.drawString(x + 4, vy - i * 10, v)

    def header(self, form_no, title, y_top, corrected=False, omb="", copy="Copy B — For Recipient"):
        c = self.c
        c.setFont("Helvetica", 7)
        c.rect(M, y_top + 2, 7, 7); c.drawString(M + 10, y_top + 3, "VOID")
        c.rect(M + 40, y_top + 2, 7, 7)
        if corrected:
            c.setFont("Helvetica-Bold", 7.5); c.drawString(M + 41.2, y_top + 2.8, "X"); c.setFont("Helvetica", 7)
        c.drawString(M + 50, y_top + 3, "CORRECTED")
        c.setFont("Helvetica", 7); c.drawRightString(W - M, y_top + 40, omb)
        c.setFont("Helvetica-Bold", 18); c.drawRightString(W - M, y_top + 22, "2025")
        c.setFont("Helvetica", 8); c.drawRightString(W - M - 52, y_top + 26, "Form")
        c.setFont("Helvetica-Bold", 11); c.drawRightString(W - M - 52, y_top + 14, form_no)
        fs = 10
        while fs > 6 and c.stringWidth(title, "Helvetica-Bold", fs) > (W - M) - (M + 110):
            fs -= 0.5
        c.setFont("Helvetica-Bold", fs); c.drawRightString(W - M, y_top + 3, title)
        c.setFont("Helvetica", 7); c.drawRightString(W - M, y_top - 8, copy)

    def footer(self, form_no, y):
        c = self.c
        c.setFont("Helvetica", 7)
        c.drawString(M, y, f"Form {form_no}")
        c.drawRightString(W - M, y, "Department of the Treasury - Internal Revenue Service")

    # ---------- generic information return: left party block + right box grid
    def info_return(self, form, title, omb, left, boxes, cols=2, corrected=False, notes=None,
                    party_label="PAYER'S name, street address, city or town, state or province, country, ZIP\nor foreign postal code, and telephone no."):
        """left: dict(payer=[lines], payer_tin, recip_tin, recip_name, street, city, account, labels...)
           boxes: list of (label, value_str, expected_key, expected_value) ; value_str '' = blank"""
        self.new_page()
        top = H - 70
        self.header(form, title, top, corrected, omb)
        y0 = top - 14
        lw = 270
        L = left
        lab = L.get("labels", {})
        # left column
        self.cell(M, y0 - 74, lw, 74, party_label, "\n".join(L["payer"]), align="left")
        self.cell(M, y0 - 98, lw / 2, 24, lab.get("payer_tin", "PAYER'S TIN"), L["payer_tin"], align="left")
        self.cell(M + lw / 2, y0 - 98, lw / 2, 24, lab.get("recip_tin", "RECIPIENT'S TIN"), L["recip_tin"], align="left")
        self.cell(M, y0 - 128, lw, 30, lab.get("recip_name", "RECIPIENT'S name"), L["recip_name"], align="left")
        self.cell(M, y0 - 152, lw, 24, "Street address (including apt. no.)", L["street"], align="left")
        self.cell(M, y0 - 176, lw, 24, "City or town, state or province, country, and ZIP or foreign postal code", L["city"], align="left")
        self.cell(M, y0 - 200, lw, 24, "Account number (see instructions)", L.get("account", ""), align="left")
        # right grid
        gx = M + lw; gw = W - M - gx; cw = gw / cols; ch = 28
        rows = (len(boxes) + cols - 1) // cols
        for i, b in enumerate(boxes):
            label, val = b[0], b[1]
            chk = b[4] if len(b) > 4 else None
            r, k = divmod(i, cols)
            self.cell(gx + k * cw, y0 - (r + 1) * ch, cw, ch, label, val, check=chk)
        bottom = min(y0 - 200, y0 - rows * ch)
        self.footer(form, bottom - 12)
        y = bottom - 30
        for n in (notes or []):
            self.c.setFont("Helvetica", 7.2); self.c.drawString(M, y, n); y -= 10
        # answer key
        self.expect(form, "payer/filer name", L["payer"][0])
        self.expect(form, "payer TIN", L["payer_tin"])
        self.expect(form, "recipient TIN", L["recip_tin"])
        for b in boxes:
            if len(b) > 2 and b[2]:
                self.expect(form, b[2], b[3])

    # ---------- W-2 (IRS-like layout)
    def w2(self, d):
        self.new_page()
        c = self.c
        top = H - 60
        c.setFont("Helvetica-Bold", 8); c.drawRightString(W - M, top + 6, "Copy B—To Be Filed With Employee's FEDERAL Tax Return.")
        x, w = M, W - 2 * M
        lw = w * 0.5; rw = (w - lw) / 2; ch = 26
        y = top
        def row_r(y, l1, v1, l2, v2):
            self.cell(x + lw, y - ch, rw, ch, l1, v1); self.cell(x + lw + rw, y - ch, rw, ch, l2, v2)
        self.cell(x, y - ch, lw, ch, "a Employee's social security number", d["ssn"], align="left")
        row_r(y, "1 Wages, tips, other compensation", money(d["b1"]), "2 Federal income tax withheld", money(d["b2"]))
        y -= ch
        self.cell(x, y - ch, lw, ch, "b Employer identification number (EIN)", d["ein"], align="left")
        row_r(y, "3 Social security wages", money(d["b3"]), "4 Social security tax withheld", money(d["b4"]))
        y -= ch
        self.cell(x, y - 3 * ch, lw, 3 * ch, "c Employer's name, address, and ZIP code", "\n".join(d["employer"]), align="left")
        row_r(y, "5 Medicare wages and tips", money(d["b5"]), "6 Medicare tax withheld", money(d["b6"]))
        row_r(y - ch, "7 Social security tips", money(d.get("b7", 0)) if d.get("b7") else "", "8 Allocated tips", "")
        row_r(y - 2 * ch, "9", "", "10 Dependent care benefits", money(d["b10"]) if d.get("b10") else "")
        y -= 3 * ch
        self.cell(x, y - ch, lw, ch, "d Control number", d.get("control", ""), align="left")
        b12 = d.get("b12", [])
        def b12s(i):
            return f"{b12[i][0]}   {money(b12[i][1])}" if i < len(b12) else ""
        row_r(y, "11 Nonqualified plans", "", "12a See instructions for box 12", b12s(0))
        y -= ch
        self.cell(x, y - ch, lw, ch, "e Employee's first name and initial      Last name      Suff.", d["name"], align="left")
        # box 13 with checkboxes
        bx = x + lw; c.rect(bx, y - 2 * ch, rw, 2 * ch); c.setFont("Helvetica", 6.2)
        c.drawString(bx + 2.5, y - 7.5, "13")
        for i, (lbl, on) in enumerate([("Statutory employee", False), ("Retirement plan", d.get("ret", False)), ("Third-party sick pay", False)]):
            yy = y - 20 - i * 10
            c.rect(bx + 4, yy, 6, 6)
            if on:
                c.setFont("Helvetica-Bold", 6.5); c.drawString(bx + 4.9, yy + 0.6, "X"); c.setFont("Helvetica", 6.2)
            c.drawString(bx + 13, yy + 1, lbl)
        self.cell(x + lw + rw, y - ch, rw, ch, "12b", b12s(1))
        self.cell(x + lw + rw, y - 2 * ch, rw, ch, "12c", b12s(2))
        y -= ch
        self.cell(x, y - 2 * ch, lw, 2 * ch, "f Employee's address and ZIP code", "\n".join(d["addr"]), align="left")
        y -= ch
        y -= ch
        self.cell(x + lw, y - ch, rw, ch, "14 Other", d.get("b14", ""), align="left")
        self.cell(x + lw + rw, y - ch, rw, ch, "12d", b12s(3))
        y -= ch
        # state row
        sw = w / 6
        st = d.get("state")
        labels = ["15 State", "Employer's state ID number", "16 State wages, tips, etc.", "17 State income tax", "18 Local wages, tips, etc.", "19 Local income tax"]
        vals = [st[0], st[1], money(st[2]), money(st[3]), "", ""] if st else [""] * 6
        for i in range(6):
            self.cell(x + i * sw, y - ch, sw, ch, labels[i], vals[i], align="left" if i < 2 else "right")
        y -= ch
        self.cell(x, y - ch, sw * 2, ch, "20 Locality name", "", align="left")
        c.setFont("Helvetica", 8); c.drawString(x, y - ch - 14, "Form")
        c.setFont("Helvetica-Bold", 14); c.drawString(x + 22, y - ch - 15, "W-2")
        c.setFont("Helvetica", 9); c.drawString(x + 55, y - ch - 14, "Wage and Tax Statement")
        c.setFont("Helvetica-Bold", 14); c.drawString(x + 230, y - ch - 15, "2025")
        c.setFont("Helvetica", 7); c.drawRightString(W - M, y - ch - 14, "Department of the Treasury—Internal Revenue Service")
        f = "W-2"
        self.expect(f, "employee SSN", d["ssn"]); self.expect(f, "employer EIN", d["ein"]); self.expect(f, "employer name", d["employer"][0])
        for k in ("b1", "b2", "b3", "b4", "b5", "b6"):
            self.expect(f, "box" + k[1:], money(d[k]))
        if d.get("b10"): self.expect(f, "box10", money(d["b10"]))
        for i, (code, amt) in enumerate(b12):
            self.expect(f, f"box12{'abcd'[i]}", f"{code} {money(amt)}")
        self.expect(f, "box13 retirement plan", "checked" if d.get("ret") else "not checked")
        if st:
            self.expect(f, "box15 state", st[0]); self.expect(f, "box16", money(st[2])); self.expect(f, "box17", money(st[3]))

    # ---------- SSA-1099 (statement style labels "Box 3. Benefits Paid in 2025")
    def ssa1099(self, d):
        self.new_page()
        c = self.c
        top = H - 60
        c.setFont("Helvetica-Bold", 12); c.drawString(M, top, "FORM SSA-1099 – SOCIAL SECURITY BENEFIT STATEMENT")
        c.setFont("Helvetica-Bold", 14); c.drawRightString(W - M, top, "2025")
        c.setFont("Helvetica", 8); c.drawString(M, top - 12, "PART OF YOUR SOCIAL SECURITY BENEFITS SHOWN IN BOX 5 MAY BE TAXABLE INCOME.")
        y = top - 30
        rows = [("Box 1. Name", d["name"]), ("Box 2. Beneficiary's Social Security Number", d["ssn"]),
                ("Box 3. Benefits Paid in 2025", money(d["b3"])), ("Box 4. Benefits Repaid to SSA in 2025", money(d["b4"])),
                ("Box 5. Net Benefits for 2025 (Box 3 minus Box 4)", money(d["b5"])),
                ("Box 6. Voluntary Federal Income Tax Withheld", money(d["b6"])),
                ("Box 7. Address", d["addr"]), ("Box 8. Claim Number (Use this number if you need to contact SSA.)", d["claim"])]
        for lbl, v in rows:
            self.cell(M, y - 30, W - 2 * M, 30, lbl, v, align="left", vsize=10); y -= 30
        c.setFont("Helvetica", 7.5)
        c.drawString(M, y - 14, "DESCRIPTION OF AMOUNT IN BOX 3: Paid by check or direct deposit " + money(d["b3"] - d["medicare"]) +
                     " · Medicare Part B premiums deducted from your benefits " + money(d["medicare"]))
        c.drawString(M, y - 26, "Form SSA-1099-SM (1-2026)    DO NOT RETURN THIS FORM TO SSA OR IRS")
        f = "SSA-1099"
        self.expect(f, "box2 SSN", d["ssn"]); self.expect(f, "box3", money(d["b3"])); self.expect(f, "box4", money(d["b4"]))
        self.expect(f, "box5", money(d["b5"])); self.expect(f, "box6", money(d["b6"]))

    def cover(self, title, lines):
        self.new_page()
        c = self.c
        c.setFont("Helvetica-Bold", 16); c.drawString(M, H - 90, title)
        c.setFont("Helvetica", 10)
        y = H - 120
        for ln in lines:
            c.drawString(M, y, ln); y -= 15
        self.expect("(cover page)", "should be ignored / UNKNOWN", "no tax form")


def L(payer, ptin, rtin, rname, street, city, account="", **labels):
    return dict(payer=payer, payer_tin=ptin, recip_tin=rtin, recip_name=rname, street=street, city=city, account=account, labels=labels)


# =====================================================================================
# Packet 1 — single young professional: two W-2s, student loan, tuition, marketplace, bank
# =====================================================================================
p = Packet("Sample1_Nguyen_Single_2025_Tax_Packet")
NG = dict(name="MAI T NGUYEN", ssn="900-45-1278", addr=["88 Larkspur Ct Apt 4B", "Boise, ID 83702"])
p.w2(dict(ssn=NG["ssn"], ein="47-3920115", employer=["NORTHWIND ANALYTICS LLC", "1200 W Main St", "Boise, ID 83702"],
          name=NG["name"], addr=NG["addr"], control="NW-0042",
          b1=61250.00, b2=6840.12, b3=64850.00, b4=4020.70, b5=64850.00, b6=940.33,
          b12=[("D", 3600.00), ("DD", 7212.48), ("W", 1000.00)], ret=True, state=("ID", "000918234", 61250.00, 2942.10)))
p.w2(dict(ssn=NG["ssn"], ein="82-1100457", employer=["SAWTOOTH OUTFITTERS INC", "45 River Rd", "Ketchum, ID 83340"],
          name=NG["name"], addr=NG["addr"], control="",
          b1=4180.50, b2=212.00, b3=4180.50, b4=259.19, b5=4180.50, b6=60.62, b7=0, ret=False,
          state=("ID", "000771003", 4180.50, 145.00)))
p.info_return("1099-INT", "Interest Income", "OMB No. 1545-0112",
              L(["IDAHO CENTRAL CREDIT UNION", "4400 Central Way", "Chubbuck, ID 83202", "(208) 555-0100"],
                "82-0301547", "***-**-1278", NG["name"], NG["addr"][0], NG["addr"][1], "****7719"),
              [("1 Interest income", money(412.87), "box1", money(412.87)), ("2 Early withdrawal penalty", ""),
               ("3 Interest on U.S. Savings Bonds and Treasury obligations", ""), ("4 Federal income tax withheld", ""),
               ("5 Investment expenses", ""), ("6 Foreign tax paid", ""), ("7 Foreign country or U.S. possession", ""),
               ("8 Tax-exempt interest", ""), ("9 Specified private activity bond interest", ""), ("10 Market discount", ""),
               ("11 Bond premium", ""), ("12 Bond premium on Treasury obligations", ""), ("13 Bond premium on tax-exempt bond", ""),
               ("17 State tax withheld", "")])
p.info_return("1098-E", "Student Loan Interest Statement", "OMB No. 1545-1576",
              L(["MOHELA", "633 Spirit Dr", "Chesterfield, MO 63005"], "43-1278905", "***-**-1278", NG["name"],
                NG["addr"][0], NG["addr"][1], "SL-55102",
                payer_tin="RECIPIENT'S/LENDER'S TIN", recip_tin="BORROWER'S TIN", recip_name="BORROWER'S name"),
              [("1 Student loan interest received by lender", money(1688.34), "box1", money(1688.34)),
               ("2 If checked, box 1 does not include loan origination fees\nand/or capitalized interest made before September 1, 2004", "", None, None, False)],
              cols=1, party_label="RECIPIENT'S/LENDER'S name, street address, city or town, state or province, country,\nZIP or foreign postal code, and telephone number")
p.info_return("1098-T", "Tuition Statement", "OMB No. 1545-1574",
              L(["BOISE STATE UNIVERSITY", "1910 University Dr", "Boise, ID 83725"], "82-6000952", "***-**-1278", NG["name"],
                NG["addr"][0], NG["addr"][1], "BSU-114402",
                payer_tin="FILER'S employer identification no.", recip_tin="STUDENT'S TIN", recip_name="STUDENT'S name"),
              [("1 Payments received for qualified tuition and related expenses", money(4890.00), "box1", money(4890.00)),
               ("2", ""), ("3", ""), ("4 Adjustments made for a prior year", ""),
               ("5 Scholarships or grants", money(1500.00), "box5", money(1500.00)), ("6 Adjustments to scholarships or grants for a prior year", ""),
               ("7 Checked if the amount in box 1 includes amounts for an\nacademic period beginning January-March 2026", "", None, None, False),
               ("8 Check if at least half-time student", "", "box8 half-time", "not checked", False),
               ("9 Check if graduate student", "", "box9 graduate", "checked", True), ("10 Ins. contract reimb./refund", "")],
              party_label="FILER'S name, street address, city or town, state or province, country, ZIP or\nforeign postal code, and telephone number")
p.save()

# =====================================================================================
# Packet 2 — married couple: W-2 x2 (T/S), 1099-NEC, 1099-MISC rents, 1099-K, 1099-G, 1098, HSA, 529, cover page
# =====================================================================================
p = Packet("Sample2_Okafor-Lindqvist_MFJ_2025_Tax_Packet")
TP = dict(name="CHIDI A OKAFOR", ssn="900-61-3307"); SP = dict(name="ELSA M LINDQVIST", ssn="900-61-8854")
ADDR = ["3390 Juniper Hill Rd", "Fort Collins, CO 80525"]
p.cover("2025 Tax Documents — Okafor / Lindqvist (Married Filing Jointly)",
        ["Prepared for: Chidi Okafor & Elsa Lindqvist", "Documents enclosed: 11", "Notes from client:",
         "  - Rental condo at 12 Aspen Way: 1099-MISC from property manager enclosed.",
         "  - Elsa's Etsy shop: 1099-K enclosed; expenses spreadsheet to follow.",
         "  - We used 529 money for our son's tuition in the fall.",
         "This page is a client cover letter and is not a tax form."])
p.w2(dict(ssn=TP["ssn"], ein="84-1022398", employer=["FRONT RANGE MEDICAL GROUP PC", "700 Mountain Ave", "Fort Collins, CO 80524"],
          name=TP["name"], addr=ADDR, control="FR-77120",
          b1=148320.00, b2=22104.66, b3=165400.00, b4=10254.80, b5=165400.00, b6=2398.30,
          b12=[("D", 17080.00), ("DD", 14980.20), ("W", 4300.00)], ret=True, b14="CO FAMLI 1,488.60",
          state=("CO", "21933475", 148320.00, 6526.08)))
p.w2(dict(ssn=SP["ssn"], ein="84-6000580", employer=["POUDRE SCHOOL DISTRICT R-1", "2407 Laporte Ave", "Fort Collins, CO 80521"],
          name=SP["name"], addr=ADDR, control="",
          b1=52764.12, b2=3910.00, b3=52764.12, b4=3271.38, b5=52764.12, b6=765.08,
          b12=[("E", 2400.00)], b10=2500.00, ret=True, state=("CO", "08119003", 52764.12, 2321.62)))
p.info_return("1099-NEC", "Nonemployee Compensation", "OMB No. 1545-0116",
              L(["LARIMER COUNTY HEALTH COOPERATIVE", "155 Peak Blvd", "Loveland, CO 80538"], "84-1789022", "***-**-3307",
                TP["name"], ADDR[0], ADDR[1], ""),
              [("1 Nonemployee compensation", money(9600.00), "box1", money(9600.00)),
               ("2 Payer made direct sales totaling $5,000 or more of consumer\nproducts to recipient for resale", "", "box2", "not checked", False),
               ("3 Excess golden parachute payments", ""), ("4 Federal income tax withheld", ""),
               ("5 State tax withheld", money(0.00)), ("6 State/Payer's state no.", "CO 41188"), ("7 State income", money(9600.00))])
p.info_return("1099-MISC", "Miscellaneous Information", "OMB No. 1545-0115",
              L(["ALPINE PROPERTY MANAGEMENT LLC", "21 College Ave Ste 300", "Fort Collins, CO 80524"], "84-3366104", "***-**-3307",
                "CHIDI A OKAFOR & ELSA M LINDQVIST", ADDR[0], ADDR[1], "UNIT-12ASPEN"),
              [("1 Rents", money(21600.00), "box1", money(21600.00)), ("2 Royalties", ""), ("3 Other income", money(350.00), "box3", money(350.00)),
               ("4 Federal income tax withheld", ""), ("5 Fishing boat proceeds", ""), ("6 Medical and health care payments", ""),
               ("7 Payer made direct sales", ""), ("8 Substitute payments in lieu of dividends or interest", ""),
               ("9 Crop insurance proceeds", ""), ("10 Gross proceeds paid to an attorney", ""), ("15 Nonqualified deferred compensation", ""),
               ("16 State tax withheld", "")])
p.info_return("1099-K", "Payment Card and Third Party Network Transactions", "OMB No. 1545-2205",
              L(["ETSY PAYMENTS INC", "117 Adams St", "Brooklyn, NY 11201"], "46-3841991", "***-**-8854", SP["name"], ADDR[0], ADDR[1], "SHOP-ELSAMAKES",
                payer_tin="FILER'S TIN", recip_tin="PAYEE'S TIN", recip_name="PAYEE'S name"),
              [("1a Gross amount of payment card/third party network transactions", money(7412.55), "box1a", money(7412.55)),
               ("1b Card not present transactions", money(7412.55)), ("2 Merchant category code", "5947"),
               ("3 Number of payment transactions", "214", "box3", "214"), ("4 Federal income tax withheld", ""),
               ("5a January", money(402.10)), ("5b February", money(388.00)), ("5c March", money(512.45)), ("5d April", money(610.00)),
               ("5e May", money(598.20)), ("5f June", money(455.75)), ("5g July", money(420.00)), ("5h August", money(501.30)),
               ("5i September", money(640.15)), ("5j October", money(712.60)), ("5k November", money(870.00)), ("5l December", money(1302.00))],
              party_label="FILER'S name, street address, city or town, state or province, country, ZIP or\nforeign postal code, and telephone no.")
p.info_return("1099-G", "Certain Government Payments", "OMB No. 1545-0120",
              L(["COLORADO DEPARTMENT OF REVENUE", "1375 Sherman St", "Denver, CO 80261"], "84-0644739", "***-**-3307",
                TP["name"], ADDR[0], ADDR[1], ""),
              [("1 Unemployment compensation", ""), ("2 State or local income tax refunds, credits, or offsets", money(812.00), "box2", money(812.00)),
               ("3 Box 2 amount is for tax year", "2024", "box3", "2024"), ("4 Federal income tax withheld", ""),
               ("5 RTAA payments", ""), ("6 Taxable grants", ""), ("7 Agriculture payments", ""), ("11 State income tax withheld", "")])
p.info_return("1098", "Mortgage Interest Statement", "OMB No. 1545-1380",
              L(["ELEVATIONS CREDIT UNION", "2960 Diagonal Hwy", "Boulder, CO 80301"], "84-0499715", "***-**-3307",
                "CHIDI A OKAFOR", ADDR[0], ADDR[1], "MTG-00918822",
                payer_tin="RECIPIENT'S/LENDER'S TIN", recip_tin="PAYER'S/BORROWER'S TIN", recip_name="PAYER'S/BORROWER'S name"),
              [("1 Mortgage interest received from payer(s)/borrower(s)", money(14206.91), "box1", money(14206.91)),
               ("2 Outstanding mortgage principal", money(398114.20), "box2", money(398114.20)),
               ("3 Mortgage origination date", "06/14/2021", "box3", "06/14/2021"), ("4 Refund of overpaid interest", ""),
               ("5 Mortgage insurance premiums", ""), ("6 Points paid on purchase of principal residence", ""),
               ("7 If address of property securing mortgage is the same as PAYER'S/BORROWER'S\naddress, the box is checked", "", None, None, True),
               ("9 Number of properties securing the mortgage", "1"), ("10 Other  (property tax)", money(3488.00), "box10", money(3488.00)),
               ("11 Mortgage acquisition date", "")],
              party_label="RECIPIENT'S/LENDER'S name, street address, city or town, state or province, country, ZIP or\nforeign postal code, and telephone no.")
p.info_return("1099-SA", "Distributions From an HSA, Archer MSA, or Medicare Advantage MSA", "OMB No. 1545-1517",
              L(["HEALTHEQUITY INC", "15 W Scenic Pointe Dr", "Draper, UT 84020"], "52-2383166", "***-**-8854", SP["name"], ADDR[0], ADDR[1], "HSA-33019",
                payer_tin="PAYER'S TIN", recip_tin="RECIPIENT'S TIN"),
              [("1 Gross distribution", money(2140.37), "box1", money(2140.37)), ("2 Earnings on excess cont.", ""),
               ("3 Distribution code", "1", "box3", "1"), ("4 FMV on date of death", ""),
               ("5 HSA", "", "box5 HSA", "checked", True), ("Archer MSA", "", None, None, False), ("MA MSA", "", None, None, False)])
p.info_return("5498-SA", "HSA, Archer MSA, or Medicare Advantage MSA Information", "OMB No. 1545-1518",
              L(["HEALTHEQUITY INC", "15 W Scenic Pointe Dr", "Draper, UT 84020"], "52-2383166", "***-**-8854", SP["name"], ADDR[0], ADDR[1], "HSA-33019",
                payer_tin="TRUSTEE'S TIN", recip_tin="PARTICIPANT'S TIN", recip_name="PARTICIPANT'S name"),
              [("1 Employee or self-employed person's Archer MSA contributions\nmade in 2025 and 2026 for 2025", ""),
               ("2 Total contributions made in 2025", money(4150.00), "box2", money(4150.00)),
               ("3 Total HSA or Archer MSA contributions made in 2026 for 2025", money(500.00), "box3", money(500.00)),
               ("4 Rollover contributions", ""), ("5 Fair market value of HSA, Archer MSA, or MA MSA", money(11872.04), "box5", money(11872.04)),
               ("6 HSA", "", None, None, True)],
              party_label="TRUSTEE'S name, street address, city or town, state or province, country, and ZIP or foreign postal code")
p.info_return("1099-Q", "Payments From Qualified Education Programs", "OMB No. 1545-1760",
              L(["COLLEGEINVEST", "1600 Broadway Ste 2300", "Denver, CO 80202"], "84-1401320", "***-**-3307", TP["name"], ADDR[0], ADDR[1], "529-77310",
                payer_tin="PAYER'S/TRUSTEE'S TIN", recip_tin="RECIPIENT'S TIN"),
              [("1 Gross distribution", money(8000.00), "box1", money(8000.00)), ("2 Earnings", money(1912.40), "box2", money(1912.40)),
               ("3 Basis", money(6087.60), "box3", money(6087.60)),
               ("4 Trustee-to-trustee transfer", "", "box4", "not checked", False),
               ("5 Qualified tuition program—private or state", "State"), ("6 If this box is checked, the recipient is not the designated beneficiary", "", None, None, False)],
              party_label="PAYER'S/TRUSTEE'S name, street address, city or town, state or province, country, ZIP or\nforeign postal code, and telephone no.")
p.save()

# =====================================================================================
# Packet 3 — retiree: SSA-1099, 1099-R x2, 1099-INT (with treasury), 1099-DIV, 1099-OID (zero), W-2G, 5498, corrected form
# =====================================================================================
p = Packet("Sample3_Delgado_Retiree_2025_Tax_Packet")
DG = dict(name="ROSA E DELGADO", ssn="900-22-6491"); ADR = ["1704 Saguaro Vista Dr", "Tucson, AZ 85715"]
p.ssa1099(dict(name=DG["name"], ssn=DG["ssn"], b3=28644.00, b4=0.00, b5=28644.00, b6=2864.40,
               addr="1704 SAGUARO VISTA DR, TUCSON AZ 85715", claim="900226491A", medicare=2220.00))
p.info_return("1099-R", "Distributions From Pensions, Annuities, Retirement or Profit-Sharing Plans, IRAs, Insurance Contracts, etc.", "OMB No. 1545-0119",
              L(["ARIZONA STATE RETIREMENT SYSTEM", "3300 N Central Ave", "Phoenix, AZ 85012"], "86-6004791", "***-**-6491",
                DG["name"], ADR[0], ADR[1], "ASRS-4401928"),
              [("1 Gross distribution", money(36480.00), "box1", money(36480.00)), ("2a Taxable amount", money(34912.56), "box2a", money(34912.56)),
               ("2b Taxable amount\nnot determined", "", "box2b not determined", "not checked", False),
               ("Total\ndistribution", "", None, None, False),
               ("3 Capital gain (included in box 2a)", ""), ("4 Federal income tax withheld", money(3600.00), "box4", money(3600.00)),
               ("5 Employee contributions/Designated Roth\ncontributions or insurance premiums", money(1567.44), "box5", money(1567.44)),
               ("6 Net unrealized appreciation in employer's securities", ""),
               ("7 Distribution code(s)", "7", "box7", "7"), ("IRA/\nSEP/\nSIMPLE", "", "box7 IRA/SEP/SIMPLE", "not checked", False),
               ("8 Other", ""), ("9b Total employee contributions", ""),
               ("14 State tax withheld", money(1094.40), "box14", money(1094.40)), ("16 State distribution", money(36480.00))],
              cols=2)
p.info_return("1099-R", "Distributions From Pensions, Annuities, Retirement or Profit-Sharing Plans, IRAs, Insurance Contracts, etc.", "OMB No. 1545-0119",
              L(["VANGUARD FIDUCIARY TRUST CO", "PO Box 1110", "Valley Forge, PA 19482"], "23-2186884", "***-**-6491",
                DG["name"], ADR[0], ADR[1], "IRA-88X1290"),
              [("1 Gross distribution", money(14250.00), "box1", money(14250.00)), ("2a Taxable amount", money(14250.00), "box2a", money(14250.00)),
               ("2b Taxable amount\nnot determined", "", "box2b not determined", "checked", True),
               ("Total\ndistribution", "", None, None, False),
               ("3 Capital gain (included in box 2a)", ""), ("4 Federal income tax withheld", money(1425.00), "box4", money(1425.00)),
               ("5 Employee contributions/Designated Roth\ncontributions or insurance premiums", ""),
               ("6 Net unrealized appreciation in employer's securities", ""),
               ("7 Distribution code(s)", "7", "box7", "7"), ("IRA/\nSEP/\nSIMPLE", "", "box7 IRA/SEP/SIMPLE", "checked", True),
               ("8 Other", ""), ("9b Total employee contributions", ""), ("14 State tax withheld", money(427.50)), ("16 State distribution", money(14250.00))],
              notes=["RMD note: your 2025 required minimum distribution from this IRA was 14,250.00 and has been satisfied."])
p.info_return("1099-INT", "Interest Income", "OMB No. 1545-0112",
              L(["TREASURYDIRECT / BUREAU OF THE FISCAL SERVICE", "PO Box 7015", "Parkersburg, WV 26106"], "52-0806185", "***-**-6491",
                DG["name"], ADR[0], ADR[1], "TD-K91-220431"),
              [("1 Interest income", ""), ("2 Early withdrawal penalty", ""),
               ("3 Interest on U.S. Savings Bonds and Treasury obligations", money(2318.06), "box3", money(2318.06)),
               ("4 Federal income tax withheld", ""), ("5 Investment expenses", ""), ("6 Foreign tax paid", ""),
               ("7 Foreign country or U.S. possession", ""), ("8 Tax-exempt interest", ""), ("9 Specified private activity bond interest", ""),
               ("10 Market discount", ""), ("11 Bond premium", ""), ("12 Bond premium on Treasury obligations", money(41.12), "box12", money(41.12)),
               ("13 Bond premium on tax-exempt bond", ""), ("17 State tax withheld", "")])
p.info_return("1099-DIV", "Dividends and Distributions", "OMB No. 1545-0110",
              L(["VANGUARD MARKETING CORP", "PO Box 1110", "Valley Forge, PA 19482"], "23-1945930", "***-**-6491",
                DG["name"], ADR[0], ADR[1], "BRK-44120931"),
              [("1a Total ordinary dividends", money(6812.33), "box1a", money(6812.33)), ("1b Qualified dividends", money(5940.10), "box1b", money(5940.10)),
               ("2a Total capital gain distr.", money(1205.88), "box2a", money(1205.88)), ("2b Unrecap. Sec. 1250 gain", money(44.10), "box2b", money(44.10)),
               ("2c Section 1202 gain", ""), ("2d Collectibles (28%) gain", ""), ("2e Section 897 ordinary dividends", ""), ("2f Section 897 capital gain", ""),
               ("3 Nondividend distributions", money(120.00), "box3", money(120.00)), ("4 Federal income tax withheld", ""),
               ("5 Section 199A dividends", money(212.47), "box5", money(212.47)), ("6 Investment expenses", ""),
               ("7 Foreign tax paid", money(98.64), "box7", money(98.64)), ("8 Foreign country or U.S. possession", "RIC"),
               ("9 Cash liquidation distributions", ""), ("10 Noncash liquidation distributions", ""),
               ("12 Exempt-interest dividends", money(615.00), "box12", money(615.00)), ("13 Specified private activity bond interest dividends", money(38.20)),
               ("16 State tax withheld", "")])
p.info_return("1099-INT", "Interest Income", "OMB No. 1545-0112",
              L(["DESERT FINANCIAL CREDIT UNION", "148 N 48th St", "Phoenix, AZ 85034"], "86-0187702", "***-**-6491",
                DG["name"], ADR[0], ADR[1], "****0553"),
              [("1 Interest income", money(1046.19), "box1", money(1046.19)), ("2 Early withdrawal penalty", money(62.50), "box2", money(62.50)),
               ("3 Interest on U.S. Savings Bonds and Treasury obligations", ""), ("4 Federal income tax withheld", ""),
               ("5 Investment expenses", ""), ("6 Foreign tax paid", ""), ("7 Foreign country or U.S. possession", ""),
               ("8 Tax-exempt interest", ""), ("9 Specified private activity bond interest", ""), ("10 Market discount", ""),
               ("11 Bond premium", ""), ("12 Bond premium on Treasury obligations", ""), ("13 Bond premium on tax-exempt bond", ""),
               ("17 State tax withheld", "")],
              corrected=True, notes=["CORRECTED: replaces the 1099-INT issued 01/31/2026 (box 2 penalty was omitted)."])
p.info_return("W-2G", "Certain Gambling Winnings", "OMB No. 1545-0238",
              L(["CASINO DEL SOL RESORT", "5655 W Valencia Rd", "Tucson, AZ 85757"], "86-0712843", "***-**-6491",
                DG["name"], ADR[0], ADR[1], "",
                payer_tin="PAYER'S federal identification number", recip_tin="WINNER'S taxpayer identification no.", recip_name="WINNER'S name"),
              [("1 Reportable winnings", money(4200.00), "box1", money(4200.00)), ("2 Date won", "08/23/2025", "box2", "08/23/2025"),
               ("3 Type of wager", "SLOT", "box3", "SLOT"), ("4 Federal income tax withheld", money(0.00)),
               ("5 Transaction", ""), ("6 Race", ""), ("7 Winnings from identical wagers", ""), ("8 Cashier", "114"),
               ("13 State/Payer's state identification no.", "AZ 0712843"), ("14 State winnings", money(4200.00)),
               ("15 State income tax withheld", money(0.00))],
              party_label="PAYER'S name, street address, city or town, province or state, country, ZIP or foreign postal\ncode, and telephone no.")
p.info_return("5498", "IRA Contribution Information", "OMB No. 1545-0747",
              L(["VANGUARD FIDUCIARY TRUST CO", "PO Box 1110", "Valley Forge, PA 19482"], "23-2186884", "***-**-6491",
                DG["name"], ADR[0], ADR[1], "IRA-88X1290",
                payer_tin="TRUSTEE'S or ISSUER'S TIN", recip_tin="PARTICIPANT'S TIN", recip_name="PARTICIPANT'S name"),
              [("1 IRA contributions (other than amounts in boxes 2-4, 8-10,\n13a, 14a, and 15a)", ""), ("2 Rollover contributions", ""),
               ("3 Roth IRA conversion amount", ""), ("4 Recharacterized contributions", ""),
               ("5 FMV of account", money(301744.82), "box5", money(301744.82)), ("6 Life insurance cost included in box 1", ""),
               ("7 IRA", "X", None, None), ("8 SEP contributions", ""), ("9 SIMPLE contributions", ""), ("10 Roth IRA contributions", ""),
               ("11 Check if RMD for 2026", "", None, None, True), ("12a RMD date", "12/31/2026"),
               ("12b RMD amount", money(13880.42), "box12b", money(13880.42))],
              party_label="TRUSTEE'S or ISSUER'S name, street address, city or town, state or province, country, and\nZIP or foreign postal code")
p.info_return("1099-OID", "Original Issue Discount", "OMB No. 1545-0117",
              L(["VANGUARD MARKETING CORP", "PO Box 1110", "Valley Forge, PA 19482"], "23-1945930", "***-**-6491",
                DG["name"], ADR[0], ADR[1], "BRK-44120931"),
              [("1 Original issue discount for 2025", money(0.00)), ("2 Other periodic interest", money(0.00)),
               ("3 Early withdrawal penalty", money(0.00)), ("4 Federal income tax withheld", money(0.00)),
               ("5 Market discount", money(0.00)), ("6 Acquisition premium", money(0.00)), ("7 Description", ""),
               ("8 Original issue discount on U.S. Treasury obligations", money(0.00)), ("9 Investment expenses", money(0.00)),
               ("10 Bond premium", money(0.00)), ("11 Tax-exempt OID", money(0.00))],
              notes=["All amounts are zero — this form should be shown as 'nothing to enter'."])
p.key.append((p.page, "1099-OID", "all boxes", "0.00 (zero-value form)"))
p.save()
print("done")
