-- WordQuest v3.1 lexical cache + progress support
-- Safe to paste directly into the Cloudflare D1 console.
-- No BEGIN/COMMIT statements are used.

CREATE TABLE IF NOT EXISTS lexical_cache (
  word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
  definition TEXT,
  part_of_speech TEXT,
  synonyms_json TEXT NOT NULL DEFAULT '[]',
  antonyms_json TEXT NOT NULL DEFAULT '[]',
  examples_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'dictionaryapi.dev',
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fetch_status TEXT NOT NULL DEFAULT 'ok'
);

CREATE INDEX IF NOT EXISTS idx_lexical_cache_status
ON lexical_cache(fetch_status);

CREATE INDEX IF NOT EXISTS idx_student_word_due
ON student_word_state(student_id, due_at);

CREATE INDEX IF NOT EXISTS idx_attempts_student_word
ON attempts(student_id, word_id);
