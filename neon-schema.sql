-- Neon schema for Baulko Bulletin
-- Run this once in the Neon SQL editor

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Authors
CREATE TABLE authors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  picture_url   TEXT,
  picture_alt   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Issues (posts)
CREATE TABLE posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  excerpt           TEXT,
  content           TEXT NOT NULL DEFAULT '',   -- HTML string
  cover_image_url   TEXT,
  cover_image_alt   TEXT,
  date              TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_id         UUID REFERENCES authors(id) ON DELETE SET NULL,
  pdf_url           TEXT,                       -- Filebase public URL
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extras (same shape as posts)
CREATE TABLE extras (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  excerpt           TEXT,
  content           TEXT NOT NULL DEFAULT '',
  cover_image_url   TEXT,
  cover_image_alt   TEXT,
  date              TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_id         UUID REFERENCES authors(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Puzzles
CREATE TABLE puzzles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  type              TEXT NOT NULL,              -- 'Crossword' | 'Find-A-Word' | 'Unscramble'
  data              TEXT NOT NULL DEFAULT '',   -- raw puzzle definition string
  date              TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_id         UUID REFERENCES authors(id) ON DELETE SET NULL,
  cover_image_url   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Singleton settings
CREATE TABLE settings (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- force single row
  title         TEXT NOT NULL DEFAULT 'Baulko Bulletin',
  description   TEXT NOT NULL DEFAULT '',
  footer_html   TEXT,
  og_image_url  TEXT
);

-- Static pages (about / faq / join)
CREATE TABLE pages (
  slug          TEXT PRIMARY KEY,               -- 'about' | 'faq' | 'join'
  title         TEXT NOT NULL,
  body_html     TEXT NOT NULL DEFAULT '',
  og_image_url  TEXT
);

-- Seed the settings row and empty pages
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO pages (slug, title) VALUES
  ('about', 'About'),
  ('faq', 'FAQ'),
  ('join', 'Join')
ON CONFLICT DO NOTHING;

-- Helpful indexes
CREATE INDEX idx_posts_date ON posts (date DESC);
CREATE INDEX idx_posts_slug ON posts (slug);
CREATE INDEX idx_extras_slug ON extras (slug);
CREATE INDEX idx_puzzles_date ON puzzles (date DESC);
