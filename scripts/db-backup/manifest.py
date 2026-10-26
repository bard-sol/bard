"""Build the JSON manifest stored next to each nightly copy.

Usage: manifest.py <counts.tsv> key=value ...
The caller encrypts this JSON before upload. It holds table names and row
counts, so it must not be printed. Bard's repo is public (TRAA-452).
"""

import json
import sys

counts_path, *pairs = sys.argv[1:]
manifest = dict(pair.split("=", 1) for pair in pairs)
for key in ("dump_bytes", "encrypted_bytes"):
    manifest[key] = int(manifest[key])
manifest["roles"] = manifest["roles"].split(",")

tables = {}
with open(counts_path) as f:
    for line in f:
        name, rows = line.rstrip("\n").rsplit("|", 1)
        tables[name] = int(rows)

manifest["tables"] = dict(sorted(tables.items()))
manifest["total_rows"] = sum(tables.values())
manifest["accounts"] = tables.get("auth.users", 0)
json.dump(manifest, sys.stdout, indent=2)
sys.stdout.write("\n")
