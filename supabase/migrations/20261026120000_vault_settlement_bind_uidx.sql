-- One Squads transaction can be bound to one settlement.
-- Rows that have not been bound yet keep a null multisig or index.
CREATE UNIQUE INDEX IF NOT EXISTS vault_settlements_vault_tx_uidx
  ON public.vault_settlements (vault_multisig, tx_index)
  WHERE vault_multisig IS NOT NULL AND tx_index IS NOT NULL;
