import {authResponse,authError} from '../../_lib/auth.js';
import {requireTeacher} from '../../_lib/teacher-auth.js';

export async function onRequestGet({request,env}){
 try{
  const teacher=await requireTeacher(request,env);const u=new URL(request.url);
  const classId=Number(u.searchParams.get('class_id')||0);const studentId=Number(u.searchParams.get('student_id')||0);
  if(!classId)throw authError('class_id_required');
  const cls=await env.DB.prepare(`SELECT id,name,year_group,join_code FROM classes WHERE id=? AND teacher_id=? AND archived=0`).bind(classId,teacher.id).first();
  if(!cls)throw authError('class_not_found',404);
  if(studentId)return studentDetail(env,cls,studentId);

  const {results:students}=await env.DB.prepare(`
   SELECT s.id,s.name,s.username,s.current_year_group,
    COALESCE(lp.target_gem,55) AS target_gem,COALESCE(lp.questions_answered,0) AS questions_answered,
    lp.last_practice_at,
    COALESCE((SELECT COUNT(*) FROM practice_sessions ps WHERE ps.student_id=s.id AND ps.completed_at>=datetime('now','-7 days')),0) AS sessions_7d,
    COALESCE((SELECT COUNT(*) FROM practice_sessions ps WHERE ps.student_id=s.id AND ps.completed_at>=datetime('now','-30 days')),0) AS sessions_30d,
    COALESCE((SELECT SUM(ps.question_count) FROM practice_sessions ps WHERE ps.student_id=s.id AND ps.completed_at>=datetime('now','-30 days')),0) AS questions_30d,
    COALESCE((SELECT COUNT(*) FROM student_word_mastery_v1 m WHERE m.student_id=s.id AND m.status='mastered'),0) AS mastered_words,
    COALESCE((SELECT COUNT(*) FROM student_word_mastery_v1 m WHERE m.student_id=s.id AND m.status='secure'),0) AS secure_words,
    COALESCE((SELECT COUNT(*) FROM student_word_mastery_v1 m WHERE m.student_id=s.id AND m.status='fragile'),0) AS fragile_words,
    COALESCE((SELECT COUNT(*) FROM student_word_mastery_v1 m WHERE m.student_id=s.id AND m.due_at<=CURRENT_TIMESTAMP AND m.status!='mastered'),0) AS due_words,
    COALESCE((SELECT ROUND(AVG(m.composite_mastery),3) FROM student_word_mastery_v1 m WHERE m.student_id=s.id),0) AS avg_mastery
   FROM class_students cs JOIN students s ON s.id=cs.student_id
   LEFT JOIN student_learning_profile_v1 lp ON lp.student_id=s.id
   WHERE cs.class_id=? AND cs.active=1 ORDER BY s.name COLLATE NOCASE
  `).bind(classId).all();

  const today=new Date();
  const roster=students.map(s=>({...s,attention:attentionFlag(s,today)}));
  const summary={
   student_count:roster.length,
   active_7d:roster.filter(x=>Number(x.sessions_7d)>0).length,
   inactive_7d:roster.filter(x=>Number(x.sessions_7d)===0).length,
   needs_attention:roster.filter(x=>x.attention.level!=='ok').length,
   total_mastered_words:roster.reduce((a,x)=>a+Number(x.mastered_words||0),0),
   total_questions_30d:roster.reduce((a,x)=>a+Number(x.questions_30d||0),0)
  };
  return Response.json({class:cls,summary,students:roster},{headers:{'Cache-Control':'no-store'}});
 }catch(err){return authResponse(err)}
}

async function studentDetail(env,cls,studentId){
 const member=await env.DB.prepare(`SELECT s.id,s.name,s.username,s.current_year_group,s.birth_year FROM class_students cs JOIN students s ON s.id=cs.student_id WHERE cs.class_id=? AND s.id=? AND cs.active=1`).bind(cls.id,studentId).first();
 if(!member)throw authError('student_not_in_class',404);
 const profile=await env.DB.prepare(`SELECT target_gem,ability_confidence,questions_answered,sessions_completed,last_practice_at FROM student_learning_profile_v1 WHERE student_id=?`).bind(studentId).first();
 const {results:words}=await env.DB.prepare(`
  SELECT w.lemma,m.year_group,m.status,ROUND(m.composite_mastery,3) AS mastery,
   ROUND(m.recognition_score,3) AS recognition,ROUND(m.context_score,3) AS context,
   ROUND(m.production_score,3) AS production,ROUND(m.morphology_score,3) AS morphology,
   ROUND(m.transfer_score,3) AS transfer,m.exposures,m.correct_count,m.incorrect_count,m.hinted_correct_count,
   m.distinct_question_types,m.delayed_successes,m.due_at,m.last_seen_at
  FROM student_word_mastery_v1 m JOIN words w ON w.id=m.word_id
  WHERE m.student_id=? ORDER BY CASE m.status WHEN 'fragile' THEN 0 WHEN 'learning' THEN 1 WHEN 'secure' THEN 2 WHEN 'mastered' THEN 3 ELSE 4 END,m.composite_mastery ASC,w.lemma
 `).bind(studentId).all();
 const {results:sessions}=await env.DB.prepare(`SELECT id,year_group,completed_at,question_count,correct_count,hints_used,start_target_gem,end_target_gem,CASE WHEN question_count>0 THEN ROUND(100.0*correct_count/question_count,0) END AS accuracy FROM practice_sessions WHERE student_id=? AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 20`).bind(studentId).all();
 const statusCounts=Object.fromEntries(['new','learning','fragile','secure','mastered'].map(k=>[k,words.filter(w=>w.status===k).length]));
 return Response.json({class:cls,student:member,profile:profile||{},status_counts:statusCounts,
  proficient_words:words.filter(w=>['secure','mastered'].includes(w.status)).sort((a,b)=>b.mastery-a.mastery),
  needs_work:words.filter(w=>['fragile','learning'].includes(w.status)).slice(0,40),
  all_words:words,sessions},{headers:{'Cache-Control':'no-store'}});
}

function attentionFlag(s,today){
 const last=s.last_practice_at?Date.parse(s.last_practice_at):0;const days=last?Math.floor((today-last)/86400000):999;
 if(days>=7)return{level:'high',reason:'No practice in 7 days'};
 if(Number(s.fragile_words)>=8)return{level:'high',reason:`${s.fragile_words} fragile words`};
 if(Number(s.due_words)>=10)return{level:'medium',reason:`${s.due_words} words due for review`};
 if(Number(s.sessions_7d)<2)return{level:'medium',reason:'Only one practice session this week'};
 return{level:'ok',reason:'On track'};
}
