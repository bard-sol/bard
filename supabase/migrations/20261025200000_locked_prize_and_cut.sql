-- Locked prize and the payout cut. Columns only. fee_payments rows stay.
-- A browser write cannot set the lock, and cannot leave a campaign active
-- unless the worker already stored the lock. Reservation freezes from M3 stay.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS prize_raw numeric(40, 0),
  ADD COLUMN IF NOT EXISTS cut_bps integer,
  ADD COLUMN IF NOT EXISTS cut_raw numeric(40, 0),
  ADD COLUMN IF NOT EXISTS locked_raw numeric(40, 0),
  ADD COLUMN IF NOT EXISTS cut_wallet text,
  ADD COLUMN IF NOT EXISTS prize_mint text,
  ADD COLUMN IF NOT EXISTS lock_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_balance_raw numeric(40, 0);

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_chk;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_chk
  CHECK (status IN ('active', 'ended', 'draft', 'paid'));

ALTER TABLE public.vault_settlements
  ADD COLUMN IF NOT EXISTS cut_raw numeric(40, 0),
  ADD COLUMN IF NOT EXISTS cut_wallet text,
  ADD COLUMN IF NOT EXISTS cut_bps integer,
  ADD COLUMN IF NOT EXISTS cut_waived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS holder_total_raw numeric(40, 0);

ALTER TABLE public.projects ALTER COLUMN fee_paid SET DEFAULT true;
ALTER TABLE public.campaigns ALTER COLUMN fee_paid SET DEFAULT true;
ALTER TABLE public.platform_claims ALTER COLUMN fee_paid SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.guard_campaign_privileged()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.fee_paid := false;
    NEW.fee_tx := NULL;
    NEW.fee_amount_sol := 0;
    NEW.settled_count := 0;
    NEW.vault_reserved := 0;
    NEW.draw_seed := NULL;
    NEW.draw_at := NULL;
    NEW.draw_winners := NULL;
    NEW.draw_slot := NULL;
    NEW.draw_seed_slot := NULL;
    NEW.draw_count := 0;
    NEW.draw_committed_at := NULL;
    NEW.prize_raw := NULL;
    NEW.cut_bps := NULL;
    NEW.cut_raw := NULL;
    NEW.locked_raw := NULL;
    NEW.cut_wallet := NULL;
    NEW.prize_mint := NULL;
    NEW.lock_checked_at := NULL;
    NEW.lock_balance_raw := NULL;
    IF NEW.locked_raw IS NULL AND NEW.status IN ('active', 'paid') THEN
      NEW.status := 'draft';
    END IF;
    RETURN NEW;
  END IF;
  NEW.fee_paid := OLD.fee_paid;
  NEW.fee_tx := OLD.fee_tx;
  NEW.fee_amount_sol := OLD.fee_amount_sol;
  NEW.settled_count := OLD.settled_count;
  NEW.vault_reserved := OLD.vault_reserved;
  NEW.draw_seed := OLD.draw_seed;
  NEW.draw_at := OLD.draw_at;
  NEW.draw_winners := OLD.draw_winners;
  NEW.draw_slot := OLD.draw_slot;
  NEW.draw_seed_slot := OLD.draw_seed_slot;
  NEW.draw_count := OLD.draw_count;
  NEW.draw_committed_at := OLD.draw_committed_at;
  NEW.prize_raw := OLD.prize_raw;
  NEW.cut_bps := OLD.cut_bps;
  NEW.cut_raw := OLD.cut_raw;
  NEW.locked_raw := OLD.locked_raw;
  NEW.cut_wallet := OLD.cut_wallet;
  NEW.prize_mint := OLD.prize_mint;
  NEW.lock_checked_at := OLD.lock_checked_at;
  NEW.lock_balance_raw := OLD.lock_balance_raw;
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    NEW.status := OLD.status;
  END IF;
  IF OLD.locked_raw IS NULL AND NEW.status = 'active' THEN
    NEW.status := 'draft';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_settlement_privileged()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.team_signed := false;
    NEW.bard_signed := false;
    NEW.team_signed_at := NULL;
    NEW.bard_signed_at := NULL;
    NEW.status := 'proposed';
    NEW.tx_signature := NULL;
    NEW.executed_at := NULL;
    NEW.cosign_sig := NULL;
    NEW.payout_hash := NULL;
    NEW.vault_multisig := NULL;
    NEW.cut_raw := NULL;
    NEW.cut_wallet := NULL;
    NEW.cut_bps := NULL;
    NEW.cut_waived := false;
    NEW.holder_total_raw := NULL;
    RETURN NEW;
  END IF;
  NEW.team_signed := OLD.team_signed;
  NEW.bard_signed := OLD.bard_signed;
  NEW.team_signed_at := OLD.team_signed_at;
  NEW.bard_signed_at := OLD.bard_signed_at;
  NEW.status := OLD.status;
  NEW.tx_signature := OLD.tx_signature;
  NEW.executed_at := OLD.executed_at;
  NEW.cosign_sig := OLD.cosign_sig;
  NEW.payout_hash := OLD.payout_hash;
  NEW.vault_multisig := OLD.vault_multisig;
  NEW.cut_raw := OLD.cut_raw;
  NEW.cut_wallet := OLD.cut_wallet;
  NEW.cut_bps := OLD.cut_bps;
  NEW.cut_waived := OLD.cut_waived;
  NEW.holder_total_raw := OLD.holder_total_raw;
  RETURN NEW;
END;
$$;

REVOKE INSERT (prize_raw, cut_bps, cut_raw, locked_raw, cut_wallet, prize_mint, lock_checked_at, lock_balance_raw)
  ON public.campaigns FROM authenticated;
REVOKE UPDATE (prize_raw, cut_bps, cut_raw, locked_raw, cut_wallet, prize_mint, lock_checked_at, lock_balance_raw)
  ON public.campaigns FROM authenticated;

REVOKE INSERT (cut_raw, cut_wallet, cut_bps, cut_waived, holder_total_raw)
  ON public.vault_settlements FROM authenticated;
REVOKE UPDATE (cut_raw, cut_wallet, cut_bps, cut_waived, holder_total_raw)
  ON public.vault_settlements FROM authenticated;
