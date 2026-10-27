-- Close open writes on unused public.payout_batches.
-- The table stays. payout_batches_select stays.
-- This file is the only migration this change adds. It does not repair
-- the remote-only history versions kept by TRAA-409.
-- Rollback: supabase/migrations/down/20261027011300_close_payout_batches_writes.sql

DROP POLICY IF EXISTS payout_batches_insert ON public.payout_batches;
DROP POLICY IF EXISTS payout_batches_update ON public.payout_batches;
