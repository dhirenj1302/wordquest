export async function onRequestPost({ request, env }) {
  const b=await request.json();
  const required=['student_id','word_id','year_group','question_type','correct','gem_score'];
  if(required.some(k=>b[k]===undefined)) return Response.json({error:'missing required field'},{status:400});
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO attempts(student_id,word_id,year_group,question_type,correct,hints_used,response_ms,gem_score_at_attempt) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(b.student_id,b.word_id,b.year_group,b.question_type,b.correct?1:0,b.hints_used||0,b.response_ms||null,b.gem_score),
    env.DB.prepare(`INSERT INTO student_word_state(student_id,word_id,exposures,correct_first_try,incorrect,hints_used,mastery,last_seen_at)
      VALUES(?,?,1,?,?,?, ?,CURRENT_TIMESTAMP)
      ON CONFLICT(student_id,word_id) DO UPDATE SET exposures=exposures+1,
      correct_first_try=correct_first_try+excluded.correct_first_try, incorrect=incorrect+excluded.incorrect,
      hints_used=hints_used+excluded.hints_used,
      mastery=MAX(0,MIN(1,mastery + ?)), last_seen_at=CURRENT_TIMESTAMP`)
      .bind(b.student_id,b.word_id,(b.correct && !b.hints_used)?1:0,b.correct?0:1,b.hints_used||0,b.correct?0.15:0,b.correct?0.08:-0.10)
  ]);
  return Response.json({ok:true});
}
