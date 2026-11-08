-- Reverse 20261108120000_score_rule_v1.sql.
-- Restores x_via from holders_x_user_20261108 before dropping x_user_id.
-- Restores the join guard from 20261027160000_join_evidence.sql.
-- Does not apply to production by itself.

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

DROP TRIGGER IF EXISTS campaigns_freeze_score_rule ON public.campaigns;
DROP FUNCTION IF EXISTS public.guard_score_rule();

UPDATE public.holders h
SET x_via = s.x_via
FROM public.holders_x_user_20261108 s
WHERE h.wallet = s.wallet;

DROP INDEX IF EXISTS public.holders_x_user_oauth_uidx;
ALTER TABLE public.holders DROP CONSTRAINT IF EXISTS holders_x_user_id_digits;
ALTER TABLE public.holders DROP COLUMN IF EXISTS x_user_id;
DROP TABLE IF EXISTS public.holders_x_user_20261108;

DROP TABLE IF EXISTS public.score_engagements;
DROP TABLE IF EXISTS public.score_posts;
DROP TABLE IF EXISTS public.score_accounts;
DROP TABLE IF EXISTS public.score_audit;

ALTER TABLE public.campaign_joins DROP CONSTRAINT IF EXISTS campaign_joins_score_override_chk;
ALTER TABLE public.campaign_joins DROP COLUMN IF EXISTS score_milli;
ALTER TABLE public.campaign_joins DROP COLUMN IF EXISTS score_override;
ALTER TABLE public.campaign_joins DROP COLUMN IF EXISTS override_reason;
ALTER TABLE public.campaign_joins DROP COLUMN IF EXISTS handle_consent_at;
ALTER TABLE public.campaign_joins DROP COLUMN IF EXISTS handle_consent_version;

ALTER TABLE public.vault_settlements DROP COLUMN IF EXISTS score_inputs;
ALTER TABLE public.vault_settlements DROP COLUMN IF EXISTS score_hash;
