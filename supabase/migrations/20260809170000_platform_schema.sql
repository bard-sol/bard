-- ============================================================
-- BARD PLATFORM SCHEMA
-- Multi-tenant projects, campaigns, joins, claims, fee ledger
-- Run this in Supabase SQL Editor (or via CLI) once.
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- projects (one row per token onboarded on Bard)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  ticker        text NOT NULL,
  mint          text NOT NULL,
  chain         text NOT NULL DEFAULT 'solana',
  admin_wallet  text,
  created_by    text,
  fee_paid      boolean NOT NULL DEFAULT false,
  fee_tx        text,
  fee_amount_sol numeric(12,4) NOT NULL DEFAULT 0.25,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_mint_uidx ON public.projects (mint);
CREATE INDEX IF NOT EXISTS projects_admin_idx ON public.projects (admin_wallet);
CREATE INDEX IF NOT EXISTS projects_created_at_idx ON public.projects (created_at DESC);

-- ------------------------------------------------------------
-- campaigns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title         text NOT NULL,
  type          text NOT NULL DEFAULT 'hold',
    -- hold | raid | refer | custom | post | reply | social
  rule_text     text NOT NULL DEFAULT '',
  reward        text,
  reward_unit   text NOT NULL DEFAULT 'SOL',
  pool_size     text,
  duration_days int NOT NULL DEFAULT 7,
  status        text NOT NULL DEFAULT 'active',
    -- active | ended | draft
  settled_count int NOT NULL DEFAULT 0,
  fee_paid      boolean NOT NULL DEFAULT false,
  fee_tx        text,
  fee_amount_sol numeric(12,4) NOT NULL DEFAULT 0.25,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_type_chk CHECK (type IN ('hold','raid','refer','custom','post','reply','social')),
  CONSTRAINT campaigns_status_chk CHECK (status IN ('active','ended','draft'))
);

CREATE INDEX IF NOT EXISTS campaigns_project_idx ON public.campaigns (project_id);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON public.campaigns (status);
CREATE INDEX IF NOT EXISTS campaigns_created_at_idx ON public.campaigns (created_at DESC);

-- ------------------------------------------------------------
-- holders (wallet profile on the platform)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.holders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet        text NOT NULL,
  x_handle      text,
  x_linked_at   timestamptz,
  x_via         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS holders_wallet_uidx ON public.holders (wallet);
CREATE INDEX IF NOT EXISTS holders_x_idx ON public.holders (x_handle);

-- ------------------------------------------------------------
-- campaign_joins (wallet joined a campaign)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_joins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  wallet        text NOT NULL,
  x_handle      text,
  qualified     boolean NOT NULL DEFAULT false,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  qualified_at  timestamptz,
  UNIQUE (campaign_id, wallet)
);

CREATE INDEX IF NOT EXISTS campaign_joins_wallet_idx ON public.campaign_joins (wallet);
CREATE INDEX IF NOT EXISTS campaign_joins_campaign_idx ON public.campaign_joins (campaign_id);

-- ------------------------------------------------------------
-- platform_claims (settled rewards — distinct from legacy "claims")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_claims (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  wallet        text NOT NULL,
  x_handle      text,
  amount        text,
  unit          text,
  settled       boolean NOT NULL DEFAULT false,
  settled_at    timestamptz,
  fee_paid      boolean NOT NULL DEFAULT false,
  fee_tx        text,
  fee_amount_sol numeric(12,4) NOT NULL DEFAULT 0.10,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, wallet)
);

CREATE INDEX IF NOT EXISTS platform_claims_wallet_idx ON public.platform_claims (wallet);
CREATE INDEX IF NOT EXISTS platform_claims_campaign_idx ON public.platform_claims (campaign_id);

-- ------------------------------------------------------------
-- fee_payments (ledger of SOL fees collected by the platform)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
    -- onboard | campaign | claim | stake
  amount_sol    numeric(12,4) NOT NULL,
  payer_wallet  text NOT NULL,
  tx_signature  text,
  status        text NOT NULL DEFAULT 'pending',
    -- pending | confirmed | failed
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  campaign_id   uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  claim_id      uuid REFERENCES public.platform_claims(id) ON DELETE SET NULL,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at  timestamptz,
  CONSTRAINT fee_payments_kind_chk CHECK (kind IN ('onboard','campaign','claim','stake')),
  CONSTRAINT fee_payments_status_chk CHECK (status IN ('pending','confirmed','failed'))
);

