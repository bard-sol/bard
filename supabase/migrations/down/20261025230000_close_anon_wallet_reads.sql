-- Reverse 20261025230000_close_anon_wallet_reads.sql
-- Restores the M2 grants and policies on campaign_joins, campaign_join_feed,
-- and vault_settlements (20261024130000_m2_identity_rls.sql).
-- Does not delete rows. Apply only after the matching up migration.

DROP TRIGGER IF EXISTS campaign_joins_stamp_x_handle ON public.campaign_joins;
DROP FUNCTION IF EXISTS public.stamp_join_x_handle();

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

GRANT SELECT (
  id, campaign_id, project_id, wallet, qualified, joined_at, qualified_at, status, progress, note
) ON public.campaign_joins TO anon, authenticated;
GRANT SELECT ON public.campaign_join_feed TO anon, authenticated;
GRANT SELECT ON public.vault_settlements TO anon, authenticated;

DROP POLICY IF EXISTS campaign_joins_member_read ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_public_read ON public.campaign_joins;
CREATE POLICY campaign_joins_public_read ON public.campaign_joins
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS vault_settlements_admin_read ON public.vault_settlements;
DROP POLICY IF EXISTS vault_settlements_public_read ON public.vault_settlements;
CREATE POLICY vault_settlements_public_read ON public.vault_settlements
  FOR SELECT TO anon, authenticated
  USING (true);
