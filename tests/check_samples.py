import sys, csv, re, glob, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # Tax_Extraction_Tool/
import project_paths  # noqa: F401
from taxflow import extract
def norm(v):
    if isinstance(v, bool): return "checked" if v else "not checked"
    s = str(v).strip()
    if s.lower() in ("checked","not checked"): return s.lower()
    if re.fullmatch(r"\d{2,3}-\d{2}-?\d{4}|\d{2}-\d{7}", s): return re.sub(r"\D","",s)
    s2 = s.replace(",", "")
    try: return f"{float(s2):.2f}"
    except: return re.sub(r"\W", "", s).upper()
KEYMAP = {"box13 retirement plan": "box13_retirement", "box15 state": "state1", "box16": None, "box17": None,
          "box2b not determined": "box2b_not_determined", "box7 IRA/SEP/SIMPLE": "box7_ira", "box8 half-time": "box8",
          "box9 graduate": "box9", "box5 HSA": "box5", "box2 SSN": "beneficiary_ssn", "employee SSN": "employee_ssn",
          "employer EIN": "employer_ein", "employer name": "employer_name", "payer/filer name": None, "payer TIN": None, "recipient TIN": None}
tot = ok = 0
for pdf in sorted(glob.glob(sys.argv[1] + "/*.pdf")):
    r = extract.analyze_pdf(pdf)
    docs = [d for d in r["documents"] if d["type"] not in ("TAXPAYER", "FOREIGN")]
    print("\n==", os.path.basename(pdf), "| tax year", r.get("tax_year"), "| taxpayer", (r.get("taxpayer") or {}).get("name") if isinstance(r.get("taxpayer"),dict) else r.get("taxpayer"))
    print("   detected:", ", ".join(f"p{d['page']}:{d['type']}" for d in docs))
    print("   pages:", {p['page'] if isinstance(p,dict) else p: (p.get('kind') if isinstance(p,dict) else '') for p in (r['pages'] if isinstance(r['pages'],list) else r['pages'].values())})
    key = list(csv.DictReader(open(pdf[:-4] + "_answer_key.csv")))
    for row in key:
        pg, form, field, exp = int(row["page"]), row["form"], row["field"], row["expected_value"]
        doc = next((d for d in docs if pg in d["pages"]), None)
        if form.startswith("("):
            print(f"   p{pg} cover: {'OK (no form)' if not doc or doc['type']=='UNKNOWN' else 'detected as '+doc['type']}"); continue
        if not doc: print(f"   p{pg} {form}: NOT DETECTED"); tot += 1; continue
        if doc["type"] != form: print(f"   p{pg} {form}: detected as {doc['type']}")
        if field == "all boxes":
            print(f"   p{pg} zero_value={doc['zero_value']}"); continue
        fmap = {f["key"]: f for f in doc["fields"]}
        if field in ("payer/filer name",):
            got = doc.get("payer"); k = None
        elif field == "payer TIN": got = doc.get("payer_tin"); k=None
        elif field == "recipient TIN": got = doc.get("recipient_tin"); k=None
        else:
            k = KEYMAP.get(field, field)
            if field in ("box16","box17") and form=="W-2": k = {"box16":"state1_wages","box17":"state1_tax"}[field]
            if k is None: continue
            m = re.match(r"box12([abcd])$", field)
            if m and form == "W-2":
                c, a = fmap.get(f"box12{m.group(1)}_code", {}), fmap.get(f"box12{m.group(1)}_amount", {})
                got = f"{c.get('value','')} {a.get('value','')}"
                tot += 1; good = norm(got) == norm(exp) or re.sub(r'[\s,]','',got).replace('.00','')==re.sub(r'[\s,]','',exp).replace('.00','')
                ok += good
                if not good: print(f"   p{pg} {form} {field}: expected {exp!r} got {got!r}")
                continue
            got = fmap.get(k, {}).get("value", "<no field>")
        tot += 1
        e, g = norm(exp), norm(got)
        if field.endswith("TIN") and "*" in exp: good = g.endswith(e[-4:]) or e.endswith(g[-4:]) if g else False
        else: good = e == g or (len(re.sub(r'\D','',str(exp)))>=9 and re.sub(r'\D','',str(exp))==re.sub(r'\D','',str(got)))
        if not good and field.endswith("name"): good = e in g or g in e
        ok += good
        if not good: print(f"   p{pg} {form} {field}: expected {exp!r} got {got!r}")
print(f"\nTOTAL {ok}/{tot} expected values matched")
