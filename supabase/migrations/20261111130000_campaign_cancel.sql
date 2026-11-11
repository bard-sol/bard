-- TRAA-2331 (launch simulation, B7): a campaign's locked prize stayed reserved
-- in the vault when nobody joined or its payout could never execute. There was
-- no cancelled status and no way to release the reservation.
--
-- A campaign can now be cancelled, only by the worker: POST /api/campaigns/:id/cancel
-- checks on chain that no payout proposal of the campaign can still execute,
-- then calls cancel_campaign_vault. That function cancels the campaign and its
-- unexecuted settlements and releases the reservation in one transaction.
-- Paid and cancelled are final for everyone but the service role, and a
-- cancelled campaign takes no joins.
-- Rollback: supabase/migrations/down/20261111130000_campaign_cancel.sql

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_chk;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_chk
  CHECK (status IN ('active', 'ended', 'draft', 'paid', 'cancelled'));

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
    NEW.vault_reserved_raw := 0;
    IF NEW.status IN ('paid', 'cancelled') THEN
      NEW.status := 'draft';
    END IF;
    IF NEW.locked_raw IS NULL AND NEW.status = 'active' THEN
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
  NEW.vault_reserved_raw := OLD.vault_reserved_raw;
  -- Paid and cancelled are set by the worker and never left.
  IF OLD.status IN ('paid', 'cancelled') OR NEW.status IN ('paid', 'cancelled') THEN
    NEW.status := OLD.status;
  END IF;
  IF OLD.locked_raw IS NULL AND NEW.status = 'active' THEN
    NEW.status := 'draft';
  END IF;
  RETURN NEW;
END;
$$;

-- guard_campaign_join (20261110120000) refuses ended and paid campaigns. This
-- refuses a cancelled one, for every role but the service role.
CREATE OR REPLACE FUNCTION public.refuse_cancelled_campaign_join()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = NEW.campaign_id AND c.status = 'cancelled') THEN
    RAISE EXCEPTION 'campaign is not open for joins';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaign_joins_refuse_cancelled ON public.campaign_joins;
CREATE TRIGGER campaign_joins_refuse_cancelled
  BEFORE INSERT ON public.campaign_joins
  FOR EACH ROW EXECUTE FUNCTION public.refuse_cancelled_campaign_join();

-- The worker calls this after checking on chain that no payout proposal of the
-- campaign can still execute. It refuses a campaign with any payout recorded,
-- including one batch of a batched payout. Calling it again on a cancelled
-- campaign changes nothing.
CREATE OR REPLACE FUNCTION public.cancel_campaign_vault(
  p_project_id uuid,
  p_campaign_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  campaign_status text;
  campaign_raw numeric(40, 0);
  current_raw numeric(40, 0);
  next_raw numeric(40, 0);
  cancelled_count integer;
BEGIN
  IF NOT public.is_service_role() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_project_id IS NULL OR p_campaign_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  SELECT status, vault_reserved_raw INTO campaign_status, campaign_raw
  FROM public.campaigns
  WHERE id = p_campaign_id AND project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  SELECT vault_reserved_raw INTO current_raw
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  IF campaign_status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already', true,
      'released_raw', '0',
      'vault_reserved_raw', current_raw::text,
      'settlements_cancelled', 0
    );
  END IF;
  IF campaign_status = 'paid' OR EXISTS (
    SELECT 1 FROM public.vault_settlements s
    WHERE s.campaign_id = p_campaign_id
      AND (s.status = 'executed' OR (s.status <> 'cancelled' AND s.tx_signature IS NOT NULL))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.vault_settlement_batches b
    JOIN public.vault_settlements s ON s.id = b.settlement_id
    WHERE s.campaign_id = p_campaign_id AND s.status <> 'cancelled' AND b.tx_signature IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'partly_paid');
  END IF;
  next_raw := current_raw - COALESCE(campaign_raw, 0);
  IF next_raw < 0 THEN
    next_raw := 0;
  END IF;
  UPDATE public.projects
  SET vault_reserved_raw = next_raw
  WHERE id = p_project_id;
  UPDATE public.campaigns
  SET status = 'cancelled', vault_reserved = 0, vault_reserved_raw = 0
  WHERE id = p_campaign_id;
  UPDATE public.vault_settlements
  SET status = 'cancelled'
  WHERE campaign_id = p_campaign_id AND status NOT IN ('executed', 'cancelled');
  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  UPDATE public.vault_reservations
  SET status = 'released'
  WHERE campaign_id = p_campaign_id AND status = 'reserved';
  RETURN jsonb_build_object(
    'ok', true,
    'already', false,
    'released_raw', COALESCE(campaign_raw, 0)::text,
    'vault_reserved_raw', next_raw::text,
    'settlements_cancelled', cancelled_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_campaign_vault(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_campaign_vault(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_campaign_vault(uuid, uuid) TO service_role;
