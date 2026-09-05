import {authResponse,authError} from '../../_lib/auth.js';
import {requireTeacher} from '../../_lib/teacher-auth.js';

export async function onRequestGet({request,env}){
 try{
  const teacher=await requireTeacher(request,env);
  const {results}=await env.DB.prepare(`SELECT c.id,c.name,c.year_group,c.join_code,c.created_at,COUNT(CASE WHEN cs.active=1 THEN 1 END) AS student_count FROM classes c LEFT JOIN class_students cs ON cs.class_id=c.id WHERE c.teacher_id=? AND c.archived=0 GROUP BY c.id ORDER BY c.created_at DESC`).bind(teacher.id).all();
  return Response.json({classes:results},{headers:{'Cache-Control':'no-store'}});
 }catch(err){return authResponse(err)}
}

export async function onRequestPost({request,env}){
 try{
  const teacher=await requireTeacher(request,env);const b=await request.json();const action=String(b.action||'create');
  if(action==='create'){
   const name=String(b.name||'').trim().slice(0,60);const year=String(b.year_group||'').toUpperCase();
   if(!name)throw authError('class_name_required');
   if(!['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(year))throw authError('valid_year_group_required');
   let joinCode='';
   for(let i=0;i<8;i++){
    joinCode=randomCode();
    const exists=await env.DB.prepare(`SELECT id FROM classes WHERE join_code=?`).bind(joinCode).first();
    if(!exists)break;
   }
   const row=await env.DB.prepare(`INSERT INTO classes(teacher_id,name,year_group,join_code) VALUES(?,?,?,?) RETURNING id,name,year_group,join_code,created_at`).bind(teacher.id,name,year,joinCode).first();
   return Response.json({class:row},{status:201});
  }
  if(action==='add_student'){
   const classId=Number(b.class_id||0);const username=String(b.username||'').trim().toLowerCase();
   const cls=await env.DB.prepare(`SELECT id FROM classes WHERE id=? AND teacher_id=? AND archived=0`).bind(classId,teacher.id).first();
   if(!cls)throw authError('class_not_found',404);
   const student=await env.DB.prepare(`SELECT id,name,username,current_year_group FROM students WHERE username=? COLLATE NOCASE`).bind(username).first();
   if(!student)throw authError('student_not_found',404);
   await env.DB.prepare(`INSERT INTO class_students(class_id,student_id,active) VALUES(?,?,1) ON CONFLICT(class_id,student_id) DO UPDATE SET active=1`).bind(classId,student.id).run();
   return Response.json({ok:true,student});
  }
  if(action==='remove_student'){
   const classId=Number(b.class_id||0),studentId=Number(b.student_id||0);
   const cls=await env.DB.prepare(`SELECT id FROM classes WHERE id=? AND teacher_id=?`).bind(classId,teacher.id).first();if(!cls)throw authError('class_not_found',404);
   await env.DB.prepare(`UPDATE class_students SET active=0 WHERE class_id=? AND student_id=?`).bind(classId,studentId).run();
   return Response.json({ok:true});
  }
  throw authError('unknown_action');
 }catch(err){return authResponse(err)}
}

function randomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const b=crypto.getRandomValues(new Uint8Array(6));return [...b].map(x=>chars[x%chars.length]).join('')}
