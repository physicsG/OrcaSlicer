#!/usr/bin/env python3
"""Extract JS string literals from dart2js output, handling escapes."""
import re, sys, json, collections

SRC = sys.argv[1]
OUT = sys.argv[2]

data = open(SRC, encoding='utf-8', errors='replace').read()

# Match single- or double-quoted JS string literals (no newlines inside, escapes handled)
pat = re.compile(r'"((?:[^"\\\n]|\\.)*)"' + r"|'((?:[^'\\\n]|\\.)*)'")

counts = collections.Counter()
for m in pat.finditer(data):
    s = m.group(1) if m.group(1) is not None else m.group(2)
    if s is None:
        continue
    counts[s] += 1

with open(OUT, 'w', encoding='utf-8') as f:
    for s, c in counts.most_common():
        f.write(f"{c}\t{s}\n")

print(f"unique strings: {len(counts)}")
print(f"total occurrences: {sum(counts.values())}")
