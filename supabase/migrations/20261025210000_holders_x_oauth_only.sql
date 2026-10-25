-- Verified X handles.
-- x_handle, x_linked_at, and x_via are written by the auth worker with the
-- service key (auth-worker.js). A signed-in holder must not write them.
-- Existing rows are left as they are. The public board hides any handle
-- whose x_via is not oauth.
-- Back up public.holders before applying this on production. This task does
-- not apply it. God applies it with that backup.
-- Rollback does not delete handles. It only restores the column grants:
-- supabase/migrations/down/20261025210000_holders_x_oauth_only.sql

REVOKE INSERT (x_handle, x_linked_at, x_via) ON public.holders FROM authenticated;
REVOKE UPDATE (x_handle, x_linked_at, x_via) ON public.holders FROM authenticated;

COMMENT ON COLUMN public.holders.x_handle IS
  'X handle written by the auth worker. Public pages show it only when x_via is oauth and show_handle is true.';
COMMENT ON COLUMN public.holders.x_via IS
  'oauth when the auth worker wrote x_handle. Any other value stays off the public board.';
COMMENT ON COLUMN public.holders.show_handle IS
  'When true, the public campaign page may show this holder x_handle if x_via is oauth. Off unless the holder opts in.';
