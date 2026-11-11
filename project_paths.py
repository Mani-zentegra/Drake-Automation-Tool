"""
Project layout + import paths.  `import project_paths` must run first (app.py does it on line 1).

Tax_Extraction_Tool/
    app.py               entry point  (python app.py -> http://127.0.0.1:5050)
    project_paths.py     this file
    config/              .env, zoho_config.json, mapping JSON files (secrets: never share)
    drake_automation/    everything that drives Drake Tax (window finding, screen fillers, 8949 import)
    extractors/          read values out of PDFs / Excel organizers
    web/                 page blueprints: /w2-mapping, /drake-modules, live Drake view
    services/            Zoho Creator API, packet history, date helpers
    taxflow/             /review platform (upload -> analyze -> review -> transfer)
    templates/, static/  HTML / CSS / JS / pdf.js
    uploads/, history/   runtime data (git-ignored)
    tests/               sample packets + check_samples.py
    _unused_files/       old debug scripts, not used by the app

The code folders are put on sys.path so modules keep importing each other by plain name
(`import w2_mapping`, `from drake_w2_filler import ...`) wherever they live.
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(ROOT, "config")
UPLOAD_DIR = os.path.join(ROOT, "uploads")
HISTORY_DIR = os.path.join(ROOT, "history")
CODE_DIRS = ["drake_automation", "extractors", "web", "services"]

for _d in [ROOT] + [os.path.join(ROOT, d) for d in CODE_DIRS]:
    if _d not in sys.path:
        sys.path.insert(1, _d)
