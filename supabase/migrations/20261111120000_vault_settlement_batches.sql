-- TRAA-2329 (launch simulation, B2): one Squads vault transaction fits about seven
-- token transfers, so a settlement paying more holders could never execute. A
-- settlement now pays its lines (holders and the cut, in wallet order) six per
-- vault transaction. Each batch is a row here with its own vault transaction,
-- both approvals and its execute signature. The worker writes these rows with
-- the service role; a project admin can read their own.
-- Rollback: supabase/migrations/down/20261111120000_vault_settlement_batches.sql

CREATE TABLE IF NOT EXISTS public.vault_settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.vault_settlements(id) ON DELETE CASCADE,
  batch integer NOT NULL CHECK (batch >= 0),
  vault_multisig text NOT NULL,
  tx_index text NOT NULL,
  team_signed boolean NOT NULL DEFAULT false,
  bard_signed boolean NOT NULL DEFAULT false,
  team_signed_at timestamptz,
  bard_signed_at timestamptz,
  tx_signature text,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_settlement_batches_one_per_batch UNIQUE (settlement_id, batch)
);

-- One Squads transaction pays one batch, and one execute signature is recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS vault_settlement_batches_vault_tx_uidx
  ON public.vault_settlement_batches (vault_multisig, tx_index);
CREATE UNIQUE INDEX IF NOT EXISTS vault_settlement_batches_tx_uidx
  ON public.vault_settlement_batches (tx_signature)
  WHERE tx_signature IS NOT NULL;

-- A settlement row carries batch 0's vault transaction, so the same transaction can sit in both
-- tables only for the same settlement. Another settlement's transaction is refused either way.
CREATE OR REPLACE FUNCTION public.guard_settlement_batch_tx()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'vault_settlement_batches' THEN
    IF EXISTS (
      SELECT 1 FROM public.vault_settlements s
      WHERE s.vault_multisig = NEW.vault_multisig AND s.tx_index = NEW.tx_index AND s.id <> NEW.settlement_id
    ) THEN
      RAISE EXCEPTION 'vault transaction is bound to another settlement' USING ERRCODE = '23505';
    END IF;
  ELSIF NEW.vault_multisig IS NOT NULL AND NEW.tx_index IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.vault_settlement_batches b
      WHERE b.vault_multisig = NEW.vault_multisig AND b.tx_index = NEW.tx_index AND b.settlement_id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'vault transaction is bound to another settlement' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vault_settlement_batches_guard_tx ON public.vault_settlement_batches;
CREATE TRIGGER vault_settlement_batches_guard_tx
  BEFORE INSERT OR UPDATE OF vault_multisig, tx_index ON public.vault_settlement_batches
  FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_batch_tx();

DROP TRIGGER IF EXISTS vault_settlements_guard_batch_tx ON public.vault_settlements;
CREATE TRIGGER vault_settlements_guard_batch_tx
  BEFORE INSERT OR UPDATE OF vault_multisig, tx_index ON public.vault_settlements
  FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_batch_tx();

ALTER TABLE public.vault_settlement_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vault_settlement_batches FROM anon, authenticated;
GRANT SELECT ON public.vault_settlement_batches TO authenticated;
GRANT ALL ON public.vault_settlement_batches TO service_role;

DROP POLICY IF EXISTS vault_settlement_batches_admin_read ON public.vault_settlement_batches;
CREATE POLICY vault_settlement_batches_admin_read ON public.vault_settlement_batches
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vault_settlements s
    WHERE s.id = settlement_id AND public.is_project_admin(s.project_id)
  ));
