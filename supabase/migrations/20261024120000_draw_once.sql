-- One-shot airdrop draw. God applies this migration.
-- A campaign may commit draw_slot once, then set draw_seed and draw_winners
-- once. Later changes to those fields are refused.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS draw_slot bigint,
  ADD COLUMN IF NOT EXISTS draw_seed_slot bigint,
  ADD COLUMN IF NOT EXISTS draw_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draw_committed_at timestamptz;

CREATE OR REPLACE FUNCTION public.campaigns_draw_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.draw_slot IS NOT NULL AND NEW.draw_slot IS DISTINCT FROM OLD.draw_slot THEN
    RAISE EXCEPTION 'Draw slot already committed';
  END IF;
  IF OLD.draw_slot IS NOT NULL AND NEW.draw_count IS DISTINCT FROM OLD.draw_count THEN
    RAISE EXCEPTION 'Draw slot already committed';
  END IF;
  IF OLD.draw_seed IS NOT NULL AND NEW.draw_seed IS DISTINCT FROM OLD.draw_seed THEN
    RAISE EXCEPTION 'Draw already finalized';
  END IF;
  IF OLD.draw_winners IS NOT NULL AND NEW.draw_winners IS DISTINCT FROM OLD.draw_winners THEN
    RAISE EXCEPTION 'Draw already finalized';
  END IF;
  IF OLD.draw_seed_slot IS NOT NULL AND NEW.draw_seed_slot IS DISTINCT FROM OLD.draw_seed_slot THEN
    RAISE EXCEPTION 'Draw already finalized';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_draw_once ON public.campaigns;
CREATE TRIGGER campaigns_draw_once
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.campaigns_draw_once();
