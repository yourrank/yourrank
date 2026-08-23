#!/usr/bin/env python3
"""Heuristic source audit for common AI-generated frontend smells.

This script produces review signals, not automatic proof of bad design.
It intentionally uses conservative patterns and exits 0 unless --strict is supplied.
"""
from pathlib import Path
import argparse, re, sys

ap=argparse.ArgumentParser()
ap.add_argument('paths', nargs='*', default=['.'])
ap.add_argument('--strict', action='store_true', help='return non-zero when findings exist')
ap.add_argument('--max-file-kb', type=int, default=1024)
args=ap.parse_args()

EXT={'.tsx','.jsx','.ts','.js','.vue','.svelte','.html','.css','.scss','.less'}
SKIP={'node_modules','.git','dist','build','.next','.output','coverage','vendor'}
patterns=[
    ('versioned-ui-name', re.compile(r'(?i)\b(?:dashboard|page|layout|theme|component)[-_]?(?:v[2-9]|new\d*|final\d*|old|backup|copy)\b')),
    ('nested-card-language', re.compile(r'(?i)(?:card[^\n]{0,180}card|panel[^\n]{0,180}panel)')),
    ('gradient-default', re.compile(r'(?i)(?:linear-gradient|radial-gradient|bg-gradient|from-(?:purple|violet|blue).*to-(?:blue|cyan|purple))')),
    ('glass-default', re.compile(r'(?i)(?:backdrop-blur|glassmorphism|backdrop-filter\s*:\s*blur)')),
    ('excessive-pill-radius', re.compile(r'(?i)(?:rounded-full|border-radius\s*:\s*9999|border-radius\s*:\s*999px)')),
    ('fake-metric-language', re.compile(r'(?i)\b(?:active streak|vip community member|growth rate|engagement score)\b')),
]

def files_for(root):
    root=Path(root)
    if root.is_file():
        if root.suffix.lower() in EXT: yield root
        return
    for p in root.rglob('*'):
        if not p.is_file() or p.suffix.lower() not in EXT: continue
        if any(part in SKIP for part in p.parts): continue
        try:
            if p.stat().st_size > args.max_file_kb*1024: continue
        except OSError: continue
        yield p

findings=[]
seen=set()
for root in args.paths:
    for p in files_for(root):
        rp=str(p.resolve())
        if rp in seen: continue
        seen.add(rp)
        try: text=p.read_text(encoding='utf-8', errors='ignore')
        except OSError: continue
        for label,pat in patterns:
            matches=list(pat.finditer(text))
            if matches:
                line=text.count('\n',0,matches[0].start())+1
                findings.append((label,p,line,len(matches)))

if findings:
    print('AI-SLOP REVIEW SIGNALS (heuristics; inspect before acting)')
    for label,p,line,count in findings:
        print(f'- {label}: {p}:{line} ({count} hit(s))')
    print(f'\n{len(findings)} file/rule findings. These are review candidates, not automatic failures.')
else:
    print('No configured AI-slop heuristic signals found.')

if args.strict and findings:
    sys.exit(2)
