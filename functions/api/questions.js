export async function onRequestGet({ request, env }) {
  try {
    const u = new URL(request.url);
    const allowedYears = new Set(['R','Y1','Y2','Y3','Y4','Y5','Y6']);
    const year = (u.searchParams.get('year') || 'Y1').toUpperCase();
    const count = Math.max(1, Math.min(100, Number(u.searchParams.get('count') || 10)));

    if (!allowedYears.has(year)) {
      return Response.json({ error: 'invalid_year' }, { status: 400 });
    }

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
      WHERE wl.year_group = ? AND wl.active = 1
      ORDER BY RANDOM()
      LIMIT ?
    `).bind(year, count).all();

    return Response.json({
      mode: 'qa',
      writes_progress: false,
      year,
      count: results.length,
      results: results.map(r => ({
        id: r.id,
        word: r.lemma,
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
      }))
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (err) {
    return Response.json({
      error: 'qa_endpoint_failed',
      detail: String(err?.message || err)
    }, { status: 500 });
  }
}

function parse(v) {
  try { return v ? JSON.parse(v) : []; }
  catch { return []; }
}
