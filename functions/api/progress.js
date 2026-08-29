export async function onRequestGet({ request, env }) {
  try {
    const u=new URL(request.url);
    const studentId=Number(u.searchParams.get('student_id')||0);
    if(!studentId) return Response.json({error:'student_id required'},{status:400});

    const totals=await env.DB.prepare(`
      SELECT COUNT(*) AS answered,
             SUM(correct) AS correct,
             ROUND(100.0*SUM(correct)/NULLIF(COUNT(*),0),1) AS accuracy
      FROM attempts WHERE student_id=?
    `).bind(studentId).first();

    const {results: words}=await env.DB.prepare(`
      SELECT w.lemma,sws.exposures,sws.correct_first_try,sws.incorrect,
             sws.hints_used,ROUND(sws.mastery,3) AS mastery,sws.due_at
      FROM student_word_state sws
      JOIN words w ON w.id=sws.word_id
      WHERE sws.student_id=?
      ORDER BY sws.mastery ASC,sws.last_seen_at DESC
      LIMIT 80
    `).bind(studentId).all();

    const strong=words.filter(x=>x.mastery>=0.55).sort((a,b)=>b.mastery-a.mastery).slice(0,8);
    const weak=words.filter(x=>x.mastery<0.45).slice(0,8);

    return Response.json({totals,strong,weak},{headers:{'Cache-Control':'no-store'}});
  }catch(err){
    return Response.json({error:'progress_failed',detail:String(err?.message||err)},{status:500});
  }
}
