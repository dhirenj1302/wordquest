import {hashCode,createCredential,sha256,authError} from './auth.js';

const SESSION_DAYS=90;
export function normaliseTeacherUsername(v){return String(v||'').trim().toLowerCase()}
export function validTeacherUsername(v){return /^[a-z0-9][a-z0-9._-]{2,23}$/.test(normaliseTeacherUsername(v))}
export async function createTeacherCredential(code){return createCredential(code)}
export async function verifyTeacherCode(code,salt,hash){return (await hashCode(code,salt))===hash}
export async function createTeacherSession(env,teacherId){
 const raw=crypto.getRandomValues(new Uint8Array(32));
 const token=[...raw].map(b=>b.toString(16).padStart(2,'0')).join('');
 const tokenHash=await sha256(token);
 await env.DB.prepare(`INSERT INTO teacher_sessions(teacher_id,token_hash,expires_at) VALUES(?,?,datetime('now',?))`).bind(teacherId,tokenHash,`+${SESSION_DAYS} days`).run();
 return token;
}
export async function requireTeacher(request,env){
 const header=request.headers.get('Authorization')||'';
 const m=header.match(/^Bearer\s+([a-f0-9]{64})$/i);
 if(!m)throw authError('teacher_sign_in_required',401);
 const tokenHash=await sha256(m[1].toLowerCase());
 const row=await env.DB.prepare(`SELECT t.id,t.name,t.username,ts.id AS session_id FROM teacher_sessions ts JOIN teachers t ON t.id=ts.teacher_id WHERE ts.token_hash=? AND ts.expires_at>CURRENT_TIMESTAMP LIMIT 1`).bind(tokenHash).first();
 if(!row)throw authError('teacher_session_expired',401);
 env.DB.prepare(`UPDATE teacher_sessions SET last_used_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.session_id).run().catch(()=>{});
 return row;
}
