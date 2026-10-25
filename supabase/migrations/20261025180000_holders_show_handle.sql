-- holders.show_handle
-- Opt-in for showing an X handle on the public campaign page.
-- Default false keeps the wallet-to-handle link private.
-- Back up public.holders before applying this on production. God does that backup and apply later.
-- Down: supabase/migrations/down/20261025180000_holders_show_handle.sql

ALTER TABLE public.holders
  ADD COLUMN IF NOT EXISTS show_handle boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.holders.show_handle IS
  'When true, the public campaign page may show this holder x_handle. Off unless the holder opts in.';

GRANT INSERT (show_handle) ON public.holders TO authenticated;
GRANT UPDATE (show_handle) ON public.holders TO authenticated;
