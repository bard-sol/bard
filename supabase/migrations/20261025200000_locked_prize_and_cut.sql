-- Locked prize and the payout cut. fee_payments rows stay.
-- A browser write cannot set the lock, and cannot leave a campaign active
-- unless the worker already stored the lock. Reservation freezes from M3 stay.
-- Coverage and the raw reservation are one locked function, not a read-then-write.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS prize_raw numeric(40, 0),
  ADD COLUMN IF NOT EXISTS cut_bps integer,
  ADD COLUMN IF NOT EXISTS cut_raw numeric(40, 0),
  ADD COLUMN IF NOT EXISTS locked_raw numeric(40, 0),
  ADD COLUMN IF NOT EXISTS cut_wallet text,
  ADD COLUMN IF NOT EXISTS prize_mint text,
  ADD COLUMN IF NOT EXISTS lock_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_balance_raw numeric(40, 0),
  ADD COLUMN IF NOT EXISTS vault_reserved_raw numeric(40, 0) NOT NULL DEFAULT 0;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS vault_reserved_raw numeric(40, 0) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.campaigns WHERE status = 'active' AND locked_raw IS NULL) THEN
    RAISE EXCEPTION 'active campaigns without a lock exist; end or re-create them before this migration';
  END IF;
END $$;

-- Copy a lock that this migration already stored. Human vault_reserved stays
-- a display value; coverage reads the raw column, which has no 8-place round.
UPDATE public.campaigns
SET vault_reserved_raw = locked_raw
WHERE vault_reserved_raw = 0
  AND locked_raw IS NOT NULL
  AND status IN ('active', 'paid');

UPDATE public.projects AS p
SET vault_reserved_raw = COALESCE((
  SELECT SUM(c.vault_reserved_raw)
  FROM public.campaigns AS c
  WHERE c.project_id = p.id
    AND c.status = 'active'
), 0)
WHERE p.vault_reserved_raw = 0;

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

CREATE UNIQUE INDEX vault_settlements_one_open_per_campaign ON public.vault_settlements (campaign_id) WHERE status <> 'cancelled';

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
    NEW.vault_reserved_raw := 0;
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
  NEW.vault_reserved_raw := OLD.vault_reserved_raw;
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

REVOKE INSERT (prize_raw, cut_bps, cut_raw, locked_raw, cut_wallet, prize_mint, lock_checked_at, lock_balance_raw, vault_reserved_raw)
  ON public.campaigns FROM authenticated;
REVOKE UPDATE (prize_raw, cut_bps, cut_raw, locked_raw, cut_wallet, prize_mint, lock_checked_at, lock_balance_raw, vault_reserved_raw)
  ON public.campaigns FROM authenticated;

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
    NEW.vault_reserved_raw := 0;
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
  NEW.vault_reserved_raw := OLD.vault_reserved_raw;
  RETURN NEW;
END;
$$;

-- Coverage and the reservation move together. The worker calls this with the
-- chain balance and the lock. A short balance returns a refusal and changes nothing.
CREATE OR REPLACE FUNCTION public.reserve_vault_raw(
  p_project_id uuid,
  p_balance_raw numeric,
  p_locked_raw numeric,
  p_campaign_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_raw numeric(40, 0);
  next_raw numeric(40, 0);
  campaign_raw numeric(40, 0);
BEGIN
  IF NOT public.is_service_role() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_project_id IS NULL OR p_balance_raw IS NULL OR p_locked_raw IS NULL
     OR p_balance_raw < 0 OR p_locked_raw <= 0
     OR p_balance_raw <> trunc(p_balance_raw)
     OR p_locked_raw <> trunc(p_locked_raw) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'short_balance');
  END IF;
  SELECT vault_reserved_raw INTO current_raw
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  next_raw := current_raw + p_locked_raw;
  IF next_raw > p_balance_raw THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'short_balance');
  END IF;
  UPDATE public.projects
  SET vault_reserved_raw = next_raw
  WHERE id = p_project_id;
  IF p_campaign_id IS NOT NULL THEN
    SELECT vault_reserved_raw INTO campaign_raw
    FROM public.campaigns
    WHERE id = p_campaign_id AND project_id = p_project_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'campaign is not in that project';
    END IF;
    campaign_raw := campaign_raw + p_locked_raw;
    UPDATE public.campaigns
    SET vault_reserved_raw = campaign_raw
    WHERE id = p_campaign_id;
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'vault_reserved_raw', next_raw::text,
    'campaign_reserved_raw', CASE WHEN p_campaign_id IS NULL THEN NULL ELSE campaign_raw::text END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_vault_raw(
  p_project_id uuid,
  p_locked_raw numeric
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_raw numeric(40, 0);
  next_raw numeric(40, 0);
BEGIN
  IF NOT public.is_service_role() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_project_id IS NULL OR p_locked_raw IS NULL OR p_locked_raw < 0
     OR p_locked_raw <> trunc(p_locked_raw) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  SELECT vault_reserved_raw INTO current_raw
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  next_raw := current_raw - p_locked_raw;
  IF next_raw < 0 THEN
    next_raw := 0;
  END IF;
  UPDATE public.projects
  SET vault_reserved_raw = next_raw
  WHERE id = p_project_id;
  RETURN jsonb_build_object('ok', true, 'vault_reserved_raw', next_raw::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_campaign_vault(
  p_project_id uuid,
  p_campaign_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_raw numeric(40, 0);
  campaign_raw numeric(40, 0);
  next_raw numeric(40, 0);
BEGIN
  IF NOT public.is_service_role() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_project_id IS NULL OR p_campaign_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  SELECT vault_reserved_raw INTO campaign_raw
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
  next_raw := current_raw - COALESCE(campaign_raw, 0);
  IF next_raw < 0 THEN
    next_raw := 0;
  END IF;
  UPDATE public.projects
  SET vault_reserved_raw = next_raw
  WHERE id = p_project_id;
  UPDATE public.campaigns
  SET vault_reserved_raw = 0
  WHERE id = p_campaign_id;
  UPDATE public.vault_reservations
  SET status = 'settled'
  WHERE campaign_id = p_campaign_id AND status = 'reserved';
  RETURN jsonb_build_object(
    'ok', true,
    'vault_reserved_raw', next_raw::text,
    'released_raw', COALESCE(campaign_raw, 0)::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_vault_raw(uuid, numeric, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_vault_raw(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_campaign_vault(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_vault_raw(uuid, numeric, numeric, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_vault_raw(uuid, numeric) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_campaign_vault(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_vault_raw(uuid, numeric, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_vault_raw(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_campaign_vault(uuid, uuid) TO service_role;

REVOKE INSERT (vault_reserved_raw) ON public.projects FROM authenticated;
REVOKE UPDATE (vault_reserved_raw) ON public.projects FROM authenticated;

REVOKE INSERT (cut_raw, cut_wallet, cut_bps, cut_waived, holder_total_raw)
  ON public.vault_settlements FROM authenticated;
REVOKE UPDATE (cut_raw, cut_wallet, cut_bps, cut_waived, holder_total_raw)
  ON public.vault_settlements FROM authenticated;
