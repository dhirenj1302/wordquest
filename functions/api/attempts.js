import {requireStudent,authResponse,authError} from '../_lib/auth.js';

export async function onRequestPost({request,env}){
 try{
  const student=await requireStudent(request,env);
  const b=await request.json();
  const required=['word_id','year_group','question_type','correct','gem_score'];
  if(required.some(k=>b[k]===undefined||b[k]===null))throw authError('missing_required_field');

  const correct=b.correct?1:0;
  const hints=Math.max(0,Number(b.hints_used||0));
  const firstTry=correct&&hints===0?1:0;
  const delta=correct?(hints?0.07:0.14):-0.12;
  const nextDays=correct?(hints?2:4):1;
  const practiceSessionId=b.practice_session_id?Number(b.practice_session_id):null;

  if(practiceSessionId){
    const own=await env.DB.prepare(`SELECT id FROM practice_sessions WHERE id=? AND student_id=?`)
      .bind(practiceSessionId,student.id).first();
    if(!own)throw authError('invalid_practice_session',403);
  }

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO attempts(
        student_id,word_id,year_group,question_type,correct,
        hints_used,response_ms,gem_score_at_attempt,practice_session_id
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).bind(
      student.id,Number(b.word_id),String(b.year_group),String(b.question_type),
      correct,hints,b.response_ms?Number(b.response_ms):null,
      Number(b.gem_score),practiceSessionId
    ),
    env.DB.prepare(`
      INSERT INTO student_word_state(
        student_id,word_id,exposures,correct_first_try,incorrect,
        hints_used,mastery,ease,interval_days,due_at,last_seen_at
      )
      VALUES(?,?,1,?,?,?, ?,2.5,?,datetime('now',?),CURRENT_TIMESTAMP)
      ON CONFLICT(student_id,word_id) DO UPDATE SET
        exposures=exposures+1,
        correct_first_try=correct_first_try+excluded.correct_first_try,
        incorrect=incorrect+excluded.incorrect,
        hints_used=hints_used+excluded.hints_used,
        mastery=MAX(0,MIN(1,mastery+?)),
        interval_days=?,
        due_at=datetime('now',?),
        last_seen_at=CURRENT_TIMESTAMP
    `).bind(
      student.id,Number(b.word_id),firstTry,correct?0:1,hints,
      correct?(hints?0.07:0.14):0,nextDays,`+${nextDays} days`,
      delta,nextDays,`+${nextDays} days`
    )
  ]);

  const state=await env.DB.prepare(`
    SELECT exposures,correct_first_try,incorrect,hints_used,mastery,
           interval_days,due_at,last_seen_at
    FROM student_word_state WHERE student_id=? AND word_id=?
  `).bind(student.id,Number(b.word_id)).first();

  return Response.json({ok:true,state});
 }catch(err){return authResponse(err)}
}
