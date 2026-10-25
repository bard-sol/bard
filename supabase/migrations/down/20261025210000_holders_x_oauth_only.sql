-- Reverse 20261025210000_holders_x_oauth_only.sql
-- Restores x_via from public.holders_x_via_20261025, drops that table, and
-- restores the signed-in holder's write of x_handle, x_linked_at, and x_via.
-- Does not delete holder rows.

UPDATE public.holders AS h
SET x_via = s.x_via
FROM public.holders_x_via_20261025 AS s
WHERE h.wallet = s.wallet;

DROP TABLE IF EXISTS public.holders_x_via_20261025;

GRANT INSERT (x_handle, x_linked_at, x_via) ON public.holders TO authenticated;
GRANT UPDATE (x_handle, x_linked_at, x_via) ON public.holders TO authenticated;
