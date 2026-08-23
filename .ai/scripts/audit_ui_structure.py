#!/usr/bin/env python3
"""Candidate scanner for UI smells. It reports candidates, not design verdicts."""
from pathlib import Path
import re, json
root = Path.cwd()
skip = {".git","node_modules","dist","build",".next","coverage",".venv","venv"}
exts = {".tsx",".jsx",".vue",".svelte",".html",".css",".scss",".ts",".js"}
patterns = {
    "versioned-ui-name": re.compile(r"(?i)\b(?:Dashboard|Button|Modal|Dialog|Navbar|Sidebar|Page|Card)(?:V\d+|New\d*|Final\d*|Old|Backup)\b"),
    "generic-error-copy": re.compile(r"(?i)\b(something went wrong|an error occurred)\b"),
    "placeholder-as-label-risk": re.compile(r"<input[^>]+placeholder=[\"'][^\"']+[\"'][^>]*>", re.I),
    "technical-label-risk": re.compile(r"(?i)\b(webhook[_ -]?url|provider[_ -]?id|poll(?:ing)?[_ -]?interval|retry[_ -]?count)\b"),
}
findings=[]
for p in root.rglob("*"):
    if not p.is_file() or p.suffix.lower() not in exts or any(part in skip for part in p.parts):
        continue
    try:
        text=p.read_text(encoding="utf-8",errors="ignore")
    except Exception:
        continue
    for kind,rx in patterns.items():
        matches=list(rx.finditer(text))
        if matches:
            findings.append({"file":str(p.relative_to(root)),"kind":kind,"count":len(matches)})
print(json.dumps({"note":"Candidates only; inspect context before changing code.","findings":findings},indent=2))
