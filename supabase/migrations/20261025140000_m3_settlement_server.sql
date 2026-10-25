-- M3 settlement on M2.
-- Apply after 20261024130000_m2_identity_rls.sql. Do not edit that file.
-- One-shot draw columns, and the privileged settlement writes, belong to
-- the worker (service_role). A browser session cannot propose, reserve,
-- execute, or draw.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS draw_slot bigint,
  ADD COLUMN IF NOT EXISTS draw_seed_slot bigint,
  ADD COLUMN IF NOT EXISTS draw_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draw_committed_at timestamptz;

CREATE OR REPLACE FUNCTION public.campaigns_draw_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.draw_slot IS NOT NULL AND NEW.draw_slot IS DISTINCT FROM OLD.draw_slot THEN
    RAISE EXCEPTION 'Draw slot already committed';
  END IF;
  IF OLD.draw_slot IS NOT NULL AND NEW.draw_count IS DISTINCT FROM OLD.draw_count THEN
    RAISE EXCEPTION 'Draw slot already committed';
  END IF;
  IF OLD.draw_seed IS NOT NULL AND NEW.draw_seed IS DISTINCT FROM OLD.draw_seed THEN
    RAISE EXCEPTION 'Draw already finalized';
  END IF;
  IF OLD.draw_winners IS NOT NULL AND NEW.draw_winners IS DISTINCT FROM OLD.draw_winners THEN
    RAISE EXCEPTION 'Draw already finalized';
  END IF;
  IF OLD.draw_seed_slot IS NOT NULL AND NEW.draw_seed_slot IS DISTINCT FROM OLD.draw_seed_slot THEN
    RAISE EXCEPTION 'Draw already finalized';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_draw_once ON public.campaigns;
CREATE TRIGGER campaigns_draw_once
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.campaigns_draw_once();

-- Freeze reserve and draw columns even if a later grant gives them back.
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

CREATE OR REPLACE FUNCTION public.guard_vault_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'reservation is server-only';
END;
$$;

DROP TRIGGER IF EXISTS vault_reservations_guard ON public.vault_reservations;
CREATE TRIGGER vault_reservations_guard
  BEFORE INSERT OR UPDATE ON public.vault_reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_vault_reservation();

REVOKE UPDATE (vault_reserved) ON public.projects FROM authenticated;

REVOKE INSERT (vault_reserved, draw_seed, draw_at, draw_winners)
  ON public.campaigns FROM authenticated;
REVOKE UPDATE (vault_reserved, draw_seed, draw_at, draw_winners)
  ON public.campaigns FROM authenticated;

-- M2 granted these by column. A table-level REVOKE does not clear column grants.
REVOKE INSERT (project_id, campaign_id, amount, status)
  ON public.vault_reservations FROM authenticated;
REVOKE UPDATE (amount, status)
  ON public.vault_reservations FROM authenticated;

REVOKE INSERT (project_id, campaign_id, payouts, total, unit)
  ON public.vault_settlements FROM authenticated;
REVOKE UPDATE (payouts, total, unit, tx_index, cosigned_wallet)
  ON public.vault_settlements FROM authenticated;

GRANT EXECUTE ON FUNCTION public.campaigns_draw_once() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_vault_reservation() TO service_role;
