#!/usr/bin/env bash
# Full round trip for the newest stored copy: download it from the backup
# bucket, check its checksum, decrypt it, restore it into the throwaway
# Postgres and compare row counts with its manifest.
#
# Env: DROP_URL DROP_READ_TOKEN BACKUP_PRIVATE_KEY, plus restore-check.sh's.
# Optional: BACKUP_KEY (a manifest key like nightly/2026-10-25/bard-....json.gpg)
# to check a specific copy instead of the newest.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
: "${DROP_URL:?}" "${DROP_READ_TOKEN:?}" "${BACKUP_PRIVATE_KEY:?}"

work="$(mktemp -d)"
chmod 700 "$work"
trap 'status=$?; rm -rf "$work"; if [[ $status -ne 0 ]]; then echo FAIL >&2; fi; exit $status' EXIT

get() {
  curl -fsS --retry 3 --retry-all-errors \
    -H "Authorization: Bearer $DROP_READ_TOKEN" "$DROP_URL/$1" -o "$2" 2>>"$work/client.err"
}

if [[ -n "${BACKUP_KEY:-}" ]]; then
  manifest_key="$BACKUP_KEY"
else
  get latest "$work/latest.json"
  manifest_key="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["manifest"])' "$work/latest.json")"
fi
dump_key="${manifest_key%.json.gpg}.dump.gpg"
[[ "$manifest_key" == *.json.gpg && "$dump_key" == nightly/* ]] || exit 1

get "get/${manifest_key}" "$work/manifest.json.gpg"
get "get/${dump_key}" "$work/copy.dump.gpg"

export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME"
printf '%s\n' "$BACKUP_PRIVATE_KEY" | gpg --batch --quiet --import
gpg --batch --quiet --output "$work/manifest.json" --decrypt "$work/manifest.json.gpg"
field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$work/manifest.json" "$1"; }
[[ "$(sha256sum "$work/copy.dump.gpg" | cut -d' ' -f1)" == "$(field encrypted_sha256)" ]] || exit 1

gpg --batch --quiet --output "$work/copy.dump" --decrypt "$work/copy.dump.gpg"
[[ "$(sha256sum "$work/copy.dump" | cut -d' ' -f1)" == "$(field dump_sha256)" ]] || exit 1

python3 -I -c '
import json, sys
for name, rows in json.load(open(sys.argv[1]))["tables"].items():
    print(f"{name}|{rows}")
' "$work/manifest.json" >"$work/counts.tsv"

python3 -I -c 'import json, sys; print("\n".join(json.load(open(sys.argv[1]))["roles"]))' \
  "$work/manifest.json" >"$work/roles.txt"

"$here/restore-check.sh" "$work/copy.dump" "$work/counts.tsv" "$work/roles.txt"
manifest_sha="$(sha256sum "$work/manifest.json.gpg" | cut -d' ' -f1)"
echo "PASS encrypted_bytes=$(stat -c %s "$work/copy.dump.gpg") encrypted_sha256=$(field encrypted_sha256) manifest_bytes=$(stat -c %s "$work/manifest.json.gpg") manifest_sha256=${manifest_sha}"
