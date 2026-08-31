import {requireStudent,authResponse} from '../_lib/auth.js';

export async function onRequestGet({request,env}){
 try{
  const student=await requireStudent(request,env);
  const id=student.id;

  const totals=await env.DB.prepare(`
    SELECT COUNT(*) AS answered,
           COALESCE(SUM(correct),0) AS correct,
           ROUND(100.0*SUM(correct)/NULLIF(COUNT(*),0),1) AS accuracy,
           COUNT(DISTINCT word_id) AS unique_words_seen,
           ROUND(AVG(gem_score_at_attempt),1) AS avg_gem_attempted
    FROM attempts WHERE student_id=?
  `).bind(id).first();

  const practice=await env.DB.prepare(`
    SELECT
      COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) AS completed_sessions,
      COUNT(CASE WHEN completed_at>=datetime('now','-7 days') THEN 1 END) AS sessions_7d,
      COUNT(CASE WHEN completed_at>=datetime('now','-30 days') THEN 1 END) AS sessions_30d,
      COUNT(DISTINCT CASE WHEN completed_at>=datetime('now','-30 days') THEN date(completed_at) END) AS active_days_30d,
      MAX(completed_at) AS last_practice_at,
      COALESCE(SUM(CASE WHEN completed_at>=datetime('now','-30 days') THEN question_count ELSE 0 END),0) AS questions_30d
    FROM practice_sessions
    WHERE student_id=?
  `).bind(id).first();

  const {results:activeDates}=await env.DB.prepare(`
    SELECT DISTINCT date(completed_at) AS d
    FROM practice_sessions
    WHERE student_id=? AND completed_at IS NOT NULL
    ORDER BY d DESC LIMIT 120
  `).bind(id).all();

  const streak=currentStreak(activeDates.map(x=>x.d));

  const {results:recentSessions}=await env.DB.prepare(`
    SELECT id,year_group,started_at,completed_at,question_count,correct_count,
           hints_used,gems_earned,start_target_gem,end_target_gem,
           CASE WHEN question_count>0 THEN ROUND(100.0*correct_count/question_count,0) END AS accuracy
    FROM practice_sessions
    WHERE student_id=? AND completed_at IS NOT NULL
    ORDER BY completed_at DESC LIMIT 12
  `).bind(id).all();

  const {results:first20}=await env.DB.prepare(`
    SELECT correct,gem_score_at_attempt FROM attempts
    WHERE student_id=? ORDER BY created_at ASC LIMIT 20
  `).bind(id).all();
  const {results:last20desc}=await env.DB.prepare(`
    SELECT correct,gem_score_at_attempt FROM attempts
    WHERE student_id=? ORDER BY created_at DESC LIMIT 20
  `).bind(id).all();
  const last20=[...last20desc].reverse();
  const improvement=compareWindows(first20,last20);

  const {results:words}=await env.DB.prepare(`
    SELECT w.lemma,sws.exposures,sws.correct_first_try,sws.incorrect,
           sws.hints_used,ROUND(sws.mastery,3) AS mastery,sws.due_at,sws.last_seen_at,
           ROUND(1.0*sws.correct_first_try/NULLIF(sws.exposures,0),3) AS first_try_rate
    FROM student_word_state sws
    JOIN words w ON w.id=sws.word_id
    WHERE sws.student_id=?
    ORDER BY
      (sws.incorrect*2+sws.hints_used+CASE WHEN sws.mastery<0.4 THEN 2 ELSE 0 END) DESC,
      sws.last_seen_at DESC
    LIMIT 120
  `).bind(id).all();

  const difficult=words
    .filter(x=>x.incorrect>0||x.hints_used>0||x.mastery<0.4)
    .slice(0,12);
  const strong=words
    .filter(x=>x.exposures>=2&&x.mastery>=0.55)
    .sort((a,b)=>b.mastery-a.mastery)
    .slice(0,10);

  const mastery=await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN mastery>=0.70 THEN 1 ELSE 0 END) AS mastered,
      SUM(CASE WHEN mastery>=0.40 AND mastery<0.70 THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN mastery<0.40 THEN 1 ELSE 0 END) AS fragile
    FROM student_word_state WHERE student_id=?
  `).bind(id).first();

  return Response.json({
    student:{name:student.name,username:student.username,year_group:student.current_year_group},
    totals,practice:{...practice,current_streak_days:streak},
    improvement,mastery,difficult,strong,recent_sessions:recentSessions,
    active_dates:activeDates.map(x=>x.d)
  },{headers:{'Cache-Control':'no-store'}});
 }catch(err){return authResponse(err)}
}

function compareWindows(first,last){
 if(!first.length||!last.length)return {enough_data:false};
 const fAcc=avg(first.map(x=>Number(x.correct)))*100;
 const lAcc=avg(last.map(x=>Number(x.correct)))*100;
 const fGem=avg(first.map(x=>Number(x.gem_score_at_attempt)));
 const lGem=avg(last.map(x=>Number(x.gem_score_at_attempt)));
 return {
  enough_data:first.length>=10&&last.length>=10,
  first_attempts:first.length,recent_attempts:last.length,
  early_accuracy:round1(fAcc),recent_accuracy:round1(lAcc),
  accuracy_change:round1(lAcc-fAcc),
  early_avg_gem:round1(fGem),recent_avg_gem:round1(lGem),
  gem_change:round1(lGem-fGem)
 };
}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function round1(n){return Math.round(n*10)/10}
function currentStreak(dates){
 if(!dates.length)return 0;
 const set=new Set(dates);
 const today=new Date();today.setUTCHours(0,0,0,0);
 const yesterday=new Date(today);yesterday.setUTCDate(yesterday.getUTCDate()-1);
 const fmt=d=>d.toISOString().slice(0,10);
 let cursor=set.has(fmt(today))?today:(set.has(fmt(yesterday))?yesterday:null);
 if(!cursor)return 0;
 let n=0;
 while(set.has(fmt(cursor))){
  n++;cursor=new Date(cursor);cursor.setUTCDate(cursor.getUTCDate()-1);
 }
 return n;
}
