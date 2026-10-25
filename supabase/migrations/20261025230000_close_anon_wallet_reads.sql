-- Close anonymous reads of full wallets and holder notes.
-- Back up public.campaign_joins and public.vault_settlements grants and policies
-- before applying. God applies this with that backup. This task does not apply
-- it to production, and it does not touch mainnet.
-- Down restores the M2 grants and policies:
-- supabase/migrations/down/20261025230000_close_anon_wallet_reads.sql
--
-- The admin home inbox (listOpenSettlements) reads with the signed-in team
-- wallet. That wallet is the project admin, so the admin policy below covers
-- it. The Bard signer key is not that wallet. /api/vault/bard-sign reads with
-- the worker service role after the existing signer check. Do not grant a
-- global read to reach it.

-- Holder-typed handles must not land on a join. The review queue reads
-- campaign_joins.x_handle, so only the verified holder handle is stored.
-- Service role keeps the value it writes (the auth worker).
CREATE OR REPLACE FUNCTION public.stamp_join_x_handle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  verified text;
  lookup text;
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    lookup := OLD.wallet;
  ELSE
    lookup := NEW.wallet;
  END IF;
  SELECT h.x_handle INTO verified
    FROM public.holders h
    WHERE h.wallet = lookup
      AND h.x_via = 'oauth';
  IF verified IS NULL OR btrim(verified) = '' THEN
    NEW.x_handle := NULL;
  ELSE
    NEW.x_handle := verified;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaign_joins_stamp_x_handle ON public.campaign_joins;
CREATE TRIGGER campaign_joins_stamp_x_handle
  BEFORE INSERT OR UPDATE ON public.campaign_joins
  FOR EACH ROW EXECUTE FUNCTION public.stamp_join_x_handle();

-- security_invoker stays false, so this view bypasses RLS on campaign_joins.
-- The WHERE is the row gate. Service role still sees every row.
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
FROM public.campaign_joins j
WHERE public.is_service_role()
   OR j.wallet = public.jwt_wallet()
   OR public.is_project_admin(j.project_id);

-- M2 granted campaign_joins SELECT by column. A table-level REVOKE does not
-- clear that. Revoke the column list from anon as well.
REVOKE ALL ON public.campaign_joins FROM anon;
REVOKE SELECT (
  id, campaign_id, project_id, wallet, qualified, joined_at, qualified_at, status, progress, note
) ON public.campaign_joins FROM anon;
REVOKE ALL ON public.campaign_join_feed FROM anon;
REVOKE ALL ON public.vault_settlements FROM anon;

GRANT SELECT ON public.campaign_join_feed TO authenticated;
GRANT ALL ON public.campaign_join_feed TO service_role;

DROP POLICY IF EXISTS campaign_joins_public_read ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_member_read ON public.campaign_joins;
CREATE POLICY campaign_joins_member_read ON public.campaign_joins
  FOR SELECT TO authenticated
  USING (wallet = public.jwt_wallet() OR public.is_project_admin(project_id));

DROP POLICY IF EXISTS vault_settlements_public_read ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_admin_read ON public.vault_settlements;
CREATE POLICY vault_settlements_admin_read ON public.vault_settlements
  FOR SELECT TO authenticated
  USING (public.is_project_admin(project_id));

-- vault_reservations has no wallet column. It stays publicly readable.
