-- Way back for 20261025200000_locked_prize_and_cut.sql.
-- Restores the M3 campaign guard and the pre-cut settlement guard.
-- Kept out of supabase/migrations so the test runner does not apply it as an up.

DROP FUNCTION IF EXISTS public.release_campaign_vault(uuid, uuid);
DROP FUNCTION IF EXISTS public.release_vault_raw(uuid, numeric);
DROP FUNCTION IF EXISTS public.reserve_vault_raw(uuid, numeric, numeric, uuid);

CREATE OR REPLACE FUNCTION public.guard_project_privileged()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.plan := 'free';
    NEW.plan_tx := NULL;
    NEW.plan_paid_at := NULL;
    NEW.fee_paid := false;
    NEW.fee_tx := NULL;
    NEW.fee_amount_sol := 0;
    NEW.vault_address := NULL;
    NEW.vault_multisig := NULL;
    NEW.vault_status := 'none';
    NEW.vault_linked_at := NULL;
    NEW.vault_mint := NULL;
    NEW.vault_reserved := 0;
    IF public.jwt_wallet() IS NOT NULL THEN
      NEW.admin_wallet := public.jwt_wallet();
      NEW.created_by := public.jwt_wallet();
    END IF;
    RETURN NEW;
  END IF;
  NEW.plan := OLD.plan;
  NEW.plan_tx := OLD.plan_tx;
  NEW.plan_paid_at := OLD.plan_paid_at;
  NEW.fee_paid := OLD.fee_paid;
  NEW.fee_tx := OLD.fee_tx;
  NEW.fee_amount_sol := OLD.fee_amount_sol;
  NEW.vault_address := OLD.vault_address;
  NEW.vault_multisig := OLD.vault_multisig;
  NEW.vault_status := OLD.vault_status;
  NEW.vault_linked_at := OLD.vault_linked_at;
  NEW.vault_mint := OLD.vault_mint;
  NEW.admin_wallet := OLD.admin_wallet;
  NEW.vault_reserved := OLD.vault_reserved;
  RETURN NEW;
END;
$$;

ALTER TABLE public.projects DROP COLUMN IF EXISTS vault_reserved_raw;

ALTER TABLE public.projects ALTER COLUMN fee_paid SET DEFAULT false;
ALTER TABLE public.campaigns ALTER COLUMN fee_paid SET DEFAULT false;
ALTER TABLE public.platform_claims ALTER COLUMN fee_paid SET DEFAULT false;

ALTER TABLE public.vault_settlements
  DROP COLUMN IF EXISTS holder_total_raw,
  DROP COLUMN IF EXISTS cut_waived,
  DROP COLUMN IF EXISTS cut_bps,
  DROP COLUMN IF EXISTS cut_wallet,
  DROP COLUMN IF EXISTS cut_raw;

ALTER TABLE public.campaigns
  DROP COLUMN IF EXISTS lock_balance_raw,
  DROP COLUMN IF EXISTS lock_checked_at,
  DROP COLUMN IF EXISTS prize_mint,
  DROP COLUMN IF EXISTS cut_wallet,
  DROP COLUMN IF EXISTS locked_raw,
  DROP COLUMN IF EXISTS cut_raw,
  DROP COLUMN IF EXISTS cut_bps,
  DROP COLUMN IF EXISTS prize_raw;

UPDATE public.campaigns SET status = 'ended' WHERE status = 'paid';
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_chk;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_chk
  CHECK (status IN ('active', 'ended', 'draft'));

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
  RETURN NEW;
END;
$$;

ALTER TABLE public.campaigns DROP COLUMN IF EXISTS vault_reserved_raw;
