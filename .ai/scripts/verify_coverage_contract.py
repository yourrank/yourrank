#!/usr/bin/env python3
from pathlib import Path
import argparse, json, sys

ap = argparse.ArgumentParser()
ap.add_argument("report")
args = ap.parse_args()

data = json.loads(Path(args.report).read_text(encoding="utf-8"))
defined = set(data.get("defined", []))
verified = set(data.get("verified", []))
excluded_items = data.get("excluded", [])
excluded = {x.get("id") for x in excluded_items if x.get("id")}
errors = []

if not data.get("scope_source"):
    errors.append("missing scope_source")
if not defined:
    errors.append("defined scope is empty")
if not verified <= defined:
    errors.append("verified contains items not in defined")
if not excluded <= defined:
    errors.append("excluded contains items not in defined")

uncovered = defined - verified - excluded
if uncovered:
    errors.append("uncovered items: " + ", ".join(sorted(uncovered)))

for item in excluded_items:
    if not item.get("reason"):
        errors.append(f"excluded item {item.get('id')} has no reason")

print(json.dumps({
    "scope_source": data.get("scope_source"),
    "defined_count": len(defined),
    "verified_count": len(verified),
    "excluded_count": len(excluded),
    "uncovered_count": len(uncovered)
}, indent=2))

if errors:
    print("FAIL")
    for e in errors:
        print("-", e)
    sys.exit(2)

print("PASS")
