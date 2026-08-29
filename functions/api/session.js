const DICT_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

export async function onRequestGet({ request, env }) {
  try {
    const u = new URL(request.url);
    const year = validYear(u.searchParams.get('year')) || 'Y3';
    const studentId = Number(u.searchParams.get('student_id') || 0);
    const targetGem = clamp(Number(u.searchParams.get('targetGem') || 55), 5, 95);
    const count = clamp(Number(u.searchParams.get('count') || 12), 5, 20);
    const radius = clamp(Number(u.searchParams.get('radius') || 22), 10, 45);

    let candidates = await getCandidates(env, year, studentId, targetGem, radius, Math.min(50, count * 4));
    if (candidates.length < count * 2) {
      candidates = await getCandidates(env, year, studentId, targetGem, 45, Math.min(80, count * 6));
    }

    const selected = spreadPick(candidates, count);
    const enriched = await Promise.all(selected.map(w => ensureLexicon(env, w)));
    const usable = enriched.filter(x => x.definition && !isBadDefinition(x.definition));

    return Response.json({
      year,
      targetGem,
      results: usable.length >= Math.min(5, count) ? usable : enriched,
      lexical_source: 'D1 cache with dictionary fallback',
      version: '3.2'
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: 'session_failed', detail: String(err?.message || err) }, { status: 500 });
  }
}

async function getCandidates(env, year, studentId, target, radius, limit) {
  const min = Math.max(1, target - radius), max = Math.min(100, target + radius);
  const { results } = await env.DB.prepare(`
    SELECT w.id,w.lemma,COALESCE(w.part_of_speech,'') AS stored_pos,
           wl.year_group,wl.percentile_band,wl.gem_score,wl.difficulty,
           COALESCE(sws.exposures,0) AS exposures,
           COALESCE(sws.mastery,0) AS mastery,
           sws.due_at,
           lc.definition,lc.part_of_speech,
           lc.synonyms_json,lc.antonyms_json,lc.examples_json
    FROM word_levels wl
    JOIN words w ON w.id=wl.word_id
    LEFT JOIN student_word_state sws
      ON sws.word_id=w.id AND sws.student_id=?
    LEFT JOIN lexical_cache lc ON lc.word_id=w.id
    WHERE wl.year_group=? AND wl.active=1 AND wl.gem_score BETWEEN ? AND ?
    ORDER BY
      CASE WHEN sws.due_at IS NOT NULL AND sws.due_at<=CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
      COALESCE(sws.mastery,0) ASC,
      ABS(wl.gem_score-?) ASC,
      RANDOM()
    LIMIT ?
  `).bind(studentId || -1, year, min, max, target, limit).all();
  return results;
}

async function ensureLexicon(env, w) {
  if (w.definition && !isBadDefinition(w.definition)) {
    return normalise(w);
  }

  const fallback = {
    ...w,
    definition: simpleFallbackDefinition(w.lemma),
    part_of_speech: w.stored_pos || null,
    synonyms: [],
    antonyms: [],
    examples: [],
    lexical_status: 'fallback'
  };

  try {
    const res = await fetch(DICT_BASE + encodeURIComponent(w.lemma), {
      headers: { 'User-Agent': 'WordQuest/3.2 vocabulary-learning-app' }
    });
    if (!res.ok) {
      await cacheFailure(env, w.id);
      return fallback;
    }

    const data = await res.json();
    const lex = extract(data, w.lemma);
    if (!lex.definition) {
      await cacheFailure(env, w.id);
      return fallback;
    }

    await env.DB.prepare(`
      INSERT INTO lexical_cache(
        word_id,definition,part_of_speech,synonyms_json,antonyms_json,
        examples_json,source,fetched_at,fetch_status
      ) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'ok')
      ON CONFLICT(word_id) DO UPDATE SET
        definition=excluded.definition,
        part_of_speech=excluded.part_of_speech,
        synonyms_json=excluded.synonyms_json,
        antonyms_json=excluded.antonyms_json,
        examples_json=excluded.examples_json,
        source=excluded.source,
        fetched_at=CURRENT_TIMESTAMP,
        fetch_status='ok'
    `).bind(
      w.id, lex.definition, lex.part_of_speech,
      JSON.stringify(lex.synonyms), JSON.stringify(lex.antonyms),
      JSON.stringify(lex.examples), 'dictionaryapi.dev'
    ).run();

    return { ...w, ...lex, lexical_status: 'cached' };
  } catch {
    return fallback;
  }
}

async function cacheFailure(env, id) {
  try {
    await env.DB.prepare(`
      INSERT INTO lexical_cache(word_id,fetch_status,source)
      VALUES(?,'missing','dictionaryapi.dev')
      ON CONFLICT(word_id) DO UPDATE SET
        fetch_status='missing',fetched_at=CURRENT_TIMESTAMP
    `).bind(id).run();
  } catch {}
}

