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

-- ===== Dental visits (check-ups recorded by the dentist) =====
-- Run this once in the Neon SQL Editor to add visit records.
CREATE TABLE IF NOT EXISTS visits (
  id               SERIAL PRIMARY KEY,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  visit_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  symptoms         TEXT[] DEFAULT '{}',
  chief_complaint  TEXT,
  teeth            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"54": {"status": "Decayed", "note": ""}}
  exam_notes       TEXT,
  decayed          INTEGER DEFAULT 0,
  missing          INTEGER DEFAULT 0,
  filled           INTEGER DEFAULT 0,
  created_by       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS visits_student_idx ON visits(student_id);

-- ===== Student codes (M-1, F-2, ...) replace the LRN =====
-- Run this once in the Neon SQL Editor. It is safe to run again.
-- 1) New columns: gender letter (M/F) and number
ALTER TABLE students ADD COLUMN IF NOT EXISTS code_gender CHAR(1);
ALTER TABLE students ADD COLUMN IF NOT EXISTS code_number INTEGER;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_code_check;
ALTER TABLE students ADD CONSTRAINT students_code_check
  CHECK ((code_gender IS NULL OR code_gender IN ('M', 'F'))
     AND (code_number IS NULL OR code_number > 0));

-- 2) Move existing students over: gender letter comes from their Sex answer
UPDATE students
SET code_gender = CASE sex WHEN 'Male' THEN 'M' WHEN 'Female' THEN 'F' END
WHERE code_gender IS NULL AND sex IN ('Male', 'Female');

-- 3) Give existing students the next free numbers in their Grade + Section,
--    in the order they registered (students with no grade/section/sex are left
--    for the dentist to fix on the Students page)
WITH todo AS (
  SELECT id, grade, section, code_gender,
         ROW_NUMBER() OVER (PARTITION BY grade, section, code_gender
                            ORDER BY registered_on, id) AS rn
  FROM students
  WHERE code_number IS NULL AND code_gender IS NOT NULL
    AND grade IS NOT NULL AND section IS NOT NULL
), base AS (
  SELECT grade, section, code_gender, MAX(code_number) AS mx
  FROM students WHERE code_number IS NOT NULL
  GROUP BY grade, section, code_gender
)
UPDATE students s
SET code_number = t.rn + COALESCE(b.mx, 0)
FROM todo t
LEFT JOIN base b
  ON b.grade = t.grade AND b.section = t.section AND b.code_gender = t.code_gender
WHERE s.id = t.id;

-- 4) No two students may share a code inside the same Grade + Section
CREATE UNIQUE INDEX IF NOT EXISTS students_code_unique
  ON students (grade, section, code_gender, code_number)
  WHERE code_number IS NOT NULL;

-- ===== Dental appointments (queue, attendance, absences) =====
-- Run this once in the Neon SQL Editor. It is safe to run again.
CREATE TABLE IF NOT EXISTS appointments (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  appointment_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  grade             TEXT NOT NULL,        -- class at the time of the appointment
  section           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'Waiting'
                    CHECK (status IN ('Waiting', 'Completed', 'Absent')),
  result            TEXT,                 -- e.g. "No major concerns"
  notes             TEXT,                 -- dentist notes
  visit_id          INTEGER REFERENCES visits(id) ON DELETE SET NULL,  -- tooth-map exam, if recorded
  extra             BOOLEAN NOT NULL DEFAULT FALSE,  -- an intentional 2nd appointment on the same day
  created_by        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  finished_at       TIMESTAMPTZ           -- when marked Completed or Absent
);
-- One normal appointment per student per day (extra ones are allowed on purpose)
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_per_day
  ON appointments (student_id, appointment_date) WHERE NOT extra;
CREATE INDEX IF NOT EXISTS appointments_class_day
  ON appointments (grade, section, appointment_date);
CREATE INDEX IF NOT EXISTS appointments_student
  ON appointments (student_id, appointment_date DESC);

-- ===== Tooth map: several conditions per tooth =====
-- Converts old tooth records {"status": "Decayed", "note": ""}
-- into the new format {"conditions": ["Decayed"], "note": ""}.
-- Safe to run again (teeth already in the new format are left as they are).
UPDATE visits v
SET teeth = sub.new_teeth
FROM (
  SELECT id,
         jsonb_object_agg(
           e.key,
           CASE WHEN e.value ? 'conditions' THEN e.value
                ELSE jsonb_build_object(
                       'conditions', jsonb_build_array(COALESCE(e.value->>'status', 'Sound')),
                       'note', COALESCE(e.value->>'note', ''))
           END
         ) AS new_teeth
  FROM visits, jsonb_each(teeth) AS e(key, value)
  GROUP BY id
) sub
WHERE v.id = sub.id
  AND EXISTS (SELECT 1 FROM jsonb_each(v.teeth) x WHERE NOT (x.value ? 'conditions'));

-- ===== Absent students & late arrivals =====
-- Run this once in the Neon SQL Editor. It is safe to run again.
-- 1) New status "Late Arrival" = was marked absent, then arrived; waiting for treatment
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('Waiting', 'Late Arrival', 'Completed', 'Absent'));

