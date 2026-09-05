import {authResponse,authError,validCode} from '../../_lib/auth.js';
import {normaliseTeacherUsername,validTeacherUsername,createTeacherCredential,verifyTeacherCode,createTeacherSession,requireTeacher} from '../../_lib/teacher-auth.js';

export async function onRequestPost({request,env}){
 try{
  const b=await request.json();
  const action=String(b.action||'login');
  const username=normaliseTeacherUsername(b.username),code=String(b.code||'');
  if(!validTeacherUsername(username)||!validCode(code))throw authError('invalid_teacher_username_or_code',400);
  if(action==='register'){
   const name=String(b.name||'').trim().slice(0,60);if(!name)throw authError('teacher_name_required');
   const exists=await env.DB.prepare(`SELECT id FROM teachers WHERE username=? COLLATE NOCASE`).bind(username).first();
   if(exists)throw authError('teacher_username_already_taken',409);
   const cred=await createTeacherCredential(code);
   const teacher=await env.DB.prepare(`INSERT INTO teachers(name,username,code_salt,code_hash,last_login_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) RETURNING id,name,username`).bind(name,username,cred.salt,cred.hash).first();
   const token=await createTeacherSession(env,teacher.id);
   return Response.json({token,teacher},{status:201});
  }
  if(action==='login'){
   const teacher=await env.DB.prepare(`SELECT id,name,username,code_salt,code_hash FROM teachers WHERE username=? COLLATE NOCASE`).bind(username).first();
   if(!teacher||!(await verifyTeacherCode(code,teacher.code_salt,teacher.code_hash)))throw authError('incorrect_teacher_username_or_code',401);
   await env.DB.prepare(`UPDATE teachers SET last_login_at=CURRENT_TIMESTAMP WHERE id=?`).bind(teacher.id).run();
   const token=await createTeacherSession(env,teacher.id);delete teacher.code_salt;delete teacher.code_hash;
   return Response.json({token,teacher});
  }
  throw authError('unknown_action');
 }catch(err){return authResponse(err)}
}

export async function onRequestGet({request,env}){
 try{const t=await requireTeacher(request,env);return Response.json({teacher:{id:t.id,name:t.name,username:t.username}})}catch(err){return authResponse(err)}
}
