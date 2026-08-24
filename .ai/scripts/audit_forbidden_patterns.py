#!/usr/bin/env python3
"""Fail when project-specific deprecated identifiers remain in source.

Populate .ai/FORBIDDEN_PATTERNS.txt with one literal identifier/path fragment per line.
Blank lines and # comments are ignored. Keep the list specific to proven legacy code.
"""
from pathlib import Path
import argparse, sys

ap=argparse.ArgumentParser()
ap.add_argument('--root', default='.')
ap.add_argument('--patterns', default='.ai/FORBIDDEN_PATTERNS.txt')
ap.add_argument('--allow-file', action='append', default=[])
args=ap.parse_args()
root=Path(args.root).resolve()
patfile=(root/args.patterns)
if not patfile.exists():
    print(f'SKIP: {patfile} not found')
    raise SystemExit(0)
patterns=[x.strip() for x in patfile.read_text(encoding='utf-8').splitlines() if x.strip() and not x.lstrip().startswith('#')]
if not patterns:
    print('SKIP: forbidden pattern list is empty')
    raise SystemExit(0)
SKIP_DIRS={'.git','node_modules','dist','build','.next','.output','coverage','vendor'}
SKIP_FILES={patfile.resolve(), *( (root/x).resolve() for x in args.allow_file )}
TEXT_EXT={'.js','.jsx','.ts','.tsx','.css','.scss','.less','.html','.vue','.svelte','.md','.json','.yaml','.yml','.py','.go','.rs','.java','.kt','.rb','.php','.sql'}
found=[]
for p in root.rglob('*'):
    if not p.is_file() or any(part in SKIP_DIRS for part in p.parts): continue
    if p.resolve() in SKIP_FILES: continue
    if p.suffix.lower() not in TEXT_EXT: continue
    try: text=p.read_text(encoding='utf-8', errors='ignore')
    except OSError: continue
    for pattern in patterns:
        if pattern in text or pattern in str(p.relative_to(root)):
            found.append((pattern,p.relative_to(root)))
if found:
    print('FORBIDDEN LEGACY PATTERNS FOUND')
    for pattern,p in found:
        print(f'- {pattern!r}: {p}')
    raise SystemExit(2)
print(f'OK: no forbidden patterns found across scanned source ({len(patterns)} configured)')
