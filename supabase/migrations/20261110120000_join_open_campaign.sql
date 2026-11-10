-- TRAA-2319 (launch simulation, B8): a holder could join a campaign after it
-- ended, after its end date, or after it was paid. The page hides the join
-- button, but the database accepted the row, and a late join could then be
-- qualified and scored. A non-service join is now refused once the campaign
-- is ended or paid, or is past its end date. Service role is unchanged.

CREATE OR REPLACE FUNCTION public.guard_campaign_join()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  access text;
  roster text;
  campaign_project uuid;
  campaign_config jsonb;
  campaign_status text;
  campaign_mode text;
  campaign_created timestamptz;
  campaign_days int;
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.qualified := false;
    NEW.qualified_at := NULL;
    NEW.progress := 0;
    NEW.referred_by := NULL;
    NEW.score_milli := NULL;
    NEW.score_override := NULL;
    NEW.override_reason := NULL;
    SELECT c.access_mode, c.project_id, c.config, c.status, c.reward_mode, c.created_at, c.duration_days
      INTO access, campaign_project, campaign_config, campaign_status, campaign_mode, campaign_created, campaign_days
      FROM public.campaigns c WHERE c.id = NEW.campaign_id;
    IF campaign_project IS NULL THEN
      RAISE EXCEPTION 'campaign not found';
    END IF;
    IF campaign_status IN ('ended', 'paid') THEN
      RAISE EXCEPTION 'campaign is not open for joins';
    END IF;
    -- Same end as server/campaign_state.js clockFor: growing has no end.
    IF campaign_mode IS DISTINCT FROM 'growing' AND campaign_days > 0
       AND now() >= campaign_created + make_interval(days => campaign_days) THEN
      RAISE EXCEPTION 'campaign is not open for joins';
    END IF;
    NEW.project_id := campaign_project;
    IF campaign_config ? 'scoreRule' THEN
      IF NEW.handle_consent_at IS NULL OR NEW.handle_consent_version IS DISTINCT FROM 'bard-score-v1' THEN
        RAISE EXCEPTION 'join needs score consent';
      END IF;
    END IF;
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
  NEW.score_milli := OLD.score_milli;
  NEW.score_override := OLD.score_override;
  NEW.override_reason := OLD.override_reason;
  NEW.handle_consent_at := OLD.handle_consent_at;
  NEW.handle_consent_version := OLD.handle_consent_version;
  RETURN NEW;
END;
$$;
