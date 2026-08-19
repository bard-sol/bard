CREATE TABLE IF NOT EXISTS public.vault_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  payouts jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(36, 8) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'TOKEN',
  payout_hash text,
  status text NOT NULL DEFAULT 'proposed',
  proposed_at timestamptz NOT NULL DEFAULT now(),
  cosigned_wallet text,
  cosigned_at timestamptz,
  cosign_sig text,
  tx_signature text,
  executed_at timestamptz,
  CONSTRAINT vault_settlements_status_chk CHECK (status IN ('proposed', 'cosigned', 'executed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS vault_settlements_campaign_idx ON public.vault_settlements (campaign_id);
ALTER TABLE public.vault_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vault_settlements_select ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_insert ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_update ON public.vault_settlements;
CREATE POLICY vault_settlements_select ON public.vault_settlements FOR SELECT USING (true);
CREATE POLICY vault_settlements_insert ON public.vault_settlements FOR INSERT WITH CHECK (true);
CREATE POLICY vault_settlements_update ON public.vault_settlements FOR UPDATE USING (true);
