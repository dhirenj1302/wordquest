import {
  normaliseUsername,validUsername,validCode,hashCode,
  createCredential,createSession,requireStudent,sha256,authResponse,authError
} from '../_lib/auth.js';

export async function onRequestPost({request,env}){
 try{
  const b=await request.json();
  const action=String(b.action||'login');

  if(action==='register'){
    const username=normaliseUsername(b.username);
    const code=String(b.code||'');
    const name=String(b.name||'').trim().slice(0,40);
    const year=String(b.year_group||'').toUpperCase();
    if(!validUsername(username))throw authError('username_must_be_3_to_24_letters_numbers_dots_dashes_or_underscores');
    if(!validCode(code))throw authError('code_must_be_exactly_6_digits');
    if(!name)throw authError('student_name_required');
    if(!['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(year))throw authError('valid_year_group_required');

    const exists=await env.DB.prepare(`SELECT id FROM students WHERE username=? COLLATE NOCASE`).bind(username).first();
    if(exists)throw authError('username_already_taken',409);

    const cred=await createCredential(code);
    const student=await env.DB.prepare(`
      INSERT INTO students(name,birth_year,current_year_group,username,code_salt,code_hash,last_login_at)
      VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
      RETURNING id,name,username,birth_year,current_year_group,created_at
    `).bind(name,b.birth_year?Number(b.birth_year):null,year,username,cred.salt,cred.hash).first();

    const token=await createSession(env,student.id);
    return Response.json({token,student},{status:201});
  }

  if(action==='claim_legacy'){
    const username=normaliseUsername(b.username),code=String(b.code||'');
    const studentId=Number(b.student_id||0),name=String(b.name||'').trim();
    if(!studentId||!name)throw authError('saved_learner_details_required');
    if(!validUsername(username))throw authError('invalid_username');
    if(!validCode(code))throw authError('code_must_be_exactly_6_digits');
    const exists=await env.DB.prepare(`SELECT id FROM students WHERE username=? COLLATE NOCASE`).bind(username).first();
    if(exists)throw authError('username_already_taken',409);
    const old=await env.DB.prepare(`SELECT id,name,username FROM students WHERE id=?`).bind(studentId).first();
    if(!old || old.username || old.name!==name)throw authError('saved_learner_cannot_be_claimed',409);
    const cred=await createCredential(code);
    const student=await env.DB.prepare(`
      UPDATE students SET username=?,code_salt=?,code_hash=?,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? RETURNING id,name,username,birth_year,current_year_group
    `).bind(username,cred.salt,cred.hash,studentId).first();
    const token=await createSession(env,student.id);
    return Response.json({token,student,claimed:true});
  }

  if(action==='login'){
    const username=normaliseUsername(b.username),code=String(b.code||'');
    if(!validUsername(username)||!validCode(code))throw authError('incorrect_username_or_code',401);
    const student=await env.DB.prepare(`
      SELECT id,name,username,birth_year,current_year_group,code_salt,code_hash
      FROM students WHERE username=? COLLATE NOCASE LIMIT 1
    `).bind(username).first();
    if(!student?.code_hash||!student?.code_salt)throw authError('incorrect_username_or_code',401);
    const candidate=await hashCode(code,student.code_salt);
    if(candidate!==student.code_hash)throw authError('incorrect_username_or_code',401);
    await env.DB.prepare(`UPDATE students SET last_login_at=CURRENT_TIMESTAMP WHERE id=?`).bind(student.id).run();
    const token=await createSession(env,student.id);
    delete student.code_salt;delete student.code_hash;
    return Response.json({token,student});
  }

  throw authError('unknown_action');
 }catch(err){return authResponse(err)}
}

export async function onRequestGet({request,env}){
 try{
  const student=await requireStudent(request,env);
  return Response.json({student:{
    id:student.id,name:student.name,username:student.username,
    birth_year:student.birth_year,current_year_group:student.current_year_group
  }},{headers:{'Cache-Control':'no-store'}});
 }catch(err){return authResponse(err)}
}

export async function onRequestDelete({request,env}){
 try{
  const header=request.headers.get('Authorization')||'';
  const m=header.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if(m){
    const tokenHash=await sha256(m[1].toLowerCase());
    await env.DB.prepare(`DELETE FROM login_sessions WHERE token_hash=?`).bind(tokenHash).run();
  }
  return Response.json({ok:true});
 }catch(err){return authResponse(err)}
}
