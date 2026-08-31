const ITERATIONS=100000;
const SESSION_DAYS=90;

export function normaliseUsername(v){
  return String(v||'').trim().toLowerCase();
}
export function validUsername(v){
  return /^[a-z0-9][a-z0-9._-]{2,23}$/.test(normaliseUsername(v));
}
export function validCode(v){
  return /^\d{6}$/.test(String(v||''));
}
export async function hashCode(code,saltHex){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey(
    'raw',enc.encode(String(code)),'PBKDF2',false,['deriveBits']
  );
  const bits=await crypto.subtle.deriveBits({
    name:'PBKDF2',hash:'SHA-256',salt:hexToBytes(saltHex),iterations:ITERATIONS
  },key,256);
  return bytesToHex(new Uint8Array(bits));
}
export async function createCredential(code){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const saltHex=bytesToHex(salt);
  return {salt:saltHex,hash:await hashCode(code,saltHex)};
}
export async function createSession(env,studentId){
  const raw=crypto.getRandomValues(new Uint8Array(32));
  const token=bytesToHex(raw);
  const tokenHash=await sha256(token);
  await env.DB.prepare(`
    INSERT INTO login_sessions(student_id,token_hash,expires_at)
    VALUES(?,?,datetime('now',?))
  `).bind(studentId,tokenHash,`+${SESSION_DAYS} days`).run();
  return token;
}
export async function requireStudent(request,env){
  const header=request.headers.get('Authorization')||'';
  const m=header.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if(!m)throw authError('sign_in_required',401);
  const tokenHash=await sha256(m[1].toLowerCase());
  const row=await env.DB.prepare(`
    SELECT s.id,s.name,s.username,s.birth_year,s.current_year_group,
           ls.id AS session_id
    FROM login_sessions ls
    JOIN students s ON s.id=ls.student_id
    WHERE ls.token_hash=? AND ls.expires_at>CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(tokenHash).first();
  if(!row)throw authError('session_expired',401);
  env.DB.prepare(`UPDATE login_sessions SET last_used_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(row.session_id).run().catch(()=>{});
  return row;
}
export async function sha256(v){
  const bytes=new TextEncoder().encode(String(v));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return bytesToHex(new Uint8Array(hash));
}
export function authError(message,status=400){
  const e=new Error(message);e.status=status;return e;
}
export function authResponse(err){
  return Response.json(
    {error:err?.message||'request_failed'},
    {status:Number(err?.status)||500}
  );
}
function bytesToHex(a){return [...a].map(b=>b.toString(16).padStart(2,'0')).join('')}
function hexToBytes(h){
  const a=new Uint8Array(h.length/2);
  for(let i=0;i<a.length;i++)a[i]=parseInt(h.slice(i*2,i*2+2),16);
  return a;
}
