-- Migration: simplify authors, link puzzles to issues
-- Run this in the Neon SQL Editor AFTER the original schema has been applied
-- and AFTER you have imported data (or re-import afterwards).

-- 1. Add plain-text author names and issue link on puzzles
ALTER TABLE posts DROP COLUMN IF EXISTS author_id;

ALTER TABLE extras
  ADD COLUMN IF NOT EXISTS author_name TEXT;

ALTER TABLE puzzles
  ADD COLUMN IF NOT EXISTS author_name TEXT,
  ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES posts(id) ON DELETE SET NULL;

-- Backfill author_name from the old authors table if it still exists
UPDATE extras e
SET author_name = a.name
FROM authors a
WHERE e.author_id = a.id AND e.author_name IS NULL;

UPDATE puzzles p
SET author_name = a.name
FROM authors a
WHERE p.author_id = a.id AND p.author_name IS NULL;

-- Drop the FK columns and the authors table (no profile images needed)
ALTER TABLE extras DROP COLUMN IF EXISTS author_id;
ALTER TABLE puzzles DROP COLUMN IF EXISTS author_id;
DROP TABLE IF EXISTS authors;

-- Index for "puzzles belonging to an issue"
CREATE INDEX IF NOT EXISTS idx_puzzles_post_id ON puzzles (post_id);
