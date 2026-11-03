-- Join evidence for the team review queue.
-- evidence_url is the raid post link the holder submits on their own row.
-- referred_by is the referrer wallet. Only the worker (service role) writes it.
--
-- Apply this to a database that already has joins only after copying
-- public.campaign_joins (at least id, campaign_id, wallet, qualified,
-- status, progress, x_handle, note). This file does not copy production
-- data and it does not run against the live database by itself.
--
-- qualified is not changed here. The down migration drops both columns
-- and restores the previous join guard. Existing qualified values stay.
-- supabase/migrations/down/20261027160000_join_evidence.sql

ALTER TABLE public.campaign_joins
  ADD COLUMN IF NOT EXISTS evidence_url text,
  ADD COLUMN IF NOT EXISTS referred_by text;

ALTER TABLE public.campaign_joins
  DROP CONSTRAINT IF EXISTS campaign_joins_evidence_url_len;
ALTER TABLE public.campaign_joins
  ADD CONSTRAINT campaign_joins_evidence_url_len
  CHECK (evidence_url IS NULL OR char_length(evidence_url) <= 300);

COMMENT ON COLUMN public.campaign_joins.evidence_url IS
  'Raid post link the holder submitted. Text only. The worker never fetches it.';
COMMENT ON COLUMN public.campaign_joins.referred_by IS
  'Referrer wallet, set by the worker when that wallet has a join in this campaign. Holders cannot write it.';

-- The holder own-row grant gains evidence_url and nothing else.
-- qualified, referred_by, status, and progress stay off this grant.
GRANT INSERT (evidence_url) ON public.campaign_joins TO authenticated;
GRANT UPDATE (evidence_url) ON public.campaign_joins TO authenticated;
GRANT SELECT (evidence_url) ON public.campaign_joins TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_campaign_join()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  access text;
  roster text;
  campaign_project uuid;
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.qualified := false;
    NEW.qualified_at := NULL;
    NEW.progress := 0;
    NEW.referred_by := NULL;
    -- The campaign owns the project. A client-supplied project_id must not
    -- pick another roster or hide the handle from this project's admin.
    SELECT c.access_mode, c.project_id INTO access, campaign_project
      FROM public.campaigns c WHERE c.id = NEW.campaign_id;
    IF campaign_project IS NULL THEN
      RAISE EXCEPTION 'campaign not found';
    END IF;
    NEW.project_id := campaign_project;
    SELECT r.role INTO roster FROM public.project_roster r
      WHERE r.project_id = NEW.project_id AND r.wallet = NEW.wallet;
    IF roster = 'blocked' THEN
      RAISE EXCEPTION 'wallet is blocked';
    ELSIF roster IN ('trusted', 'whale') THEN
      NEW.status := 'approved';
    ELSIF access = 'approval' THEN
      NEW.status := 'pending';
    ELSE
      NEW.status := 'approved';
    END IF;
    RETURN NEW;
  END IF;
  NEW.status := OLD.status;
  NEW.progress := OLD.progress;
  NEW.qualified := OLD.qualified;
  NEW.qualified_at := OLD.qualified_at;
  NEW.wallet := OLD.wallet;
  NEW.campaign_id := OLD.campaign_id;
  NEW.project_id := OLD.project_id;
  NEW.referred_by := OLD.referred_by;
  RETURN NEW;
END;
$$;
