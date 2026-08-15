-- Campaign builder modules + join approval / progress tracking
-- Safe to re-run. Adds columns used by platform.js mapCampaignRow / mapJoinRow
-- and admin holders panel (approve / +progress, no proof paste).

-- campaigns: modular fields for versatile raids, pools, access
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS raid_mode text,
  ADD COLUMN IF NOT EXISTS reward_mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS post_url text,
  ADD COLUMN IF NOT EXISTS targets text,
  ADD COLUMN IF NOT EXISTS bonus_handle text,
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Constraints (drop first if re-running with different defs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_access_mode_chk'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_access_mode_chk
      CHECK (access_mode IN ('open', 'approval'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_reward_mode_chk'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_reward_mode_chk
      CHECK (reward_mode IN ('fixed', 'top3', 'pool', 'growing', 'vested'));
  END IF;
END $$;

-- campaign_joins: status + progress for team semi-auto review
ALTER TABLE public.campaign_joins
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS progress int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_joins_status_chk'
  ) THEN
    ALTER TABLE public.campaign_joins
      ADD CONSTRAINT campaign_joins_status_chk
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS campaign_joins_status_idx ON public.campaign_joins (status);
CREATE INDEX IF NOT EXISTS campaign_joins_progress_idx ON public.campaign_joins (campaign_id, progress DESC);

COMMENT ON COLUMN public.campaigns.access_mode IS 'open | approval — team must accept joins';
COMMENT ON COLUMN public.campaigns.raid_mode IS 'open | post | kol_list — narrative style for raid campaigns';
COMMENT ON COLUMN public.campaigns.reward_mode IS 'fixed | top3 | pool | growing | vested';
COMMENT ON COLUMN public.campaigns.bonus_handle IS 'Optional @handle that unlocks extra pool (e.g. Elon-style)';
COMMENT ON COLUMN public.campaign_joins.status IS 'pending | approved | rejected';
COMMENT ON COLUMN public.campaign_joins.progress IS 'Team-tracked progress score; no holder proof paste required';
