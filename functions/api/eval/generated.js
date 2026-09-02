export async function onRequestGet({ request, env }) {
  try {
    const u = new URL(request.url);
    const allowedYears = new Set(['R','Y1','Y2','Y3','Y4','Y5','Y6']);
    const year = (u.searchParams.get('year') || 'Y1').toUpperCase();
    const count = clamp(Number(u.searchParams.get('count') || 10), 1, 50);

    if (!allowedYears.has(year)) {
      return Response.json({ error: 'invalid_year' }, { status: 400 });
    }

    // Pull a larger pool so distractors can be drawn from comparable words.
    const { results } = await env.DB.prepare(`
      SELECT
        w.id,
        w.lemma,
        wl.year_group,
        wl.gem_score,
        wl.percentile_band,
        COALESCE(cc.canonical_definition, lc.definition) AS definition,
        COALESCE(cc.canonical_pos, lc.part_of_speech, w.part_of_speech) AS part_of_speech,
        COALESCE(cc.synonyms_json, lc.synonyms_json, '[]') AS synonyms_json,
        COALESCE(cc.antonyms_json, lc.antonyms_json, '[]') AS antonyms_json,
        COALESCE(cc.examples_json, lc.examples_json, '[]') AS examples_json,
        COALESCE(cc.misconception_distractors_json, '[]') AS misconception_distractors_json,
        COALESCE(cc.content_status, 'uncurated') AS content_status
      FROM word_levels wl
      JOIN words w ON w.id = wl.word_id
      LEFT JOIN curriculum_content cc
        ON cc.word_id = w.id AND cc.year_group = wl.year_group
      LEFT JOIN lexical_cache lc
        ON lc.word_id = w.id
      WHERE wl.year_group = ?
        AND wl.active = 1
        AND COALESCE(cc.canonical_definition, lc.definition) IS NOT NULL
        AND LENGTH(TRIM(COALESCE(cc.canonical_definition, lc.definition))) >= 8
      ORDER BY RANDOM()
      LIMIT 100
    `).bind(year).all();

    const pool = results.map(normalise).filter(x => goodDefinition(x.definition));

    if (pool.length < 8) {
      return Response.json({
        error: 'not_enough_usable_content',
        year,
        usable_items: pool.length,
        detail: 'The QA generator needs at least 8 items with definitions.'
      }, { status: 500 });
    }

    const questions = [];
    let attempts = 0;

    while (questions.length < count && attempts < count * 20) {
      attempts++;
      const w = pool[Math.floor(Math.random() * pool.length)];
      const q = makeQuestion(w, pool);
      if (!q || q.options.length !== 4) continue;

      // Avoid duplicate word+type combinations in one sample.
      if (questions.some(x => x.word === q.word && x.question_type === q.question_type)) continue;
      questions.push(q);
    }

    return Response.json({
      mode: 'qa_generated_questions',
      writes_progress: false,
      year,
      requested_count: count,
      generated_count: questions.length,
      generator_version: 'phase3a-1',
      questions
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (err) {
    return Response.json({
      error: 'qa_generated_questions_failed',
      detail: String(err?.message || err)
    }, { status: 500 });
  }
}

function makeQuestion(w, pool) {
  const types = ['meaning', 'word_from_definition'];
  if (w.synonyms.length) types.push('synonym');
  if (w.antonyms.length) types.push('antonym');
  if (w.examples.length) types.push('context');

  const type = types[Math.floor(Math.random() * types.length)];
  const samePos = pool.filter(x => x.id !== w.id && x.definition && samePartOfSpeech(w, x));
  const others = samePos.length >= 6 ? samePos : pool.filter(x => x.id !== w.id && x.definition);

  let stem, correct, options, example = null;

  if (type === 'meaning') {
    stem = `What does “${w.lemma}” mean?`;
    correct = w.definition;
    options = [correct, ...definitionDistractors(w, others, 3)];
  } else if (type === 'word_from_definition') {
    stem = `Which word best matches this meaning: “${w.definition}”?`;
    correct = w.lemma;
    options = [correct, ...wordDistractors(w, others, 3)];
  } else if (type === 'synonym') {
    stem = `Which word is closest in meaning to “${w.lemma}”?`;
    correct = w.synonyms[0];
    options = [correct, ...synonymDistractors(w, others, correct, 3)];
  } else if (type === 'antonym') {
    stem = `Which word is most nearly the opposite of “${w.lemma}”?`;
    correct = w.antonyms[0];
    options = [correct, ...antonymDistractors(w, others, correct, 3)];
  } else {
    example = w.examples[0];
    stem = `In this sentence, what does “${w.lemma}” most nearly mean?`;
    correct = w.definition;
    options = [correct, ...contextDistractors(w, others, 3)];
  }

  options = unique(options.filter(isGoodOption)).slice(0, 4);

  const emergency = others.flatMap(x => [x.definition, x.lemma]).filter(isGoodOption);
  for (const x of emergency) {
    if (options.length >= 4) break;
    if (!options.includes(x)) options.push(x);
  }

  if (options.length !== 4) return null;

  return {
    word: w.lemma,
    year_group: w.year_group,
    gem_score: w.gem_score,
    percentile_band: w.percentile_band,
    question_type: type,
    stem,
    example,
    correct_answer: correct,
    options: shuffle(options),
    target_definition: w.definition,
    target_part_of_speech: w.part_of_speech,
    target_synonyms: w.synonyms,
    target_antonyms: w.antonyms,
    content_status: w.content_status
  };
}

function definitionDistractors(w, pool, n) {
  const curated = curatedMisconceptions(w);
  if (curated.length >= n) return curated.slice(0, n);

  const generated = rankDefinitions(w, pool)
    .map(x => x.definition)
    .filter(x => isSafeDistractor(w, x, false));

  return unique([...curated, ...generated]).slice(0, n);
}

function contextDistractors(w, pool, n) {
  const curated = curatedMisconceptions(w);
  if (curated.length >= n) return curated.slice(0, n);

  const generated = rankDefinitions(w, pool)
    .map(x => x.definition)
    .filter(x => isSafeDistractor(w, x, true));

  return unique([...curated, ...generated]).slice(0, n);
}

function wordDistractors(w, pool, n) {
  return rankWords(w, pool).map(x => x.lemma).slice(0, n);
}

function synonymDistractors(w, pool, correct, n) {
  const candidates = [
    ...w.antonyms,
    ...rankWords(w, pool).map(x => x.lemma),
    ...pool.flatMap(x => x.synonyms)
  ];
  return unique(candidates)
    .filter(x => x !== correct && x !== w.lemma && isGoodWordOption(x))
    .slice(0, n);
}

function antonymDistractors(w, pool, correct, n) {
  const candidates = [
    ...w.synonyms,
    ...rankWords(w, pool).map(x => x.lemma),
    ...pool.flatMap(x => x.antonyms)
  ];
  return unique(candidates)
    .filter(x => x !== correct && x !== w.lemma && isGoodWordOption(x))
    .slice(0, n);
}

function curatedMisconceptions(w) {
  return unique(w.misconception_distractors)
    .filter(isGoodOption)
    .filter(x => isSafeDistractor(w, x, true));
}

function rankDefinitions(w, pool) {
  return [...pool]
    .filter(x => isGoodOption(x.definition))
    .map(x => ({
      x,
      score:
        (samePartOfSpeech(w, x) ? 8 : 0) +
        (10 - Math.min(10, Math.abs((x.gem_score || 50) - (w.gem_score || 50)) / 4)) +
        lexicalShapeScore(w.definition, x.definition)
    }))
    .sort((a, b) => b.score - a.score)
    .map(o => o.x);
}

function rankWords(w, pool) {
  return [...pool]
    .filter(x => isGoodWordOption(x.lemma))
    .map(x => ({
      x,
      score:
        (samePartOfSpeech(w, x) ? 8 : 0) +
        (10 - Math.min(10, Math.abs((x.gem_score || 50) - (w.gem_score || 50)) / 4)) +
        wordShapeScore(w.lemma, x.lemma)
    }))
    .sort((a, b) => b.score - a.score)
    .map(o => o.x);
}

function isSafeDistractor(w, candidate, forContext = false) {
  if (!isGoodOption(candidate)) return false;
  const target = String(w.definition || '').toLowerCase();
  const cand = String(candidate || '').toLowerCase();

  if (semanticOverlap(target, cand) >= 0.28) return false;

  const banned = [w.lemma, ...w.synonyms].map(x => String(x).toLowerCase());
  if (banned.some(x => x.length > 3 && new RegExp(`\\b${escapeRX(x)}\\b`, 'i').test(cand))) return false;

  if (forContext && behaviouralOverlap(target, cand)) return false;
  return true;
}

function semanticOverlap(a, b) {
  const stop = new Set(['the','a','an','and','or','to','of','in','on','for','with','your','you','is','are','be','being','something','someone','very','than','that','this','it','as','by','from','after','before','without']);
  const ta = new Set(tokenise(a).filter(x => x.length > 3 && !stop.has(x)));
  const tb = new Set(tokenise(b).filter(x => x.length > 3 && !stop.has(x)));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const x of ta) if (tb.has(x)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function behaviouralOverlap(a, b) {
  const families = [
    ['careful','carefully','thought','considered','precise','steady','effort','thorough'],
    ['bold','risk','daring','fearless','brave'],
    ['clear','clearly','express','explain','articulate'],
    ['uncertain','hesitation','hesitant','tentative','doubt'],
    ['persistent','continue','effort','determined','tenacious'],
    ['kind','generous','help','charitable','benevolent'],
    ['honest','direct','frank','candid'],
    ['practical','workable','possible','feasible'],
    ['harm','harmful','damage','damaging','detrimental'],
    ['watchful','alert','attentive','vigilant']
  ];
  const aa = new Set(tokenise(a)), bb = new Set(tokenise(b));
  for (const fam of families) {
    const x = fam.some(t => aa.has(t)), y = fam.some(t => bb.has(t));
    if (x && y) return true;
  }
  return false;
}

function samePartOfSpeech(a, b) {
  const pa = String(a.part_of_speech || '').toLowerCase();
  const pb = String(b.part_of_speech || '').toLowerCase();
  return pa && pb && pa === pb;
}

function lexicalShapeScore(a, b) {
  a = String(a || '').toLowerCase();
  b = String(b || '').toLowerCase();
  let s = 0;
  const aw = a.split(/\s+/).length, bw = b.split(/\s+/).length;
  if (Math.abs(aw - bw) <= 2) s += 2;
  if (Math.abs(a.length - b.length) <= 30) s += 2;
  return s;
}

function wordShapeScore(a, b) {
  a = String(a || '');
  b = String(b || '');
  let s = 0;
  if (Math.abs(a.length - b.length) <= 3) s += 2;
  if (a[0] === b[0]) s += 1;
  return s;
}

function isGoodOption(x) {
  const s = String(x || '').trim();
  if (!s) return false;
  const l = s.toLowerCase();
  if (l.includes('a vocabulary word to learn and use accurately')) return false;
  if (l.includes('needs more context')) return false;
  if (l.includes('three degrees of comparison')) return false;
  if (l.includes('(grammar)')) return false;
  if (s.length > 150) return false;
  return true;
}

function isGoodWordOption(x) {
  const s = String(x || '').trim();
  return /^[A-Za-z][A-Za-z -]{1,30}$/.test(s);
}

function goodDefinition(s) {
  if (!s) return false;
  const x = String(s).toLowerCase();
  return x.length >= 8 &&
    x.length <= 150 &&
    !x.includes('a vocabulary word to learn and use accurately') &&
    !x.includes('needs more context') &&
    !x.includes('three degrees of comparison');
}

function normalise(r) {
  return {
    id: r.id,
    lemma: r.lemma,
    year_group: r.year_group,
    gem_score: r.gem_score,
    percentile_band: r.percentile_band,
    definition: r.definition,
    part_of_speech: r.part_of_speech,
    synonyms: parse(r.synonyms_json),
    antonyms: parse(r.antonyms_json),
    examples: parse(r.examples_json),
    misconception_distractors: parse(r.misconception_distractors_json),
    content_status: r.content_status
  };
}

function parse(v) { try { return v ? JSON.parse(v) : []; } catch { return []; } }
function unique(a) { return [...new Set(a.map(x => String(x).trim()).filter(Boolean))]; }
function shuffle(a) { return [...a].sort(() => Math.random() - .5); }
function tokenise(s) { return String(s || '').toLowerCase().match(/[a-z]+/g) || []; }
function escapeRX(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.round(n) : min)); }
