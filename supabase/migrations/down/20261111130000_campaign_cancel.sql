-- Reverse 20261111130000_campaign_cancel.sql
-- Run only when no campaign is cancelled: the restored status check has no 'cancelled'.

DROP FUNCTION IF EXISTS public.cancel_campaign_vault(uuid, uuid);
DROP TRIGGER IF EXISTS campaign_joins_refuse_cancelled ON public.campaign_joins;
DROP FUNCTION IF EXISTS public.refuse_cancelled_campaign_join();

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_chk;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_chk
  CHECK (status IN ('active', 'ended', 'draft', 'paid'));

-- guard_campaign_privileged as of 20261025200000_locked_prize_and_cut.sql.
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
