-- Reverse 20261027160000_join_evidence.sql
-- Drops evidence_url and referred_by. Restores the join guard from before
-- those columns existed. qualified values are not changed and are not restored
-- from anywhere else: this down does not write qualified.

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
  RETURN NEW;
END;
$$;

REVOKE INSERT (evidence_url) ON public.campaign_joins FROM authenticated;
REVOKE UPDATE (evidence_url) ON public.campaign_joins FROM authenticated;
REVOKE SELECT (evidence_url) ON public.campaign_joins FROM authenticated;

ALTER TABLE public.campaign_joins DROP CONSTRAINT IF EXISTS campaign_joins_evidence_url_len;
ALTER TABLE public.campaign_joins DROP COLUMN IF EXISTS evidence_url;
ALTER TABLE public.campaign_joins DROP COLUMN IF EXISTS referred_by;
