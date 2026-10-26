#!/usr/bin/env bash
# Nightly off-Supabase copy of the Bard database (TRAA-452).
#
# 1. pg_dump the whole database as the read-only `bard_backup` role, and
#    count every table's rows inside the same snapshot.
# 2. Restore the dump into a throwaway Supabase Postgres on this runner and
#    check every count matches (restore-check.sh). Nothing uploads otherwise.
# 3. Encrypt to the backup public key and upload through the drop worker,
#    which can add copies but never read over or delete them.
#
# Runs in GitHub Actions (.github/workflows/db-backup.yml). Never touches the
# live database except to read it.
#
# Env:
#   SRC_HOST SRC_PORT SRC_USER SRC_DB   pooler address of the live database
#   SRC_PASSWORD                        bard_backup password (secret)
#   DROP_URL DROP_UPLOAD_TOKEN          drop worker and its upload token (secret)
#   PG_IMAGE                            pinned postgres client image
#   SCRATCH_PORT SCRATCH_USER SCRATCH_PASSWORD  throwaway restore server
#   RUN_URL                             link to this run, kept in the manifest

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
: "${SRC_HOST:?}" "${SRC_PORT:?}" "${SRC_USER:?}" "${SRC_DB:?}" "${SRC_PASSWORD:?}"
: "${DROP_URL:?}" "${DROP_UPLOAD_TOKEN:?}" "${PG_IMAGE:?}"

work="$(mktemp -d)"
chmod 700 "$work"
# The repo is public. A failed command must not spill server text into the log.
trap 'status=$?; rm -rf "$work"; if [[ $status -ne 0 ]]; then echo FAIL >&2; fi; exit $status' EXIT

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
day="${stamp%%T*}"
name="bard-${stamp}"

# Client tools run from the pinned image. Credentials go in by env name only,
# so they never appear on a command line.
src() {
  PGPASSWORD="$SRC_PASSWORD" docker run --rm -i --network host \
    -v "$work:/work" -w /work \
    -e PGHOST="$SRC_HOST" -e PGPORT="$SRC_PORT" -e PGUSER="$SRC_USER" \
    -e PGDATABASE="$SRC_DB" -e PGSSLMODE=require -e PGPASSWORD \
    -e PGAPPNAME=bard-nightly-backup \
    "$PG_IMAGE" "$@" 2>>"$work/client.err"
}

echo "::group::Dump"
# One session holds a read-only snapshot open. pg_dump imports it, and the
# row counts are read inside it, so counts and dump describe the same moment.
coproc SNAP { src psql -X -q -At -v ON_ERROR_STOP=1; }
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" >&"${SNAP[1]}"
echo "SELECT pg_export_snapshot();" >&"${SNAP[1]}"
read -r -t 60 snapshot <&"${SNAP[0]}"
[[ "$snapshot" =~ ^[0-9A-F-]+$ ]] || exit 1

cp "$here/counts.sql" "$work/counts.sql"
printf '%s\n' '\i /work/counts.sql' '\echo __end__' >&"${SNAP[1]}"
: >"$work/counts.tsv"
while read -r -t 120 line <&"${SNAP[0]}"; do
  [[ "$line" == "__end__" ]] && break
  printf '%s\n' "$line" >>"$work/counts.tsv"
done
[[ -s "$work/counts.tsv" ]] || exit 1

src pg_dump --snapshot="$snapshot" --format=custom --compress=9 \
  --file="/work/${name}.dump"

printf '%s\n' 'COMMIT;' '\q' >&"${SNAP[1]}"
wait "$SNAP_PID"
server_version="$(src psql -X -At -c 'show server_version')"
# Roles live outside the dump; the restore check recreates any it lacks.
src psql -X -At -c "select rolname from pg_roles where rolname !~ '^pg_' order by 1" >"$work/roles.txt"
echo "::endgroup::"

echo "::group::Restore check"
"$here/restore-check.sh" "$work/${name}.dump" "$work/counts.tsv" "$work/roles.txt"
echo "::endgroup::"

echo "::group::Encrypt"
export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME"
gpg --batch --quiet --import "$here/backup-public-key.asc"
gpg --batch --yes --trust-model always --compress-algo none \
  --recipient-file "$here/backup-public-key.asc" \
  --output "$work/${name}.dump.gpg" --encrypt "$work/${name}.dump"
# Refuse to upload anything that is not a message encrypted to our key.
# list-packets exits non-zero here (no private key on the runner), so only
# its output counts.
subkey="$(gpg --with-colons --show-keys "$here/backup-public-key.asc" | awk -F: '/^sub/{print $5; exit}')"
packets="$(gpg --batch --list-packets "$work/${name}.dump.gpg" 2>/dev/null || true)"
grep -q "^:pubkey enc packet: .* keyid ${subkey}\$" <<<"$packets" || exit 1
echo "::endgroup::"

dump_sha="$(sha256sum "$work/${name}.dump" | cut -d' ' -f1)"
enc_sha="$(sha256sum "$work/${name}.dump.gpg" | cut -d' ' -f1)"

python3 -I "$here/manifest.py" "$work/counts.tsv" \
  stamp="$stamp" server_version="$server_version" pg_image="$PG_IMAGE" \
  dump_sha256="$dump_sha" dump_bytes="$(stat -c %s "$work/${name}.dump")" \
  encrypted_sha256="$enc_sha" encrypted_bytes="$(stat -c %s "$work/${name}.dump.gpg")" \
  key_fingerprint="$(gpg --with-colons --show-keys "$here/backup-public-key.asc" | awk -F: '/^fpr/{print $10; exit}')" \
  roles="$(paste -sd, "$work/roles.txt")" \
  run_url="${RUN_URL:-}" >"$work/${name}.json"
# Table names and row counts stay inside this ciphertext. Never upload the plaintext.
gpg --batch --yes --trust-model always --compress-algo none \
  --recipient-file "$here/backup-public-key.asc" \
  --output "$work/${name}.json.gpg" --encrypt "$work/${name}.json"
packets="$(gpg --batch --list-packets "$work/${name}.json.gpg" 2>/dev/null || true)"
grep -q "^:pubkey enc packet: .* keyid ${subkey}\$" <<<"$packets" || exit 1
rm -f "$work/${name}.json"
manifest_sha="$(sha256sum "$work/${name}.json.gpg" | cut -d' ' -f1)"

upload() {
  local file="$1" key="$2"
  curl -fsS --retry 3 --retry-all-errors -X PUT \
    -H "Authorization: Bearer $DROP_UPLOAD_TOKEN" \
    -H "x-sha256: $(sha256sum "$file" | cut -d' ' -f1)" \
    --data-binary "@$file" "$DROP_URL/put/$key" 2>>"$work/client.err"
  echo
}

echo "::group::Upload"
# The copy first, then its manifest: a manifest only exists for a stored copy.
upload "$work/${name}.dump.gpg" "nightly/${day}/${name}.dump.gpg"
upload "$work/${name}.json.gpg" "nightly/${day}/${name}.json.gpg"
echo "::endgroup::"

echo "PASS encrypted_bytes=$(stat -c %s "$work/${name}.dump.gpg") encrypted_sha256=${enc_sha} manifest_bytes=$(stat -c %s "$work/${name}.json.gpg") manifest_sha256=${manifest_sha}"
