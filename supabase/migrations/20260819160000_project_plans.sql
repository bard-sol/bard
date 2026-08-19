ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS plan_tx text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS plan_paid_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_plan_chk;
  ALTER TABLE public.projects ADD CONSTRAINT projects_plan_chk CHECK (plan IN ('free', 'starter', 'pro'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
UPDATE public.projects SET plan = 'starter' WHERE (fee_paid = true OR vault_address IS NOT NULL) AND plan = 'free';
ALTER TABLE public.fee_payments DROP CONSTRAINT IF EXISTS fee_payments_kind_chk;
ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_kind_chk CHECK (kind IN ('onboard','campaign','claim','stake','starter','pro'));
