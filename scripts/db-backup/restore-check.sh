#!/usr/bin/env bash
# Restore a Bard dump into the throwaway Supabase Postgres on this runner,
# then check every table's row count against the counts taken at dump time.
#
# Usage: restore-check.sh <dump file> <counts.tsv> <roles.txt>
# roles.txt lists the live database's roles, one per line; missing ones are
# created here without login so grants and policies restore.
# Env:   PG_IMAGE, SCRATCH_PORT, SCRATCH_USER, SCRATCH_PASSWORD
#
# Only ever talks to the local throwaway server. Exits non-zero on any restore error or any
# count that differs.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dump="$(realpath "$1")"
expected="$(realpath "$2")"
roles="$(paste -sd, "$3")"
: "${PG_IMAGE:?}" "${SCRATCH_PORT:?}" "${SCRATCH_USER:?}" "${SCRATCH_PASSWORD:?}"

work="$(mktemp -d)"
trap 'status=$?; rm -rf "$work"; if [[ $status -ne 0 ]]; then echo FAIL >&2; fi; exit $status' EXIT
cp "$dump" "$work/copy.dump"
cp "$here/counts.sql" "$work/counts.sql"

scratch() {
  local db="$1"; shift
  PGPASSWORD="$SCRATCH_PASSWORD" docker run --rm -i --network host \
    -v "$work:/work" -w /work \
    -e PGHOST=127.0.0.1 -e PGPORT="$SCRATCH_PORT" -e PGUSER="$SCRATCH_USER" \
    -e PGDATABASE="$db" -e PGSSLMODE=disable -e PGPASSWORD \
    "$PG_IMAGE" "$@" 2>>"$work/client.err"
}

# Belt and braces: PGHOST is fixed to 127.0.0.1 above. Also require a private
# server address (a service container reports its Docker address) and an
# empty auth.users, which the live database can never have.
addr="$(scratch postgres psql -X -At -c 'select coalesce(host(inet_server_addr()), $$local$$)')"
case "$addr" in
  local|127.*|::1|10.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*) ;;
  *) exit 1 ;;
esac
accounts="$(scratch postgres psql -X -At -c 'select count(*) from auth.users')"
[[ "$accounts" == 0 ]] || exit 1

scratch postgres psql -X -q -v ON_ERROR_STOP=1 \
  -c 'drop database if exists restore_check' -c 'create database restore_check'
scratch postgres psql -X -q -v ON_ERROR_STOP=1 -v roles="$roles" <<'SQL'
select format('create role %I nologin', r)
from unnest(string_to_array(:'roles', ',')) as r
where not exists (select 1 from pg_roles where rolname = r) \gexec
SQL

# Supabase's event triggers are platform wiring every project creates for
# itself, and its guard refuses to recreate them by hand. Skip only those.
scratch restore_check pg_restore --list /work/copy.dump |
  grep -v ' EVENT TRIGGER ' >"$work/restore.list"

set +e
scratch restore_check pg_restore --dbname=restore_check --no-password \
  --use-list=/work/restore.list \
  --single-transaction --exit-on-error /work/copy.dump 2>"$work/restore.err"
status=$?
set -e
if [[ $status -ne 0 ]]; then
  exit 1
fi

scratch restore_check psql -X -At -v ON_ERROR_STOP=1 -f /work/counts.sql >"$work/actual.tsv"

LC_ALL=C sort "$expected" >"$work/expected.sorted"
LC_ALL=C sort "$work/actual.tsv" >"$work/actual.sorted"
if ! cmp -s "$work/expected.sorted" "$work/actual.sorted"; then
  exit 1
fi
echo PASS
