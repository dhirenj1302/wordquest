PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS student_learning_profile_v1 (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  target_year_group TEXT NOT NULL CHECK(target_year_group IN ('R','Y1','Y2','Y3','Y4','Y5','Y6')),
  target_gem REAL NOT NULL DEFAULT 55 CHECK(target_gem BETWEEN 1 AND 100),
  ability_confidence REAL NOT NULL DEFAULT 0.20 CHECK(ability_confidence BETWEEN 0 AND 1),
  questions_answered INTEGER NOT NULL DEFAULT 0,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  last_practice_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_word_mastery_v1 (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  year_group TEXT NOT NULL CHECK(year_group IN ('R','Y1','Y2','Y3','Y4','Y5','Y6')),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','learning','fragile','secure','mastered')),
  composite_mastery REAL NOT NULL DEFAULT 0 CHECK(composite_mastery BETWEEN 0 AND 1),
  recognition_score REAL NOT NULL DEFAULT 0 CHECK(recognition_score BETWEEN 0 AND 1),
  context_score REAL NOT NULL DEFAULT 0 CHECK(context_score BETWEEN 0 AND 1),
  production_score REAL NOT NULL DEFAULT 0 CHECK(production_score BETWEEN 0 AND 1),
  morphology_score REAL NOT NULL DEFAULT 0 CHECK(morphology_score BETWEEN 0 AND 1),
  transfer_score REAL NOT NULL DEFAULT 0 CHECK(transfer_score BETWEEN 0 AND 1),
  exposures INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  incorrect_count INTEGER NOT NULL DEFAULT 0,
  hinted_correct_count INTEGER NOT NULL DEFAULT 0,
  distinct_question_types INTEGER NOT NULL DEFAULT 0,
  delayed_successes INTEGER NOT NULL DEFAULT 0,
  consecutive_correct INTEGER NOT NULL DEFAULT 0,
  consecutive_wrong INTEGER NOT NULL DEFAULT 0,
  last_question_type TEXT,
  last_correct_at TEXT,
  last_incorrect_at TEXT,
  last_seen_at TEXT,
  due_at TEXT,
  retention_interval_days REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(student_id,word_id)
);

CREATE INDEX IF NOT EXISTS idx_mastery_v1_student_due
ON student_word_mastery_v1(student_id,due_at);
CREATE INDEX IF NOT EXISTS idx_mastery_v1_student_status
ON student_word_mastery_v1(student_id,status);

CREATE TABLE IF NOT EXISTS learning_evidence_v1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  year_group TEXT NOT NULL,
  question_type TEXT NOT NULL,
  dimension TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK(correct IN (0,1)),
  hints_used INTEGER NOT NULL DEFAULT 0,
  response_ms INTEGER,
  gem_score INTEGER NOT NULL,
  evidence_weight REAL NOT NULL,
  production_score REAL,
  was_delayed_retrieval INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_learning_evidence_student_word
ON learning_evidence_v1(student_id,word_id,created_at);

CREATE TABLE IF NOT EXISTS lexical_usage_v1 (
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  year_group TEXT NOT NULL,
  context_examples_json TEXT NOT NULL DEFAULT '[]',
  collocations_json TEXT NOT NULL DEFAULT '[]',
  usage_frames_json TEXT NOT NULL DEFAULT '[]',
  morphology_json TEXT NOT NULL DEFAULT '{}',
  register_note TEXT,
  nuance_note TEXT,
  usage_status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'wordquest',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(word_id,year_group)
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  code_salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS teacher_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  year_group TEXT CHECK(year_group IN ('R','Y1','Y2','Y3','Y4','Y5','Y6')),
  join_code TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id,archived);

CREATE TABLE IF NOT EXISTS class_students (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(class_id,student_id)
);
CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students(student_id,active);
