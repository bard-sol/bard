ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS vault_multisig text;
ALTER TABLE public.vault_settlements ADD COLUMN IF NOT EXISTS team_signed boolean NOT NULL DEFAULT false;
ALTER TABLE public.vault_settlements ADD COLUMN IF NOT EXISTS bard_signed boolean NOT NULL DEFAULT false;
ALTER TABLE public.vault_settlements ADD COLUMN IF NOT EXISTS team_signed_at timestamptz;
ALTER TABLE public.vault_settlements ADD COLUMN IF NOT EXISTS bard_signed_at timestamptz;
ALTER TABLE public.vault_settlements ADD COLUMN IF NOT EXISTS tx_index text;
ALTER TABLE public.vault_settlements ADD COLUMN IF NOT EXISTS vault_multisig text;
