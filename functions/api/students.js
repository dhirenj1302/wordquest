import {requireStudent,authResponse,authError} from '../_lib/auth.js';

export async function onRequestPatch({request,env}){
 try{
  const student=await requireStudent(request,env);
  const b=await request.json();
  const year=String(b.year_group||'').toUpperCase();
  if(!['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(year))throw authError('valid_year_group_required');
  const r=await env.DB.prepare(`
    UPDATE students SET current_year_group=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? RETURNING id,name,username,birth_year,current_year_group,updated_at
  `).bind(year,student.id).first();
  return Response.json(r);
 }catch(err){return authResponse(err)}
}
