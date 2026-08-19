CREATE TABLE IF NOT EXISTS public.project_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  wallet text NOT NULL,
  role text NOT NULL DEFAULT 'trusted',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_roster_role_chk CHECK (role IN ('trusted','whale','blocked')),
  UNIQUE (project_id, wallet)
);
CREATE INDEX IF NOT EXISTS project_roster_project_idx ON public.project_roster (project_id);
ALTER TABLE public.project_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_roster_select ON public.project_roster;
DROP POLICY IF EXISTS project_roster_insert ON public.project_roster;
DROP POLICY IF EXISTS project_roster_update ON public.project_roster;
DROP POLICY IF EXISTS project_roster_delete ON public.project_roster;
CREATE POLICY project_roster_select ON public.project_roster FOR SELECT USING (true);
CREATE POLICY project_roster_insert ON public.project_roster FOR INSERT WITH CHECK (true);
CREATE POLICY project_roster_update ON public.project_roster FOR UPDATE USING (true);
CREATE POLICY project_roster_delete ON public.project_roster FOR DELETE USING (true);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS draw_seed text;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS draw_at timestamptz;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS draw_winners jsonb;
