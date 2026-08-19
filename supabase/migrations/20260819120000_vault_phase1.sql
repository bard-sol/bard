-- Vault Phase 1: Squads 2-of-2 lock on each project
-- Team deposits project tokens; neither team nor Bard can withdraw alone.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS vault_address text,
  ADD COLUMN IF NOT EXISTS vault_mint text,
  ADD COLUMN IF NOT EXISTS vault_reserved numeric(36, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vault_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS vault_linked_at timestamptz;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS vault_reserved numeric(36, 8) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_vault_status_chk;
  ALTER TABLE public.projects
    ADD CONSTRAINT projects_vault_status_chk
    CHECK (vault_status IN ('none', 'linked', 'verified'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.vault_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  campaign_id   uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  amount        numeric(36, 8) NOT NULL,
  status        text NOT NULL DEFAULT 'reserved',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_reservations_status_chk CHECK (status IN ('reserved', 'released', 'settled'))
);

CREATE INDEX IF NOT EXISTS vault_reservations_project_idx ON public.vault_reservations (project_id);

ALTER TABLE public.vault_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vault_reservations_select ON public.vault_reservations;
DROP POLICY IF EXISTS vault_reservations_insert ON public.vault_reservations;
DROP POLICY IF EXISTS vault_reservations_update ON public.vault_reservations;
CREATE POLICY vault_reservations_select ON public.vault_reservations FOR SELECT USING (true);
CREATE POLICY vault_reservations_insert ON public.vault_reservations FOR INSERT WITH CHECK (true);
CREATE POLICY vault_reservations_update ON public.vault_reservations FOR UPDATE USING (true);