CREATE INDEX IF NOT EXISTS fee_payments_payer_idx ON public.fee_payments (payer_wallet);
CREATE INDEX IF NOT EXISTS fee_payments_status_idx ON public.fee_payments (status);
CREATE INDEX IF NOT EXISTS fee_payments_tx_idx ON public.fee_payments (tx_signature);

-- ------------------------------------------------------------
-- updated_at helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_updated_at ON public.projects;
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS campaigns_set_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_set_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS holders_set_updated_at ON public.holders;
CREATE TRIGGER holders_set_updated_at
  BEFORE UPDATE ON public.holders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- RLS — open read for public explore; write allowed for anon
-- (tighten later with wallet-signed JWT / Edge Functions)
-- ------------------------------------------------------------
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_joins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

-- projects
DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT USING (true);
CREATE POLICY projects_insert ON public.projects FOR INSERT WITH CHECK (true);
CREATE POLICY projects_update ON public.projects FOR UPDATE USING (true);

-- campaigns
DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
DROP POLICY IF EXISTS campaigns_insert ON public.campaigns;
DROP POLICY IF EXISTS campaigns_update ON public.campaigns;
CREATE POLICY campaigns_select ON public.campaigns FOR SELECT USING (true);
CREATE POLICY campaigns_insert ON public.campaigns FOR INSERT WITH CHECK (true);
CREATE POLICY campaigns_update ON public.campaigns FOR UPDATE USING (true);

-- holders
DROP POLICY IF EXISTS holders_select ON public.holders;
DROP POLICY IF EXISTS holders_insert ON public.holders;
DROP POLICY IF EXISTS holders_update ON public.holders;
CREATE POLICY holders_select ON public.holders FOR SELECT USING (true);
CREATE POLICY holders_insert ON public.holders FOR INSERT WITH CHECK (true);
CREATE POLICY holders_update ON public.holders FOR UPDATE USING (true);

-- campaign_joins
DROP POLICY IF EXISTS campaign_joins_select ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_insert ON public.campaign_joins;
DROP POLICY IF EXISTS campaign_joins_update ON public.campaign_joins;
CREATE POLICY campaign_joins_select ON public.campaign_joins FOR SELECT USING (true);
CREATE POLICY campaign_joins_insert ON public.campaign_joins FOR INSERT WITH CHECK (true);
CREATE POLICY campaign_joins_update ON public.campaign_joins FOR UPDATE USING (true);

-- platform_claims
DROP POLICY IF EXISTS platform_claims_select ON public.platform_claims;
DROP POLICY IF EXISTS platform_claims_insert ON public.platform_claims;
DROP POLICY IF EXISTS platform_claims_update ON public.platform_claims;
CREATE POLICY platform_claims_select ON public.platform_claims FOR SELECT USING (true);
CREATE POLICY platform_claims_insert ON public.platform_claims FOR INSERT WITH CHECK (true);
CREATE POLICY platform_claims_update ON public.platform_claims FOR UPDATE USING (true);

-- fee_payments (read ok; insert ok; no public update of confirmed rows preferred later)
DROP POLICY IF EXISTS fee_payments_select ON public.fee_payments;
DROP POLICY IF EXISTS fee_payments_insert ON public.fee_payments;
DROP POLICY IF EXISTS fee_payments_update ON public.fee_payments;
CREATE POLICY fee_payments_select ON public.fee_payments FOR SELECT USING (true);
CREATE POLICY fee_payments_insert ON public.fee_payments FOR INSERT WITH CHECK (true);
CREATE POLICY fee_payments_update ON public.fee_payments FOR UPDATE USING (true);

-- ------------------------------------------------------------
-- Fee price reference (documentation in-table optional)
-- onboard  0.25 SOL
-- campaign 0.25 SOL
-- claim    0.10 SOL
-- stake    0.05 SOL (future)
-- ------------------------------------------------------------
