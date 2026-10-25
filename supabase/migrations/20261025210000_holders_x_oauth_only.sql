-- Verified X handles.
-- x_handle, x_linked_at, and x_via are written by the auth worker with the
-- service key (auth-worker.js) after /auth/x/confirm. A signed-in holder
-- must not write them.
-- Rows that already say oauth were saved from a URL parameter, not from
-- this confirm step. Copy (wallet, x_via) into holders_x_via_20261025, then
-- set those rows to unverified. Holders re-link with Continue with X.
-- The snapshot has no grants for anon or authenticated.
-- Back up public.holders before applying this on production. This task does
-- not apply it. God applies it with that backup.
-- Rollback restores x_via from the snapshot, drops that table, and restores
-- the column grants. It does not delete holder rows:
-- supabase/migrations/down/20261025210000_holders_x_oauth_only.sql

REVOKE INSERT (x_handle, x_linked_at, x_via) ON public.holders FROM authenticated;
REVOKE UPDATE (x_handle, x_linked_at, x_via) ON public.holders FROM authenticated;

CREATE TABLE IF NOT EXISTS public.holders_x_via_20261025 (
  wallet text PRIMARY KEY,
  x_via text
);

REVOKE ALL ON TABLE public.holders_x_via_20261025 FROM PUBLIC;
REVOKE ALL ON TABLE public.holders_x_via_20261025 FROM anon;
REVOKE ALL ON TABLE public.holders_x_via_20261025 FROM authenticated;
ALTER TABLE public.holders_x_via_20261025 ENABLE ROW LEVEL SECURITY;

INSERT INTO public.holders_x_via_20261025 (wallet, x_via)
SELECT wallet, x_via
FROM public.holders
WHERE x_via = 'oauth'
ON CONFLICT (wallet) DO NOTHING;

UPDATE public.holders
SET x_via = 'unverified'
WHERE x_via = 'oauth';

COMMENT ON TABLE public.holders_x_via_20261025 IS
  'Snapshot of holders.x_via for rows that were oauth before they were marked unverified. No grants for anon or authenticated.';
COMMENT ON COLUMN public.holders.x_handle IS
  'X handle written by the auth worker. Public pages show it only when x_via is oauth and show_handle is true.';
COMMENT ON COLUMN public.holders.x_via IS
  'oauth when /auth/x/confirm wrote x_handle. unverified is a previous oauth value that was not proved. Any other value stays off the public board.';
COMMENT ON COLUMN public.holders.show_handle IS
  'When true, the public campaign page may show this holder x_handle if x_via is oauth. Off unless the holder opts in.';