-- 2) Keep the absence permanently, even after the student arrives
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS was_absent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS absent_at  TIMESTAMPTZ;  -- when marked absent
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;  -- when marked as arrived (late)

-- Existing data: absences recorded before this change
UPDATE appointments SET was_absent = TRUE, absent_at = COALESCE(absent_at, finished_at)
WHERE status = 'Absent' AND NOT was_absent;
UPDATE appointments SET was_absent = TRUE
WHERE NOT was_absent AND notes LIKE '%Was marked absent earlier%';

-- 3) History of every status change (who, when, from -> to)
CREATE TABLE IF NOT EXISTS appointment_events (
  id              SERIAL PRIMARY KEY,
  appointment_id  INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  changed_by      TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS appointment_events_appt ON appointment_events (appointment_id, changed_at);
CREATE INDEX IF NOT EXISTS appointments_absent_day ON appointments (appointment_date) WHERE status = 'Absent';

-- =====================================================================
-- ===== Offline sync, school years, student identities (Oct 2026) =====
-- =====================================================================
-- Run this once in the Neon SQL Editor (after everything above).
-- It is safe to run again: nothing is deleted, nothing is duplicated.

-- ---------- helper functions ----------
-- School year of a date: June–May  (2026-10-16 -> '2026-2027', 2027-03-01 -> '2026-2027')
CREATE OR REPLACE FUNCTION school_year_of(d DATE) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN EXTRACT(MONTH FROM d) >= 6
              THEN EXTRACT(YEAR FROM d)::int || '-' || (EXTRACT(YEAR FROM d)::int + 1)
              ELSE (EXTRACT(YEAR FROM d)::int - 1) || '-' || EXTRACT(YEAR FROM d)::int END
$$;
-- Name normalisation for returning-student matching (same rules as api/_identity.js)
CREATE OR REPLACE FUNCTION name_norm(t TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
           translate(lower(coalesce(t, '')), 'áàâäãåéèêëíìîïóòôöõúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc'),
           '[^a-z0-9]+', ' ', 'g'))
