-- Clear all member data, points, tweets, votes, claims, burns, pools
TRUNCATE TABLE claim_votes, votes, points_log, claims, proposals, burn_log, pool_balances, members RESTART IDENTITY CASCADE;
