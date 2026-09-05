const DIMENSION_WEIGHTS={recognition:0.18,context:0.25,production:0.27,morphology:0.10,transfer:0.20};

export function questionDimension(type){
 const t=String(type||'').toLowerCase();
 if(['meaning','word_from_definition','synonym','antonym'].includes(t))return'recognition';
 if(['context','context_choice','cloze','usage_fit','shade','precision'].includes(t))return'context';
 if(['sentence_use','sentence_generation','define_in_own_words','rewrite','production'].includes(t))return'production';
 if(['morphology','word_family','prefix_suffix'].includes(t))return'morphology';
 if(['transfer','analogy','relationship','collocation','novel_context'].includes(t))return'transfer';
 return'recognition';
}

export async function ensureLearningProfile(env,student,requestedGem=null){
 let row=await env.DB.prepare(`SELECT * FROM student_learning_profile_v1 WHERE student_id=?`).bind(student.id).first();
 if(!row){
  const start=clamp(requestedGem==null?55:Number(requestedGem),5,95);
  await env.DB.prepare(`INSERT INTO student_learning_profile_v1(student_id,target_year_group,target_gem) VALUES(?,?,?)`)
   .bind(student.id,student.current_year_group,start).run();
  row=await env.DB.prepare(`SELECT * FROM student_learning_profile_v1 WHERE student_id=?`).bind(student.id).first();
 }
 return row;
}

