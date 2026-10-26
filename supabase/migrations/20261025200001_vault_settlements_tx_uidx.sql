-- One confirmed settlement signature can be recorded once.
-- Null signatures stay allowed on rows that have not executed.
CREATE UNIQUE INDEX IF NOT EXISTS vault_settlements_tx_uidx
  ON public.vault_settlements (tx_signature)
  WHERE tx_signature IS NOT NULL;
