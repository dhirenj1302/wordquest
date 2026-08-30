export async function onRequestGet({request,env}){
 try{
  const u=new URL(request.url);
  const year=(u.searchParams.get('year')||'Y4').toUpperCase();
  const {results}=await env.DB.prepare(`
   SELECT cc.year_group,w.lemma,cc.canonical_definition,cc.canonical_pos,
          cc.content_status,cc.source,cc.misconception_distractors_json,wl.gem_score
   FROM curriculum_content cc
   JOIN words w ON w.id=cc.word_id
   JOIN word_levels wl ON wl.word_id=cc.word_id AND wl.year_group=cc.year_group
   WHERE cc.year_group=?
   ORDER BY wl.gem_score,w.lemma
  `).bind(year).all();
  const summary=results.reduce((a,r)=>{a[r.content_status]=(a[r.content_status]||0)+1;return a},{});
  return Response.json({year,summary,results},{headers:{'Cache-Control':'no-store'}});
 }catch(err){
  return Response.json({error:'curriculum_failed',detail:String(err?.message||err)},{status:500});
 }
}
