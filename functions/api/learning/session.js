import {requireStudent,authResponse} from '../../_lib/auth.js';
import {ensureLearningProfile} from '../../_lib/learning-engine-v1.js';

export async function onRequestGet({request,env}){
 try{
  const student=await requireStudent(request,env);const u=new URL(request.url);
  const year=validYear(u.searchParams.get('year'))||student.current_year_group||'Y3';
  const requested=u.searchParams.get('targetGem');
  const profile=await ensureLearningProfile(env,student,requested==null?null:Number(requested));
  const targetGem=clamp(Number(profile.target_gem||55),5,95);
  const count=clamp(Number(u.searchParams.get('count')||12),5,20);
  const radius=clamp(Number(u.searchParams.get('radius')||24),12,45);

  let candidates=await getCandidates(env,year,student.id,targetGem,radius,Math.min(90,count*7));
  if(candidates.length<count*2)candidates=await getCandidates(env,year,student.id,targetGem,45,120);
  const selected=selectBalanced(candidates,count);

  return Response.json({
   year,targetGem,version:'learning-engine-v1',ability_confidence:Number(profile.ability_confidence||0.2),
   results:selected.map(normalise),selection_policy:'due → fragile → learning → unseen → secure → mastered; then Gem proximity'
  },{headers:{'Cache-Control':'no-store'}});
 }catch(err){return authResponse(err)}
}

async function getCandidates(env,year,studentId,target,radius,limit){
 const min=Math.max(1,target-radius),max=Math.min(100,target+radius);
 const {results}=await env.DB.prepare(`
  SELECT w.id,w.lemma,w.part_of_speech AS stored_pos,wl.year_group,wl.percentile_band,wl.gem_score,wl.difficulty,
   cc.canonical_definition,cc.canonical_pos,cc.synonyms_json,cc.antonyms_json,cc.examples_json,cc.misconception_distractors_json,cc.content_status,
   COALESCE(m.status,'new') AS mastery_status,COALESCE(m.composite_mastery,0) AS composite_mastery,m.due_at,m.last_seen_at,
   COALESCE(m.context_score,0) AS context_score,COALESCE(m.production_score,0) AS production_score,COALESCE(m.transfer_score,0) AS transfer_score,
   COALESCE(m.exposures,0) AS learning_exposures
  FROM word_levels wl JOIN words w ON w.id=wl.word_id
  JOIN curriculum_content cc ON cc.word_id=w.id AND cc.year_group=wl.year_group
  LEFT JOIN student_word_mastery_v1 m ON m.student_id=? AND m.word_id=w.id
  WHERE wl.year_group=? AND wl.active=1 AND wl.gem_score BETWEEN ? AND ? AND cc.content_status='curated'
  ORDER BY
   CASE WHEN m.due_at IS NOT NULL AND m.due_at<=CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
   CASE COALESCE(m.status,'new') WHEN 'fragile' THEN 0 WHEN 'learning' THEN 1 WHEN 'new' THEN 2 WHEN 'secure' THEN 3 WHEN 'mastered' THEN 4 ELSE 5 END,
   COALESCE(m.composite_mastery,0) ASC,
   ABS(wl.gem_score-?) ASC,RANDOM()
  LIMIT ?
 `).bind(studentId,year,min,max,target,limit).all();
 return results;
}

function selectBalanced(rows,count){
 const due=shuffle(rows.filter(x=>x.due_at&&new Date(x.due_at)<=new Date()));
 const fragile=shuffle(rows.filter(x=>x.mastery_status==='fragile'));
 const learning=shuffle(rows.filter(x=>x.mastery_status==='learning'));
 const unseen=shuffle(rows.filter(x=>x.mastery_status==='new'||!x.learning_exposures));
 const secure=shuffle(rows.filter(x=>x.mastery_status==='secure'));
 const mastered=shuffle(rows.filter(x=>x.mastery_status==='mastered'));
 const out=[];const seen=new Set();
 const quotas=[
  [due,Math.ceil(count*0.30)],[fragile,Math.ceil(count*0.22)],[learning,Math.ceil(count*0.20)],
  [unseen,Math.ceil(count*0.22)],[secure,Math.ceil(count*0.10)],[mastered,Math.ceil(count*0.06)]
 ];
 for(const [pool,q] of quotas){let n=0;for(const x of pool){if(out.length>=count||n>=q)break;if(seen.has(x.id))continue;seen.add(x.id);out.push(x);n++}}
 for(const x of rows){if(out.length>=count)break;if(!seen.has(x.id)){seen.add(x.id);out.push(x)}}
 return out.slice(0,count);
}

function normalise(w){return{
 ...w,definition:w.canonical_definition,part_of_speech:w.canonical_pos||w.stored_pos||null,
 synonyms:parse(w.synonyms_json),antonyms:parse(w.antonyms_json),examples:parse(w.examples_json),
 misconception_distractors:parse(w.misconception_distractors_json),content_status:w.content_status||'curated'
}}
function parse(v){try{return v?JSON.parse(v):[]}catch{return[]}}
function shuffle(a){return[...a].sort(()=>Math.random()-.5)}
function validYear(v){v=String(v||'').toUpperCase();return['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(v)?v:null}
function clamp(n,min,max){return Math.max(min,Math.min(max,Number.isFinite(n)?Math.round(n):min))}
