import {requireStudent,authResponse,authError} from '../_lib/auth.js';

export async function onRequestPost({request,env}){
 try{
  const student=await requireStudent(request,env);
  const b=await request.json();
  const year=String(b.year_group||student.current_year_group).toUpperCase();
  if(!['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(year))throw authError('invalid_year_group');
  const row=await env.DB.prepare(`
    INSERT INTO practice_sessions(student_id,year_group,start_target_gem)
    VALUES(?,?,?) RETURNING id,started_at
  `).bind(student.id,year,b.start_target_gem==null?null:Number(b.start_target_gem)).first();
  return Response.json({practice_session_id:row.id,started_at:row.started_at},{status:201});
 }catch(err){return authResponse(err)}
}

export async function onRequestPatch({request,env}){
 try{
  const student=await requireStudent(request,env);
  const b=await request.json();
  const id=Number(b.practice_session_id||0);
  if(!id)throw authError('practice_session_id_required');
  const row=await env.DB.prepare(`
    UPDATE practice_sessions SET
      completed_at=CURRENT_TIMESTAMP,
      question_count=?,
      correct_count=?,
      hints_used=?,
      gems_earned=?,
      end_target_gem=?
    WHERE id=? AND student_id=?
    RETURNING id,started_at,completed_at,question_count,correct_count,hints_used,gems_earned,start_target_gem,end_target_gem
  `).bind(
    Number(b.question_count||0),Number(b.correct_count||0),Number(b.hints_used||0),
    Number(b.gems_earned||0),b.end_target_gem==null?null:Number(b.end_target_gem),
    id,student.id
  ).first();
  if(!row)throw authError('practice_session_not_found',404);
  return Response.json({ok:true,session:row});
 }catch(err){return authResponse(err)}
}
