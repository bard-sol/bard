-- Ensure points_log has all required columns
ALTER TABLE points_log
  ADD COLUMN IF NOT EXISTS x_handle   text,
  ADD COLUMN IF NOT EXISTS type       text,
  ADD COLUMN IF NOT EXISTS tweet_url  text,
  ADD COLUMN IF NOT EXISTS tweet_text text,
  ADD COLUMN IF NOT EXISTS tweet_id   text,
  ADD COLUMN IF NOT EXISTS reason     text;

-- Unique index for tweet deduplication
CREATE UNIQUE INDEX IF NOT EXISTS points_log_tweet_id_idx
  ON points_log(tweet_id) WHERE tweet_id IS NOT NULL;

-- Drop and recreate all RLS policies cleanly
ALTER TABLE points_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_anon_select_points_log" ON points_log;
DROP POLICY IF EXISTS "allow_anon_insert_points_log" ON points_log;
DROP POLICY IF EXISTS "points_log_select" ON points_log;
DROP POLICY IF EXISTS "points_log_insert" ON points_log;
DROP POLICY IF EXISTS "points_log_update" ON points_log;
CREATE POLICY "points_log_select" ON points_log FOR SELECT USING (true);
CREATE POLICY "points_log_insert" ON points_log FOR INSERT WITH CHECK (true);
CREATE POLICY "points_log_update" ON points_log FOR UPDATE USING (true);

-- Ensure members RLS allows anon read/write
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_anon_select_members" ON members;
DROP POLICY IF EXISTS "allow_anon_update_members" ON members;
DROP POLICY IF EXISTS "members_select" ON members;
DROP POLICY IF EXISTS "members_update" ON members;
CREATE POLICY "members_select" ON members FOR SELECT USING (true);
CREATE POLICY "members_update" ON members FOR UPDATE USING (true);
CREATE POLICY "members_insert" ON members FOR INSERT WITH CHECK (true);
