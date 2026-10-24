-- M2 identity and authorization.
-- Replaces the open anon policies on the platform tables.
-- Privileged columns stay writable by service_role (the worker) only.
-- Apply on a database that already has the platform migrations.
-- Do not delete existing fee_payments rows.

-- ------------------------------------------------------------
-- Roles. Supabase already has these; local tests create them.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT anon TO ' || current_user;
  EXECUTE 'GRANT authenticated TO ' || current_user;
  EXECUTE 'GRANT service_role TO ' || current_user;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Used sign-in nonces. The nonce itself is an HMAC the worker
-- can check without shared memory. This table only records use,
-- so a second isolate cannot accept the same nonce.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_nonces (
  jti text PRIMARY KEY,
  wallet text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_nonces_expires_idx ON public.auth_nonces (expires_at);

-- One confirmed fee signature can be recorded once. Null signatures
-- (the historical rows) stay allowed. Do not delete those rows.
CREATE UNIQUE INDEX IF NOT EXISTS fee_payments_tx_uidx
  ON public.fee_payments (tx_signature)
  WHERE tx_signature IS NOT NULL;

-- ------------------------------------------------------------
-- Checks the code actually writes
-- ------------------------------------------------------------
UPDATE public.campaigns SET reward_mode = 'growing' WHERE reward_mode = 'vested';
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_reward_mode_chk;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_reward_mode_chk
  CHECK (reward_mode IN ('fixed', 'top3', 'pool', 'growing'));
COMMENT ON COLUMN public.campaigns.reward_mode IS 'fixed | top3 | pool | growing';

UPDATE public.campaigns
  SET type = 'custom'
  WHERE type NOT IN ('hold', 'raid', 'refer', 'custom');
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_type_chk;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_type_chk
  CHECK (type IN ('hold', 'raid', 'refer', 'custom'));

ALTER TABLE public.vault_settlements DROP CONSTRAINT IF EXISTS vault_settlements_status_chk;
ALTER TABLE public.vault_settlements
  ADD CONSTRAINT vault_settlements_status_chk
  CHECK (status IN (
    'proposed', 'awaiting_team', 'awaiting_bard', 'both_signed',
    'cosigned', 'executed', 'cancelled'
  ));

-- ------------------------------------------------------------
-- Helpers. auth.jwt() is Supabase's. Tests install a shim first.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jwt_wallet()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(auth.jwt()->>'wallet', '');
$$;

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_user IN ('service_role', 'postgres', 'supabase_admin')
    OR coalesce(auth.jwt()->>'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.is_project_admin(pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = pid AND p.admin_wallet IS NOT NULL AND p.admin_wallet = public.jwt_wallet()
  );
$$;

CREATE OR REPLACE FUNCTION public.visible_x_handle(row_wallet text, pid uuid, handle text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN public.jwt_wallet() IS NOT NULL AND (
      public.jwt_wallet() = row_wallet OR public.is_project_admin(pid)
    ) THEN handle
    ELSE NULL
  END;
$$;

-- Holder join: the holder never chooses status, score, or qualified.
-- Approval campaigns start pending unless the roster auto-approves.
CREATE OR REPLACE FUNCTION public.guard_campaign_join()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  access text;
  roster text;
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.qualified := false;
    NEW.qualified_at := NULL;
    NEW.progress := 0;
    SELECT c.access_mode INTO access FROM public.campaigns c WHERE c.id = NEW.campaign_id;
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

DROP TRIGGER IF EXISTS campaign_joins_guard ON public.campaign_joins;
CREATE TRIGGER campaign_joins_guard
  BEFORE INSERT OR UPDATE ON public.campaign_joins
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_join();

-- Project fee, plan, and vault link columns are worker-only.
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_guard_privileged ON public.projects;
CREATE TRIGGER projects_guard_privileged
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_privileged();

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
    RETURN NEW;
  END IF;
  NEW.fee_paid := OLD.fee_paid;
  NEW.fee_tx := OLD.fee_tx;
  NEW.fee_amount_sol := OLD.fee_amount_sol;
  NEW.settled_count := OLD.settled_count;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_guard_privileged ON public.campaigns;
CREATE TRIGGER campaigns_guard_privileged
  BEFORE INSERT OR UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_privileged();

-- The browser cannot mark a settlement signed, released, or settled.
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vault_settlements_guard_privileged ON public.vault_settlements;
CREATE TRIGGER vault_settlements_guard_privileged
  BEFORE INSERT OR UPDATE ON public.vault_settlements
  FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_privileged();

-- Public read of joins with the handle masked unless it is yours
-- or you admin a project that wallet joined.
CREATE OR REPLACE VIEW public.campaign_join_feed
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  j.id,
  j.campaign_id,
  j.project_id,
  j.wallet,
  public.visible_x_handle(j.wallet, j.project_id, j.x_handle) AS x_handle,
  j.qualified,
  j.joined_at,
  j.qualified_at,
  j.status,
  j.progress,
  j.note
FROM public.campaign_joins j;

-- ------------------------------------------------------------
-- Privileges. RLS is the row gate. Column grants are the field gate.
-- ------------------------------------------------------------
REVOKE ALL ON public.projects FROM anon, authenticated;
REVOKE ALL ON public.campaigns FROM anon, authenticated;
REVOKE ALL ON public.holders FROM anon, authenticated;
REVOKE ALL ON public.campaign_joins FROM anon, authenticated;
REVOKE ALL ON public.platform_claims FROM anon, authenticated;
REVOKE ALL ON public.fee_payments FROM anon, authenticated;
REVOKE ALL ON public.vault_settlements FROM anon, authenticated;
REVOKE ALL ON public.vault_reservations FROM anon, authenticated;
REVOKE ALL ON public.project_roster FROM anon, authenticated;
REVOKE ALL ON public.auth_nonces FROM anon, authenticated;
REVOKE ALL ON public.campaign_join_feed FROM anon, authenticated;

GRANT ALL ON public.projects TO service_role;
GRANT ALL ON public.campaigns TO service_role;
GRANT ALL ON public.holders TO service_role;
GRANT ALL ON public.campaign_joins TO service_role;
GRANT ALL ON public.platform_claims TO service_role;
GRANT ALL ON public.fee_payments TO service_role;
GRANT ALL ON public.vault_settlements TO service_role;
GRANT ALL ON public.vault_reservations TO service_role;
GRANT ALL ON public.project_roster TO service_role;
GRANT ALL ON public.auth_nonces TO service_role;
GRANT ALL ON public.campaign_join_feed TO service_role;

-- Explore and the public dashboard.
GRANT SELECT ON public.projects TO anon, authenticated;
GRANT SELECT ON public.campaigns TO anon, authenticated;
GRANT SELECT ON public.vault_settlements TO anon, authenticated;
GRANT SELECT ON public.vault_reservations TO anon, authenticated;
GRANT SELECT (
  id, campaign_id, project_id, wallet, qualified, joined_at, qualified_at, status, progress, note
) ON public.campaign_joins TO anon, authenticated;
GRANT SELECT ON public.campaign_join_feed TO anon, authenticated;

-- No anon read of holders, claims, fees, roster, or nonces.
GRANT SELECT ON public.holders TO authenticated;
GRANT SELECT ON public.platform_claims TO authenticated;
GRANT SELECT ON public.project_roster TO authenticated;

-- Team writes: the admin of that project.
GRANT INSERT (
  name, ticker, mint, chain, admin_wallet, created_by
) ON public.projects TO authenticated;
GRANT UPDATE (
  name, ticker, chain, vault_reserved
) ON public.projects TO authenticated;

GRANT INSERT (
  project_id, title, type, rule_text, reward, reward_unit, pool_size, duration_days, status,
  access_mode, raid_mode, reward_mode, post_url, targets, bonus_handle, config, vault_reserved,
  draw_seed, draw_at, draw_winners
) ON public.campaigns TO authenticated;
GRANT UPDATE (
  title, type, rule_text, reward, reward_unit, pool_size, duration_days, status,
  access_mode, raid_mode, reward_mode, post_url, targets, bonus_handle, config, vault_reserved,
  draw_seed, draw_at, draw_winners
) ON public.campaigns TO authenticated;

GRANT INSERT (project_id, wallet, role, note) ON public.project_roster TO authenticated;
GRANT UPDATE (role, note) ON public.project_roster TO authenticated;
GRANT DELETE ON public.project_roster TO authenticated;

GRANT INSERT (project_id, campaign_id, amount, status) ON public.vault_reservations TO authenticated;
GRANT UPDATE (amount, status) ON public.vault_reservations TO authenticated;

GRANT INSERT (
  project_id, campaign_id, payouts, total, unit, payout_hash, vault_multisig
) ON public.vault_settlements TO authenticated;
GRANT UPDATE (
  payouts, total, unit, payout_hash, vault_multisig, tx_index, cosigned_wallet
) ON public.vault_settlements TO authenticated;

-- Holder writes: own profile and own join, never the review columns.
GRANT INSERT (wallet, x_handle, x_linked_at, x_via) ON public.holders TO authenticated;
GRANT UPDATE (x_handle, x_linked_at, x_via) ON public.holders TO authenticated;

GRANT INSERT (
  campaign_id, project_id, wallet, x_handle, joined_at, note
) ON public.campaign_joins TO authenticated;
GRANT UPDATE (x_handle, note) ON public.campaign_joins TO authenticated;

GRANT EXECUTE ON FUNCTION public.jwt_wallet() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_admin(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visible_x_handle(text, uuid, text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Row policies
-- ------------------------------------------------------------
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_joins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_nonces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_public_read ON public.projects;
DROP POLICY IF EXISTS projects_admin_insert ON public.projects;
DROP POLICY IF EXISTS projects_admin_update ON public.projects;
CREATE POLICY projects_public_read ON public.projects FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY projects_admin_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (admin_wallet = public.jwt_wallet() AND created_by = public.jwt_wallet());
CREATE POLICY projects_admin_update ON public.projects FOR UPDATE TO authenticated
  USING (admin_wallet = public.jwt_wallet())
  WITH CHECK (admin_wallet = public.jwt_wallet());

DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
DROP POLICY IF EXISTS campaigns_insert ON public.campaigns;
DROP POLICY IF EXISTS campaigns_update ON public.campaigns;
DROP POLICY IF EXISTS campaigns_public_read ON public.campaigns;
DROP POLICY IF EXISTS campaigns_admin_write ON public.campaigns;
DROP POLICY IF EXISTS campaigns_admin_update ON public.campaigns;
CREATE POLICY campaigns_public_read ON public.campaigns FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY campaigns_admin_write ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (public.is_project_admin(project_id));
CREATE POLICY campaigns_admin_update ON public.campaigns FOR UPDATE TO authenticated
  USING (public.is_project_admin(project_id))
  WITH CHECK (public.is_project_admin(project_id));

DROP POLICY IF EXISTS holders_select ON public.holders;
DROP POLICY IF EXISTS holders_insert ON public.holders;
DROP POLICY IF EXISTS holders_update ON public.holders;
DROP POLICY IF EXISTS holders_private_read ON public.holders;
DROP POLICY IF EXISTS holders_own_insert ON public.holders;
DROP POLICY IF EXISTS holders_own_update ON public.holders;
CREATE POLICY holders_private_read ON public.holders FOR SELECT TO authenticated
  USING (
    wallet = public.jwt_wallet()
    OR EXISTS (
      SELECT 1 FROM public.campaign_joins j
      WHERE j.wallet = holders.wallet AND public.is_project_admin(j.project_id)
    )
  );
CREATE POLICY holders_own_insert ON public.holders FOR INSERT TO authenticated
  WITH CHECK (wallet = public.jwt_wallet());
CREATE POLICY holders_own_update ON public.holders FOR UPDATE TO authenticated
  USING (wallet = public.jwt_wallet())
  WITH CHECK (wallet = public.jwt_wallet());

DROP POLICY IF EXISTS campaign_joins_select ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_insert ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_update ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_public_read ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_own_insert ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_own_update ON public.campaign_joins;
CREATE POLICY campaign_joins_public_read ON public.campaign_joins FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY campaign_joins_own_insert ON public.campaign_joins FOR INSERT TO authenticated
  WITH CHECK (wallet = public.jwt_wallet());
CREATE POLICY campaign_joins_own_update ON public.campaign_joins FOR UPDATE TO authenticated
  USING (wallet = public.jwt_wallet())
  WITH CHECK (wallet = public.jwt_wallet());

DROP POLICY IF EXISTS platform_claims_select ON public.platform_claims;
DROP POLICY IF EXISTS platform_claims_insert ON public.platform_claims;
DROP POLICY IF EXISTS platform_claims_update ON public.platform_claims;
DROP POLICY IF EXISTS platform_claims_private_read ON public.platform_claims;
CREATE POLICY platform_claims_private_read ON public.platform_claims FOR SELECT TO authenticated
  USING (wallet = public.jwt_wallet() OR public.is_project_admin(project_id));

DROP POLICY IF EXISTS fee_payments_select ON public.fee_payments;
DROP POLICY IF EXISTS fee_payments_insert ON public.fee_payments;
DROP POLICY IF EXISTS fee_payments_update ON public.fee_payments;

DROP POLICY IF EXISTS vault_settlements_select ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_insert ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_update ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_public_read ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_admin_insert ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_admin_update ON public.vault_settlements;
CREATE POLICY vault_settlements_public_read ON public.vault_settlements FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY vault_settlements_admin_insert ON public.vault_settlements FOR INSERT TO authenticated
  WITH CHECK (public.is_project_admin(project_id));
CREATE POLICY vault_settlements_admin_update ON public.vault_settlements FOR UPDATE TO authenticated
  USING (public.is_project_admin(project_id))
  WITH CHECK (public.is_project_admin(project_id));

DROP POLICY IF EXISTS vault_reservations_select ON public.vault_reservations;
DROP POLICY IF EXISTS vault_reservations_insert ON public.vault_reservations;
DROP POLICY IF EXISTS vault_reservations_update ON public.vault_reservations;
DROP POLICY IF EXISTS vault_reservations_public_read ON public.vault_reservations;
DROP POLICY IF EXISTS vault_reservations_admin_insert ON public.vault_reservations;
DROP POLICY IF EXISTS vault_reservations_admin_update ON public.vault_reservations;
CREATE POLICY vault_reservations_public_read ON public.vault_reservations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY vault_reservations_admin_insert ON public.vault_reservations FOR INSERT TO authenticated
  WITH CHECK (public.is_project_admin(project_id));
CREATE POLICY vault_reservations_admin_update ON public.vault_reservations FOR UPDATE TO authenticated
  USING (public.is_project_admin(project_id))
  WITH CHECK (public.is_project_admin(project_id));

DROP POLICY IF EXISTS project_roster_select ON public.project_roster;
DROP POLICY IF EXISTS project_roster_insert ON public.project_roster;
DROP POLICY IF EXISTS project_roster_update ON public.project_roster;
DROP POLICY IF EXISTS project_roster_delete ON public.project_roster;
DROP POLICY IF EXISTS project_roster_private_read ON public.project_roster;
DROP POLICY IF EXISTS project_roster_admin_insert ON public.project_roster;
DROP POLICY IF EXISTS project_roster_admin_update ON public.project_roster;
DROP POLICY IF EXISTS project_roster_admin_delete ON public.project_roster;
CREATE POLICY project_roster_private_read ON public.project_roster FOR SELECT TO authenticated
  USING (wallet = public.jwt_wallet() OR public.is_project_admin(project_id));
CREATE POLICY project_roster_admin_insert ON public.project_roster FOR INSERT TO authenticated
  WITH CHECK (public.is_project_admin(project_id));
CREATE POLICY project_roster_admin_update ON public.project_roster FOR UPDATE TO authenticated
  USING (public.is_project_admin(project_id))
  WITH CHECK (public.is_project_admin(project_id));
CREATE POLICY project_roster_admin_delete ON public.project_roster FOR DELETE TO authenticated
  USING (public.is_project_admin(project_id));

-- auth_nonces: no policies. anon and authenticated cannot touch it.
-- service_role bypasses RLS.