$$;
-- words sorted:  "Dela Cruz, Juan" -> "cruz dela juan"
CREATE OR REPLACE FUNCTION name_key(t TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT coalesce((SELECT string_agg(w, ' ' ORDER BY w)
                   FROM regexp_split_to_table(name_norm(t), ' ') AS w WHERE w <> ''), '')
$$;
-- letters only, in typed order: "Juan De la Cruz" -> "juandelacruz"
CREATE OR REPLACE FUNCTION name_compact(t TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT replace(name_norm(t), ' ', '')
$$;

-- ---------- school years ----------
CREATE TABLE IF NOT EXISTS school_years (
  id           TEXT PRIMARY KEY,                    -- e.g. '2026-2027'
  status       TEXT NOT NULL DEFAULT 'archived'
               CHECK (status IN ('active', 'archived')),
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  archived_at  TIMESTAMPTZ
);
-- only ONE active school year at a time
CREATE UNIQUE INDEX IF NOT EXISTS school_years_one_active ON school_years ((status)) WHERE status = 'active';
INSERT INTO school_years (id, status)
SELECT school_year_of(CURRENT_DATE), 'active'
WHERE NOT EXISTS (SELECT 1 FROM school_years WHERE status = 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active';
-- every year that already has data gets a row (archived unless it is the active one)
INSERT INTO school_years (id, status)
SELECT DISTINCT school_year_of(COALESCE(registered_on, NOW())::date), 'archived' FROM students
ON CONFLICT (id) DO NOTHING;
INSERT INTO school_years (id, status)
SELECT DISTINCT school_year_of(appointment_date), 'archived' FROM appointments
ON CONFLICT (id) DO NOTHING;
INSERT INTO school_years (id, status)
SELECT DISTINCT school_year_of(visit_date), 'archived' FROM visits
ON CONFLICT (id) DO NOTHING;

-- ---------- long-term student identity (across school years) ----------
CREATE TABLE IF NOT EXISTS student_identities (
  id                     SERIAL PRIMARY KEY,
  full_name              TEXT NOT NULL,
  name_key               TEXT NOT NULL,
  name_compact           TEXT NOT NULL,
  birthdate              DATE,
  first_registration_id  INTEGER UNIQUE,         -- the registration that created it
  created_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS student_identities_key ON student_identities (name_key);
CREATE INDEX IF NOT EXISTS student_identities_compact ON student_identities (name_compact);

-- ---------- "students" = one registration per student per school year ----------
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_year  TEXT REFERENCES school_years(id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS identity_id  INTEGER REFERENCES student_identities(id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS match_status TEXT;          -- new | auto | confirmed | pending
ALTER TABLE students ADD COLUMN IF NOT EXISTS removed_at   TIMESTAMPTZ;   -- hidden from roster, history kept
UPDATE students SET school_year = school_year_of(COALESCE(registered_on, NOW())::date)
WHERE school_year IS NULL;
-- one identity for every existing registration that has none yet
INSERT INTO student_identities (full_name, name_key, name_compact, birthdate, first_registration_id)
SELECT s.name, name_key(s.name), name_compact(s.name), s.birthdate, s.id
FROM students s
WHERE s.identity_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM student_identities i WHERE i.first_registration_id = s.id);
UPDATE students s SET identity_id = i.id, match_status = COALESCE(s.match_status, 'new')
FROM student_identities i
WHERE i.first_registration_id = s.id AND s.identity_id IS NULL;
CREATE INDEX IF NOT EXISTS students_identity ON students (identity_id);
CREATE INDEX IF NOT EXISTS students_year_class ON students (school_year, grade, section);
-- student codes are unique per school year + grade + section (removed students free their code)
DROP INDEX IF EXISTS students_code_unique;
CREATE UNIQUE INDEX IF NOT EXISTS students_code_unique_year
  ON students (school_year, grade, section, code_gender, code_number)
  WHERE code_number IS NOT NULL AND removed_at IS NULL;

-- ---------- possible returning students waiting for the dentist to confirm ----------
CREATE TABLE IF NOT EXISTS identity_matches (
  id                     SERIAL PRIMARY KEY,
  student_id             INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,  -- new registration
  candidate_identity_id  INTEGER NOT NULL REFERENCES student_identities(id),
  reason                 TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'linked', 'rejected')),
  decided_by             TEXT,
  decided_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, candidate_identity_id)
);

-- ---------- appointments & visits: school year + offline-sync fields ----------
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS school_year TEXT REFERENCES school_years(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_uid  TEXT UNIQUE;   -- id made on the device
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS last_op_id  TEXT;          -- last synced change
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();
UPDATE appointments SET school_year = school_year_of(appointment_date) WHERE school_year IS NULL;

-- visits = dental examinations; each one keeps the class it was recorded in
ALTER TABLE visits ADD COLUMN IF NOT EXISTS school_year TEXT REFERENCES school_years(id);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS grade       TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS section     TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS client_uid  TEXT UNIQUE;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS last_op_id  TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();
UPDATE visits v SET school_year = school_year_of(v.visit_date) WHERE v.school_year IS NULL;
UPDATE visits v SET grade = s.grade, section = s.section
FROM students s WHERE s.id = v.student_id AND v.grade IS NULL;

-- ---------- uploads that were already processed (stops duplicates on retry) ----------
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id         TEXT PRIMARY KEY,
  op_type       TEXT,
  result        JSONB,
  processed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- SchoolYearDentalRecords: frozen copy of each school year ----------
CREATE TABLE IF NOT EXISTS school_year_archive (
  school_year   TEXT NOT NULL REFERENCES school_years(id),
  student_id    INTEGER NOT NULL REFERENCES students(id),   -- the registration of that year
  identity_id   INTEGER REFERENCES student_identities(id),
  grade         TEXT,
  section       TEXT,
  student_code  TEXT,
  name          TEXT,
  snapshot      JSONB NOT NULL,   -- registration + appointments + exams + notes of that year
  archived_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (school_year, student_id)
);

-- Existing data: same name in an EARLIER school year -> only a SUGGESTION for the dentist
-- to confirm on the Students page (never merged automatically here).
INSERT INTO identity_matches (student_id, candidate_identity_id, reason)
SELECT DISTINCT s_new.id, s_old.identity_id,
       'Same name as ' || s_old.name || ' (' || s_old.grade || ' – ' || s_old.section || ', ' || s_old.school_year || ')'
FROM students s_new
JOIN students s_old
  ON s_old.school_year < s_new.school_year
 AND s_old.identity_id <> s_new.identity_id
 AND s_old.removed_at IS NULL
 AND (name_key(s_old.name) = name_key(s_new.name) OR name_compact(s_old.name) = name_compact(s_new.name))
WHERE s_new.match_status = 'new' AND s_new.removed_at IS NULL
ON CONFLICT (student_id, candidate_identity_id) DO NOTHING;
UPDATE students s SET match_status = 'pending'
WHERE s.match_status = 'new'
  AND EXISTS (SELECT 1 FROM identity_matches m WHERE m.student_id = s.id AND m.status = 'pending');

-- ===== Tooth condition renamed: "Crowded" -> "Crowned" (Oct 2026) =====
-- Safe to run again. Only the condition lists are changed (tooth notes are not touched).
-- The app already shows old "Crowded" marks as "Crowned", so this only tidies the stored data.
UPDATE visits v
SET teeth = (
  SELECT jsonb_object_agg(e.k,
    CASE
      WHEN jsonb_typeof(e.val -> 'conditions') = 'array' THEN
        jsonb_set(e.val, '{conditions}', COALESCE((
          SELECT jsonb_agg(CASE WHEN c = '"Crowded"'::jsonb THEN '"Crowned"'::jsonb ELSE c END)
          FROM jsonb_array_elements(e.val -> 'conditions') AS c), '[]'::jsonb))
      WHEN e.val ->> 'status' = 'Crowded' THEN jsonb_set(e.val, '{status}', '"Crowned"'::jsonb)
      ELSE e.val
    END)
  FROM jsonb_each(v.teeth) AS e(k, val))
WHERE v.teeth::text LIKE '%"Crowded"%';
