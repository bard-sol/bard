-- Reverse 20261027011300_close_payout_batches_writes.sql
-- Restores the insert and update policies from history version 20260819123155.
-- Does not drop the table. Does not change payout_batches_select.

CREATE POLICY payout_batches_insert ON public.payout_batches
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY payout_batches_update ON public.payout_batches
  FOR UPDATE
  USING (true);
