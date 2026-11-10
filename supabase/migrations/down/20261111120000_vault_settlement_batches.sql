-- Reverse 20261111120000_vault_settlement_batches.sql
-- Drops the batch rows. Run only when no settlement is paying in batches.

DROP TRIGGER IF EXISTS vault_settlements_guard_batch_tx ON public.vault_settlements;
DROP TABLE IF EXISTS public.vault_settlement_batches;
DROP FUNCTION IF EXISTS public.guard_settlement_batch_tx();