function extract(data, lemma) {
  const entries = Array.isArray(data) ? data : [];
  const meanings = [];

  for (const entry of entries) {
    for (const m of (entry.meanings || [])) {
      for (const d of (m.definitions || [])) {
        if (!d?.definition) continue;
        const definition = simplifyDefinition(d.definition, lemma);
        if (!definition || isBadDefinition(definition)) continue;

        meanings.push({
          definition,
          pos: m.partOfSpeech || null,
          synonyms: cleanWords([...(m.synonyms || []), ...(d.synonyms || [])], lemma),
          antonyms: cleanWords([...(m.antonyms || []), ...(d.antonyms || [])], lemma),
          example: d.example ? clean(d.example) : null
        });
      }
    }
  }

  if (!meanings.length) {
    return { definition: null, part_of_speech: null, synonyms: [], antonyms: [], examples: [] };
  }

  meanings.sort((a, b) => scoreMeaning(b, lemma) - scoreMeaning(a, lemma));
  const best = meanings[0];
  const samePos = meanings.filter(x => !best.pos || x.pos === best.pos).slice(0, 8);

  const synonyms = unique(samePos.flatMap(x => x.synonyms)).slice(0, 6);
  const antonyms = unique(samePos.flatMap(x => x.antonyms)).slice(0, 6);
  const examples = unique(samePos.map(x => x.example).filter(Boolean))
    .filter(x => x.length <= 160)
    .slice(0, 3);

  return {
    definition: best.definition,
    part_of_speech: best.pos,
    synonyms,
    antonyms,
    examples
  };
}

function simplifyDefinition(raw, lemma) {
  let s = clean(raw);

  // Remove labels and parenthetical dictionary jargon.
  s = s.replace(/^\([^)]*\)\s*/g, '');
  s = s.replace(/\([^)]{1,80}\)/g, '');
  s = s.replace(/^(transitive|intransitive|archaic|obsolete|rare|dated|figurative|grammar|linguistics)\s*[:.-]\s*/i, '');

  // Prefer the clearest clause if the dictionary returns several semicolon-separated senses.
  let parts = s.split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    parts.sort((a, b) => clarityScore(b, lemma) - clarityScore(a, lemma));
    s = parts[0];
  }

  // Remove self-referential boilerplate.
  s = s.replace(new RegExp(`\\bthe act of ${escapeRegExp(lemma)}\\b`, 'ig'), '');
  s = s.replace(/\s+/g, ' ').trim();

  // Child-facing length control.
  if (s.length > 115) {
    const sentences = s.split(/[.!?]/).map(x => x.trim()).filter(Boolean);
    if (sentences.length) s = sentences[0];
  }
  if (s.length > 115) {
    const comma = s.indexOf(',');
    if (comma > 25 && comma < 100) s = s.slice(0, comma);
  }

  s = s.replace(/[.;:,]+$/g, '').trim();
  if (!s) return null;

  // Normalize leading infinitives and articles for readability.
  if (/^[A-Z][a-z]/.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return s;
}

function clarityScore(s, lemma) {
  let score = 0;
  const len = s.length;
  if (len >= 18 && len <= 90) score += 6;
  else if (len <= 120) score += 3;
  if (/^(to |being |having |a |an |the )/i.test(s)) score += 2;
  if (!/[()]/.test(s)) score += 1;
  if (!/grammar|linguistics|obsolete|archaic|comparative|superlative/i.test(s)) score += 3;
  if (!s.toLowerCase().includes(lemma.toLowerCase())) score += 1;
  return score;
}

function scoreMeaning(x, lemma) {
  let s = clarityScore(x.definition, lemma);
  if (x.example) s += 2;
  if (x.synonyms?.length) s += 2;
  if (x.antonyms?.length) s += 1;
  return s;
}

function isBadDefinition(s) {
  if (!s) return true;
  const x = String(s).toLowerCase();
  return x.includes('a vocabulary word to learn and use accurately') ||
         x.includes('three degrees of comparison') ||
         x.includes('(grammar)') ||
         x.length < 8;
}

function simpleFallbackDefinition(lemma) {
  return `the meaning of “${lemma}” needs more context`;
}

function normalise(w) {
  return {
    ...w,
    definition: simplifyDefinition(w.definition, w.lemma) || w.definition,
    part_of_speech: w.part_of_speech || w.stored_pos || null,
    synonyms: parse(w.synonyms_json),
    antonyms: parse(w.antonyms_json),
    examples: parse(w.examples_json),
    lexical_status: 'cache'
  };
}

function cleanWords(arr, lemma) {
  return unique(arr)
    .map(x => x.toLowerCase())
    .filter(x => /^[a-z][a-z -]{1,28}$/i.test(x))
    .filter(x => x !== lemma.toLowerCase())
    .filter(x => !x.includes(' ')) // single-word options are cleaner for synonym/antonym MCQs
    .slice(0, 10);
}

function parse(v) { try { return v ? JSON.parse(v) : []; } catch { return []; } }
function spreadPick(arr, count) {
  const due = arr.filter(x => x.due_at && new Date(x.due_at) <= new Date());
  const unseen = arr.filter(x => !x.exposures);
  const learning = arr.filter(x => x.exposures && x.mastery < 0.6);
  const rest = arr.filter(x => !due.includes(x) && !unseen.includes(x) && !learning.includes(x));
  return uniqueById([...shuffle(due), ...shuffle(unseen), ...shuffle(learning), ...shuffle(rest)]).slice(0, count);
}
function uniqueById(a) { const s = new Set(); return a.filter(x => !s.has(x.id) && s.add(x.id)); }
function unique(a) { return [...new Set(a.map(x => String(x).trim()).filter(Boolean))]; }
function shuffle(a) { return [...a].sort(() => Math.random() - .5); }
function validYear(v) { v = String(v || '').toUpperCase(); return ['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(v) ? v : null; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.round(n) : min)); }
function clean(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
