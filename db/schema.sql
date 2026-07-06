-- Schéma initial pour la persistance des prospects et listes.
-- À exécuter depuis le SQL Editor de la Neon Console (Vercel Dashboard →
-- Storage → neon-pme-bucket → Open in Neon Console → SQL Editor).

CREATE TABLE IF NOT EXISTS prospects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  company        TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  arrondissement INT,
  department     TEXT,
  postal_code    TEXT,
  industry       TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  keywords       TEXT NOT NULL DEFAULT '',
  website        TEXT NOT NULL DEFAULT '',
  linkedin       TEXT NOT NULL DEFAULT '',
  apollo_id      TEXT UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending',
  mail           TEXT NOT NULL DEFAULT '',
  message_id     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);

CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_name_lower ON lists (lower(name));

CREATE TABLE IF NOT EXISTS list_prospects (
  list_id      TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (list_id, prospect_id)
);

CREATE INDEX IF NOT EXISTS idx_list_prospects_prospect ON list_prospects(prospect_id);

-- Compteur de crédits Apollo consommés, agrégé par jour (UTC).
-- 1 crédit = 1 prospect enrichi avec un email non vide.
-- Le mensuel est calculé via SUM sur le mois courant côté API.
CREATE TABLE IF NOT EXISTS apollo_usage (
  day        DATE PRIMARY KEY,
  credits    INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
