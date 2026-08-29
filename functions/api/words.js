export async function onRequestGet({ request, env }) {
  try {
    const u = new URL(request.url);
    const allowedYears = new Set(['R','Y1','Y2','Y3','Y4','Y5','Y6']);
    const requestedYear = (u.searchParams.get('year') || 'Y3').toUpperCase();
    const year = allowedYears.has(requestedYear) ? requestedYear : 'Y3';
    const minGem = clampNumber(u.searchParams.get('minGem'), 1, 100, 1);
    const maxGem = clampNumber(u.searchParams.get('maxGem'), minGem, 100, 100);
    const limit = clampNumber(u.searchParams.get('limit'), 1, 100, 20);
    const studentId = Number(u.searchParams.get('student_id') || 0);

    let sql = `
      SELECT w.id, w.lemma,
             COALESCE(lc.part_of_speech, w.part_of_speech) AS part_of_speech,
             wl.year_group, wl.percentile_band, wl.gem_score, wl.difficulty,
             COALESCE(sws.exposures,0) AS exposures,
             COALESCE(sws.mastery,0) AS mastery,
             sws.due_at,
             lc.definition, lc.synonyms_json, lc.antonyms_json, lc.examples_json
      FROM word_levels wl
      JOIN words w ON w.id = wl.word_id
      LEFT JOIN lexical_cache lc ON lc.word_id = w.id
      LEFT JOIN student_word_state sws
        ON sws.word_id = w.id AND sws.student_id = ?
      WHERE wl.year_group = ?
        AND wl.active = 1
        AND wl.gem_score BETWEEN ? AND ?
      ORDER BY
        CASE WHEN sws.due_at IS NOT NULL AND sws.due_at <= CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
        COALESCE(sws.mastery,0) ASC,
        RANDOM()
      LIMIT ?`;

    const { results } = await env.DB.prepare(sql)
      .bind(studentId || -1, year, minGem, maxGem, limit).all();

    return Response.json({
      year,
      minGem,
      maxGem,
      results: results.map(normalise)
    }, { headers: noStore() });
  } catch (err) {
    return Response.json({ error: 'words_failed', detail: String(err?.message || err) }, { status: 500 });
  }
}

function normalise(r) {
  return {
    ...r,
    synonyms: parseArray(r.synonyms_json),
    antonyms: parseArray(r.antonyms_json),
    examples: parseArray(r.examples_json)
  };
}
function parseArray(v){ try { return v ? JSON.parse(v) : []; } catch { return []; } }
function clampNumber(v,min,max,fallback){
  const n=Number(v);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,Math.round(n)));
}
function noStore(){ return { 'Cache-Control':'no-store' }; }
