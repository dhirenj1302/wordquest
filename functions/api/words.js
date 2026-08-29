export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const year = u.searchParams.get('year') || 'Y3';
  const minGem = Number(u.searchParams.get('minGem') || 1);
  const maxGem = Number(u.searchParams.get('maxGem') || 100);
  const limit = Math.min(Number(u.searchParams.get('limit') || 20), 100);
  const { results } = await env.DB.prepare(`
    SELECT w.id, w.lemma, w.part_of_speech, wl.year_group, wl.percentile_band,
           wl.gem_score, wl.difficulty
    FROM word_levels wl JOIN words w ON w.id=wl.word_id
    WHERE wl.year_group=? AND wl.active=1 AND wl.gem_score BETWEEN ? AND ?
    ORDER BY RANDOM() LIMIT ?`).bind(year,minGem,maxGem,limit).all();
  return Response.json({year, results});
}
