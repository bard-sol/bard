# Nightly database copy (off Supabase)

Every night at 03:30 Dubai (23:30 UTC) the GitHub workflow
`.github/workflows/db-backup.yml` takes a full copy of the live Bard database,
proves it restores, encrypts it and stores it in Cloudflare R2. Supabase's own
daily backups stay as they are; this copy exists so we still have the data if
the Supabase project or account is lost. Same kit as Phenly (TRAA-154). This
copy is TRAA-452. The repo is public, so the Actions log prints only PASS or
FAIL, plus sizes and checksums.

## How it works

1. **Copy.** `backup.sh` runs `pg_dump` (custom format, whole database) as the
   read-only role `bard_backup` through the Supabase session pooler. In the
   same snapshot it counts every table's rows (`counts.sql`).
2. **Restore check, every night.** `restore-check.sh` restores the dump into a
   throwaway `supabase/postgres` container (same version as live) on the runner
   and compares every count. Any restore error or count difference fails the
   run, and nothing is uploaded.
3. **Encrypt.** To the backup public key `backup-public-key.asc`
   (fingerprint `B15DAD48E4B785C639869E913C25753329D6F8A6`). The runner never
   holds the private key on backup nights.
4. **Store.** Through the `bard-db-backup` worker (`drop-worker.js`) into the
   R2 bucket `bard-db-backups` on Bard's Cloudflare account, as
   `nightly/<date>/bard-<stamp>.dump.gpg` plus `bard-<stamp>.json.gpg`.
   The manifest (table names, row counts, sizes, checksums) is encrypted to
   the same key. It is not plaintext, because this repo is public.
5. **Keep 30 days.** The bucket's lifecycle rule deletes objects after 30 days.
   A bucket lock keeps every object undeletable for its first 7 days. The worker
   has no delete route, and the upload token cannot overwrite.
6. **Weekly round trip.** Sundays 03:00 UTC (07:00 Dubai), `restore-latest.sh` downloads the
   newest copy, checks its checksum, decrypts it, restores it into a throwaway
   container and compares counts with the manifest.

## Where the pieces live

| What | Where |
| --- | --- |
| Live DB role | `bard_backup`: LOGIN, BYPASSRLS, member of `pg_read_all_data`, read-only by default, connection limit 4 |
| GitHub | environment `db-backup` (nightly; branch `main` only): secrets `DB_BACKUP_SRC_PASSWORD`, `DB_BACKUP_UPLOAD_TOKEN`; variables `DB_BACKUP_SRC_HOST`, `DB_BACKUP_SRC_PORT`, `DB_BACKUP_SRC_USER`, `DB_BACKUP_DROP_URL`. Environment `db-backup-restore` (weekly round trip; `main` only): secrets `DB_BACKUP_READ_TOKEN`, `DB_BACKUP_PRIVATE_KEY`; variable `DB_BACKUP_DROP_URL`. The nightly job never has the private key |
| Cloudflare | worker `bard-db-backup` (R2 binding `BUCKET`, secrets `UPLOAD_TOKEN_SHA256`, `READ_TOKEN_SHA256` (hashes only)), bucket `bard-db-backups` |
| Private key and tokens | Transcend host secrets folder (`bard-db-backup-*`), and the GitHub secrets above. Both worker tokens are 32 random bytes |

## What is and isn't in a copy

- **In:** the whole database: every schema the app and Supabase use (`public`,
  `auth` accounts, `storage` file records, migrations history, and the rest).
- **Not in:** files that are not stored in the database. This copy is the database only.
- **Not recoverable:** `vault.secrets` restore as ciphertext bound to the live
  project's key, so they can't be decrypted from a copy.
- Copies also hold data deleted from the live database in the last 30 days.
  Erasure requests clear out of the copies as they age out; never restore an
  erased row from a copy.

## Security note

Write access to `main` on bard-sol/bard equals read access to the database:
the `db-backup` environments release their secrets to any workflow on `main`.
The repo is public, so the workflow file is public. The secrets and the
Actions log are not a place for table names or row counts. Never widen write
access to this repo without revisiting this.

## Restore for real

Never restore over the live database without a decision on the task first.
After a real restore, empty `auth.sessions` and `auth.refresh_tokens` so that
old sign-ins from the copy can't be reused.

```bash
# 1. Download the newest copy (needs the read token)
curl -H "Authorization: Bearer $DROP_READ_TOKEN" "$DROP_URL/latest"
curl -H "Authorization: Bearer $DROP_READ_TOKEN" -o copy.dump.gpg "$DROP_URL/get/<copy key>"
# 2. Decrypt (needs the private key). The manifest is encrypted too.
gpg --import bard-db-backup-gpg-private.asc
gpg --output copy.dump --decrypt copy.dump.gpg
gpg --output manifest.json --decrypt manifest.json.gpg
# 3. Restore into a new, empty Supabase project's database
pg_restore --list copy.dump | grep -v ' EVENT TRIGGER ' > restore.list
pg_restore --dbname "$NEW_DB_URL" --no-owner --use-list restore.list copy.dump
```

Supabase's event triggers are left out: every Supabase project creates its own,
and its guard refuses hand-made ones.

Logs: a run prints PASS or FAIL, and on success the sizes and checksums of
the stored objects. It does not print table names, row counts, or restore
errors. Those details stay inside the encrypted manifest.

To restore one table or schema only, use `pg_restore --list` and `--use-list`,
or `--schema` / `--table`.

## Limits

- Worker unit test: `node scripts/db-backup/drop-worker.test.mjs`.

- The drop worker reads request bodies of up to 100 MB (Workers limit).
  Past about 80 MB, switch the upload to R2 multipart.
- GitHub may start scheduled runs late at busy times. A late run is fine.

## Rollback (turn it all off)

1. GitHub: disable the "Database copy" workflow, or delete
   `.github/workflows/db-backup.yml`. Delete the `db-backup` and
   `db-backup-restore` environments.
2. Live DB: `revoke pg_read_all_data from bard_backup; drop role bard_backup;`
   (the role owns nothing).
3. Cloudflare: delete the `bard-db-backup` worker. The bucket empties itself
   within 30 days; delete it after that.
