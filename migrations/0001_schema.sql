PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS students (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 birth_year INTEGER,
 current_year_group TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS words (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 lemma TEXT NOT NULL COLLATE NOCASE,
 part_of_speech TEXT,
 notes TEXT,
 UNIQUE(lemma)
);
CREATE TABLE IF NOT EXISTS word_levels (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
 year_group TEXT NOT NULL CHECK(year_group IN ('R','Y1','Y2','Y3','Y4','Y5','Y6')),
 percentile_band INTEGER NOT NULL CHECK(percentile_band IN (60,75,90,99)),
 gem_score INTEGER NOT NULL CHECK(gem_score BETWEEN 1 AND 100),
 difficulty REAL NOT NULL CHECK(difficulty BETWEEN 0 AND 1),
 source_basis TEXT NOT NULL DEFAULT 'curated-v1',
 active INTEGER NOT NULL DEFAULT 1,
 UNIQUE(word_id, year_group)
);
CREATE INDEX IF NOT EXISTS idx_word_levels_year_gem ON word_levels(year_group, gem_score);
CREATE INDEX IF NOT EXISTS idx_word_levels_year_pct ON word_levels(year_group, percentile_band);
CREATE TABLE IF NOT EXISTS student_word_state (
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
 word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
 exposures INTEGER NOT NULL DEFAULT 0,
 correct_first_try INTEGER NOT NULL DEFAULT 0,
 incorrect INTEGER NOT NULL DEFAULT 0,
 hints_used INTEGER NOT NULL DEFAULT 0,
 mastery REAL NOT NULL DEFAULT 0,
 ease REAL NOT NULL DEFAULT 2.5,
 interval_days INTEGER NOT NULL DEFAULT 0,
 due_at TEXT,
 last_seen_at TEXT,
 PRIMARY KEY(student_id, word_id)
);
CREATE TABLE IF NOT EXISTS attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
 word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
 year_group TEXT NOT NULL,
 question_type TEXT NOT NULL,
 correct INTEGER NOT NULL CHECK(correct IN (0,1)),
 hints_used INTEGER NOT NULL DEFAULT 0,
 response_ms INTEGER,
 gem_score_at_attempt INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attempts_student_created ON attempts(student_id, created_at);
