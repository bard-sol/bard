-- Reverse 20261025210000_holders_x_oauth_only.sql
-- Restores the signed-in holder's write of x_handle, x_linked_at, and x_via.
-- Does not change or delete existing rows.

GRANT INSERT (x_handle, x_linked_at, x_via) ON public.holders TO authenticated;
GRANT UPDATE (x_handle, x_linked_at, x_via) ON public.holders TO authenticated;