export async function recordLearningEvidence(env,{student,wordId,yearGroup,questionType,correct,hintsUsed=0,responseMs=null,gemScore,productionScore=null}){
 const profile=await ensureLearningProfile(env,student,gemScore);
 const prior=await env.DB.prepare(`SELECT * FROM student_word_mastery_v1 WHERE student_id=? AND word_id=?`).bind(student.id,wordId).first();
 const dimension=questionDimension(questionType);
 const now=Date.now();
 const lastSeen=prior?.last_seen_at?Date.parse(prior.last_seen_at):null;
 const daysSince=lastSeen?Math.max(0,(now-lastSeen)/86400000):null;
 const delayed=Boolean(correct && daysSince!=null && daysSince>=2);
 const weight=evidenceWeight({dimension,correct,hintsUsed,responseMs,delayed,productionScore});

 const state=prior||blankState(student.id,wordId,yearGroup);
 const next=applyEvidence(state,{dimension,correct:Boolean(correct),hintsUsed,responseMs,weight,delayed,productionScore,questionType});
 const interval=nextInterval(next,{correct:Boolean(correct),hintsUsed});
 next.retention_interval_days=interval;
 next.due_modifier=`+${interval} days`;

 await env.DB.batch([
  env.DB.prepare(`INSERT INTO learning_evidence_v1(student_id,word_id,year_group,question_type,dimension,correct,hints_used,response_ms,gem_score,evidence_weight,production_score,was_delayed_retrieval) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(student.id,wordId,yearGroup,questionType,correct?1:0,Number(hintsUsed||0),responseMs==null?null:Number(responseMs),Number(gemScore),weight,productionScore==null?null:Number(productionScore),delayed?1:0),
  env.DB.prepare(`INSERT INTO student_word_mastery_v1(student_id,word_id,year_group,status,composite_mastery,recognition_score,context_score,production_score,morphology_score,transfer_score,exposures,correct_count,incorrect_count,hinted_correct_count,distinct_question_types,delayed_successes,consecutive_correct,consecutive_wrong,last_question_type,last_correct_at,last_incorrect_at,last_seen_at,due_at,retention_interval_days,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP,datetime('now',?),?,CURRENT_TIMESTAMP)
   ON CONFLICT(student_id,word_id) DO UPDATE SET
    year_group=excluded.year_group,status=excluded.status,composite_mastery=excluded.composite_mastery,
    recognition_score=excluded.recognition_score,context_score=excluded.context_score,production_score=excluded.production_score,morphology_score=excluded.morphology_score,transfer_score=excluded.transfer_score,
    exposures=excluded.exposures,correct_count=excluded.correct_count,incorrect_count=excluded.incorrect_count,hinted_correct_count=excluded.hinted_correct_count,
    distinct_question_types=excluded.distinct_question_types,delayed_successes=excluded.delayed_successes,consecutive_correct=excluded.consecutive_correct,consecutive_wrong=excluded.consecutive_wrong,
    last_question_type=excluded.last_question_type,
    last_correct_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE student_word_mastery_v1.last_correct_at END,
    last_incorrect_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE student_word_mastery_v1.last_incorrect_at END,
    last_seen_at=CURRENT_TIMESTAMP,due_at=excluded.due_at,retention_interval_days=excluded.retention_interval_days,updated_at=CURRENT_TIMESTAMP`)
   .bind(student.id,wordId,yearGroup,next.status,next.composite_mastery,next.recognition_score,next.context_score,next.production_score,next.morphology_score,next.transfer_score,next.exposures,next.correct_count,next.incorrect_count,next.hinted_correct_count,next.distinct_question_types,next.delayed_successes,next.consecutive_correct,next.consecutive_wrong,questionType,correct?1:0,correct?0:1,next.due_modifier,interval,correct?1:0,correct?0:1)
 ]);

 const newGem=updatedGem(Number(profile.target_gem||55),{correct:Boolean(correct),hintsUsed,dimension,responseMs,productionScore});
 const confidence=clamp(Number(profile.ability_confidence||0.2)+0.012,0.2,0.95);
 await env.DB.prepare(`UPDATE student_learning_profile_v1 SET target_gem=?,ability_confidence=?,questions_answered=questions_answered+1,last_practice_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE student_id=?`)
  .bind(newGem,confidence,student.id).run();

 return {...next,target_gem:newGem,ability_confidence:confidence,dimension,evidence_weight:weight,was_delayed_retrieval:delayed};
}

export function masteryStatus(s){
 if(!s.exposures)return'new';
 if(s.exposures<3)return'learning';
 if(s.composite_mastery<0.50)return'fragile';
 const varied=s.distinct_question_types>=3;
 const contextReady=s.context_score>=0.52;
 if(s.composite_mastery>=0.62&&varied&&contextReady){
  const trulyMastered=s.composite_mastery>=0.78&&s.context_score>=0.70&&s.production_score>=0.65&&s.transfer_score>=0.60&&s.delayed_successes>=2&&s.distinct_question_types>=4;
  return trulyMastered?'mastered':'secure';
 }
 return'learning';
}

function blankState(studentId,wordId,yearGroup){return{student_id:studentId,word_id:wordId,year_group:yearGroup,status:'new',composite_mastery:0,recognition_score:0,context_score:0,production_score:0,morphology_score:0,transfer_score:0,exposures:0,correct_count:0,incorrect_count:0,hinted_correct_count:0,distinct_question_types:0,delayed_successes:0,consecutive_correct:0,consecutive_wrong:0,last_question_type:null,retention_interval_days:0}}

function applyEvidence(s,e){
 const n={...s};
 n.exposures=Number(s.exposures||0)+1;
 n.correct_count=Number(s.correct_count||0)+(e.correct?1:0);
 n.incorrect_count=Number(s.incorrect_count||0)+(e.correct?0:1);
 n.hinted_correct_count=Number(s.hinted_correct_count||0)+(e.correct&&e.hintsUsed?1:0);
 n.delayed_successes=Number(s.delayed_successes||0)+(e.delayed?1:0);
 n.consecutive_correct=e.correct?Number(s.consecutive_correct||0)+1:0;
 n.consecutive_wrong=e.correct?0:Number(s.consecutive_wrong||0)+1;
 n.distinct_question_types=Number(s.distinct_question_types||0)+(s.last_question_type&&s.last_question_type!==e.questionType?1:(s.last_question_type?0:1));
 const field=`${e.dimension}_score`;
 const old=Number(s[field]||0);
 const outcome=e.productionScore!=null?clamp(Number(e.productionScore),0,1):(e.correct?1:0);
 const alpha=e.correct?0.28:0.34;
 n[field]=clamp(old+(outcome-old)*alpha*e.weight,0,1);
 n.composite_mastery=composite(n);
 n.status=masteryStatus(n);
 return n;
}

function composite(s){
 let weighted=0;
 for(const [d,w] of Object.entries(DIMENSION_WEIGHTS))weighted+=Number(s[`${d}_score`]||0)*w;
 const breadth=[s.recognition_score,s.context_score,s.production_score,s.morphology_score,s.transfer_score].filter(x=>Number(x)>=0.45).length;
 const breadthBonus=Math.min(0.08,breadth*0.016);
 const retentionBonus=Math.min(0.08,Number(s.delayed_successes||0)*0.025);
 return clamp(weighted+breadthBonus+retentionBonus,0,1);
}

function evidenceWeight({dimension,correct,hintsUsed,responseMs,delayed,productionScore}){
 let w={recognition:0.78,context:0.95,production:1.18,morphology:0.95,transfer:1.10}[dimension]||0.8;
 if(hintsUsed)w*=Math.max(0.45,1-0.18*Number(hintsUsed));
 if(delayed)w*=1.16;
 if(responseMs!=null&&responseMs<1800)w*=0.92;
 if(productionScore!=null)w*=0.9+0.2*clamp(Number(productionScore),0,1);
 if(!correct)w*=1.08;
 return Math.round(w*1000)/1000;
}

function nextInterval(s,{correct,hintsUsed}){
 if(!correct)return 1;
 if(hintsUsed)return 2;
 if(s.status==='mastered')return Math.min(45,Math.max(21,Number(s.retention_interval_days||0)*1.8||21));
 if(s.status==='secure')return Math.min(21,Math.max(7,Number(s.retention_interval_days||0)*1.6||7));
 if(s.status==='fragile')return 2;
 return Math.min(7,Math.max(3,Number(s.retention_interval_days||0)*1.5||3));
}

function updatedGem(current,{correct,hintsUsed,dimension,responseMs,productionScore}){
 let delta=correct?1.25:-1.65;
 if(hintsUsed)delta*=0.45;
 if(['production','transfer'].includes(dimension))delta*=1.15;
 if(responseMs!=null&&responseMs>25000)delta*=0.75;
 if(productionScore!=null)delta*=0.6+0.4*clamp(Number(productionScore),0,1);
 return Math.round(clamp(current+delta,5,95)*10)/10;
}

function clamp(n,a,b){return Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):a))}
