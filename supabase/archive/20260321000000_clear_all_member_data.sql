-- Clear all member-related data
-- Order matters: delete dependent tables before members (FK constraints)
TRUNCATE TABLE claim_votes, votes, points_log, claims, proposals, burn_log, pool_balances, members RESTART IDENTITY CASCADE;
