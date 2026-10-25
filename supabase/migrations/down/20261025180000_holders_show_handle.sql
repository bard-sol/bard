-- Reverse 20261025180000_holders_show_handle.sql
-- Dropping the column removes opt-ins only. No other holder data is deleted.

REVOKE INSERT (show_handle) ON public.holders FROM authenticated;
REVOKE UPDATE (show_handle) ON public.holders FROM authenticated;

ALTER TABLE public.holders DROP COLUMN IF EXISTS show_handle;
