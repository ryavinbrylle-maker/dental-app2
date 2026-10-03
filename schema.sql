-- Run this once in the Neon SQL Editor to create the students table.
CREATE TABLE IF NOT EXISTS students (
  id                 SERIAL PRIMARY KEY,
  lrn                VARCHAR(12),
  name               TEXT NOT NULL,
  birthdate          DATE,
  age                INTEGER,
  sex                TEXT,
  blood_type         TEXT,
  grade              TEXT,
  section            TEXT,
  height_cm          NUMERIC,
  weight_kg          NUMERIC,
  address            TEXT,

  parent_name        TEXT,
  relationship       TEXT,
  contact            TEXT,
  emergency_contact  TEXT,

  conditions         TEXT[],
  other_conditions   TEXT,
  allergies          TEXT,
  medications        TEXT,

  last_visit         DATE,
  brushing           TEXT,
  dental_concerns    TEXT[],
  dental_notes       TEXT,

  consent            BOOLEAN NOT NULL DEFAULT FALSE,
  registered_on      TIMESTAMPTZ DEFAULT NOW()
);

-- If you already created the table before, run these two lines instead
-- so the LRN can be left blank:
-- ALTER TABLE students ALTER COLUMN lrn DROP NOT NULL;
-- ALTER TABLE students ALTER COLUMN consent SET DEFAULT FALSE;
