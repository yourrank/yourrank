#!/usr/bin/env python3
"""Validate that core instruction files and skill-router references are internally consistent."""
from pathlib import Path
import re, sys, json
ROOT=Path(__file__).resolve().parents[1]
required=['AGENTS.md','PROJECT_RULES.md','PROJECT_STATE.md','PROJECT_TRUTH.md','PRODUCT.md','DESIGN.md','AI_CODING_RULES.md','AI_FORBIDDEN.md','AI_WORKFLOW.md','AI_VERIFICATION.md','STOPPING_CRITERIA.md','INVARIANTS.md']
errors=[]
for rel in required:
    if not (ROOT/rel).exists(): errors.append(f'missing core file: {rel}')
skills={p.parent.name for p in (ROOT/'skills').glob('*/SKILL.md')}
router=(ROOT/'skills/using-skills/SKILL.md').read_text(encoding='utf-8')
# Backticked kebab-case names are treated as references only if they look like a skill name.
refs=set(re.findall(r'`([a-z0-9]+(?:-[a-z0-9]+)+)`', router))
missing=sorted(x for x in refs if x not in skills and x not in {'OWNER-REVIEW-REQUIRED'})
if missing: errors.append('router references missing skills: '+', '.join(missing))
manifest=ROOT/'skills/MANIFEST.json'
if manifest.exists():
    obj=json.loads(manifest.read_text(encoding='utf-8'))
    declared={x.get('name') for x in obj.get('skills',[])}
    if declared != skills: errors.append('manifest skill set differs from folders')
if errors:
    print('INSTRUCTION GRAPH CHECK FAILED')
    for e in errors: print('-',e)
    raise SystemExit(2)
print(f'OK: instruction graph valid; {len(skills)} skills available')
