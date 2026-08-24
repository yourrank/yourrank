#!/usr/bin/env python3
from pathlib import Path
import hashlib, json
ROOT=Path(__file__).resolve().parents[1]
rows=[]
for skill in sorted((ROOT/'skills').glob('*/SKILL.md')):
    folder=skill.parent
    rows.append({
        'name':folder.name,
        'path':str(skill.relative_to(ROOT)).replace('\\','/'),
        'sha256':hashlib.sha256(skill.read_bytes()).hexdigest(),
        'has_references':(folder/'references').is_dir() and any((folder/'references').rglob('*')),
        'has_scripts':(folder/'scripts').is_dir() and any((folder/'scripts').rglob('*')),
    })
out={'version':'7.0.0-pro-max','skills':rows}
(ROOT/'skills/MANIFEST.json').write_text(json.dumps(out,indent=2)+"\n",encoding='utf-8')
print(f'wrote manifest for {len(rows)} skills')
