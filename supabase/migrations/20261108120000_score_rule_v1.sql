-- Bard scoring rule v1.
-- Do not apply this to production. Back up public.holders first.
-- It adds the score tables, the settlement snapshot columns, and x_user_id.
-- Handles found on two or more oauth wallets are set unverified. The snapshot
-- holders_x_user_20261108 keeps the previous x_via. Other rows are not changed
-- and their x_user_id stays null. Rollback is
-- supabase/migrations/down/20261108120000_score_rule_v1.sql.

ALTER TABLE public.holders
  ADD COLUMN IF NOT EXISTS x_user_id text;

ALTER TABLE public.holders
  DROP CONSTRAINT IF EXISTS holders_x_user_id_digits;
ALTER TABLE public.holders
  ADD CONSTRAINT holders_x_user_id_digits
  CHECK (x_user_id IS NULL OR x_user_id ~ '^[0-9]{1,32}$');

CREATE TABLE IF NOT EXISTS public.holders_x_user_20261108 (
  wallet text PRIMARY KEY,
  x_handle text,
  x_via text,
  x_user_id text
);

REVOKE ALL ON TABLE public.holders_x_user_20261108 FROM PUBLIC;
REVOKE ALL ON TABLE public.holders_x_user_20261108 FROM anon;
REVOKE ALL ON TABLE public.holders_x_user_20261108 FROM authenticated;
ALTER TABLE public.holders_x_user_20261108 ENABLE ROW LEVEL SECURITY;

INSERT INTO public.holders_x_user_20261108 (wallet, x_handle, x_via, x_user_id)
SELECT h.wallet, h.x_handle, h.x_via, h.x_user_id
FROM public.holders h
ON CONFLICT (wallet) DO NOTHING;

WITH dupes AS (
  SELECT lower(regexp_replace(btrim(x_handle), '^@+', '')) AS handle
  FROM public.holders
  WHERE x_via = 'oauth'
    AND btrim(coalesce(x_handle, '')) <> ''
  GROUP BY 1
  HAVING count(*) >= 2
)
UPDATE public.holders h
SET x_via = 'unverified'
WHERE h.x_via = 'oauth'
  AND lower(regexp_replace(btrim(coalesce(h.x_handle, '')), '^@+', '')) IN (SELECT handle FROM dupes);

CREATE UNIQUE INDEX IF NOT EXISTS holders_x_user_oauth_uidx
  ON public.holders (x_user_id)
  WHERE x_via = 'oauth' AND x_user_id IS NOT NULL;

COMMENT ON TABLE public.holders_x_user_20261108 IS
  'Snapshot of every holder before duplicate oauth handles were marked unverified. No grants for anon or authenticated.';
COMMENT ON COLUMN public.holders.x_user_id IS
  'X user id from users/me. Unique while x_via is oauth. Handles are not unique.';

-- Score tables. The worker (service role) is the only writer.
-- score_audit is append-only in the app. UPDATE and DELETE are granted only
-- to service_role so a database check can see that, and to nobody else.

CREATE TABLE IF NOT EXISTS public.score_accounts (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  handle text NOT NULL,
  x_created_on date,
  followers integer NOT NULL DEFAULT 0,
  following integer NOT NULL DEFAULT 0,
  is_bot boolean NOT NULL DEFAULT false,
  bot_reason text,
  entered_by text,
  entered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, handle),
  CONSTRAINT score_accounts_handle_chk CHECK (handle = lower(handle) AND left(handle, 1) <> '@' AND handle <> ''),
  CONSTRAINT score_accounts_counts_chk CHECK (followers >= 0 AND following >= 0)
);

CREATE TABLE IF NOT EXISTS public.score_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  wallet text NOT NULL,
  handle text NOT NULL,
  post_id text NOT NULL,
  posted_at timestamptz NOT NULL,
  "text" text NOT NULL DEFAULT '',
  deleted boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL,
  excluded boolean NOT NULL DEFAULT false,
  exclude_reason text,
  entered_by text,
  entered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_posts_post_id_uidx UNIQUE (post_id),
  CONSTRAINT score_posts_handle_chk CHECK (handle = lower(handle) AND left(handle, 1) <> '@' AND handle <> '')
);

CREATE INDEX IF NOT EXISTS score_posts_campaign_idx ON public.score_posts (campaign_id);

CREATE TABLE IF NOT EXISTS public.score_engagements (
  post_row_id uuid NOT NULL REFERENCES public.score_posts(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  engager_handle text NOT NULL,
  kind text NOT NULL,
  entered_by text,
  entered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_row_id, engager_handle, kind),
  CONSTRAINT score_engagements_handle_chk CHECK (engager_handle = lower(engager_handle) AND left(engager_handle, 1) <> '@' AND engager_handle <> ''),
  CONSTRAINT score_engagements_kind_chk CHECK (kind IN ('quote', 'reply', 'repost', 'like'))
);

CREATE INDEX IF NOT EXISTS score_engagements_campaign_idx ON public.score_engagements (campaign_id);

CREATE TABLE IF NOT EXISTS public.score_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  actor text,
  subject_wallet text,
  subject_handle text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS score_audit_campaign_idx ON public.score_audit (campaign_id);

REVOKE ALL ON public.score_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.score_posts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.score_engagements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.score_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.score_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.score_posts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.score_engagements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.score_audit TO service_role;

ALTER TABLE public.score_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_joins
  ADD COLUMN IF NOT EXISTS score_milli bigint,
  ADD COLUMN IF NOT EXISTS score_override text,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS handle_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS handle_consent_version text;

ALTER TABLE public.campaign_joins
  DROP CONSTRAINT IF EXISTS campaign_joins_score_override_chk;
ALTER TABLE public.campaign_joins
  ADD CONSTRAINT campaign_joins_score_override_chk
  CHECK (score_override IS NULL OR score_override IN ('include', 'exclude'));

GRANT INSERT (handle_consent_at, handle_consent_version) ON public.campaign_joins TO authenticated;

ALTER TABLE public.vault_settlements
  ADD COLUMN IF NOT EXISTS score_inputs jsonb,
  ADD COLUMN IF NOT EXISTS score_hash text;

-- Non-service joins cannot write a score. A scored campaign also requires the
-- consent checkbox. Service role still returns before those checks.
CREATE OR REPLACE FUNCTION public.guard_campaign_join()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  access text;
  roster text;
  campaign_project uuid;
  campaign_config jsonb;
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
    SELECT c.access_mode, c.project_id, c.config INTO access, campaign_project, campaign_config
      FROM public.campaigns c WHERE c.id = NEW.campaign_id;
    IF campaign_project IS NULL THEN
      RAISE EXCEPTION 'campaign not found';
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

-- scoreRule is written once, by the service role, at insert. Any later change
-- is refused, including a change by the service role.
CREATE OR REPLACE FUNCTION public.guard_score_rule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.config IS NULL THEN
    NEW.config := '{}'::jsonb;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_service_role() THEN
      NEW.config := NEW.config - 'scoreRule';
    END IF;
    RETURN NEW;
  END IF;
  IF (COALESCE(NEW.config, '{}'::jsonb)->'scoreRule') IS DISTINCT FROM (COALESCE(OLD.config, '{}'::jsonb)->'scoreRule') THEN
    RAISE EXCEPTION 'score rule is frozen';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_freeze_score_rule ON public.campaigns;
CREATE TRIGGER campaigns_freeze_score_rule
  BEFORE INSERT OR UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_score_rule();
