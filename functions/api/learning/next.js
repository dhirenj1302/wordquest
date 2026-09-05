import {requireStudent,authResponse} from '../../_lib/auth.js';
import {ensureLearningProfile} from '../../_lib/learning-engine-v1.js';

export async function onRequestGet({request,env}){
 try{
  const student=await requireStudent(request,env);const u=new URL(request.url);
  const year=validYear(u.searchParams.get('year'))||student.current_year_group||'Y4';
  const profile=await ensureLearningProfile(env,student,null);const target=Number(profile.target_gem||55);
  const word=await chooseWord(env,student.id,year,target);
  if(!word)return Response.json({error:'no_word_available'},{status:404});
  const pool=await distractorPool(env,year,word.id,word.canonical_pos||word.stored_pos,target);
  const question=planQuestion(word,pool);
  return Response.json({version:'learning-engine-v1',target_gem:target,word:normalise(word),question},{headers:{'Cache-Control':'no-store'}});
 }catch(err){return authResponse(err)}
}

async function chooseWord(env,studentId,year,target){
 return env.DB.prepare(`
  SELECT w.id,w.lemma,w.part_of_speech AS stored_pos,wl.year_group,wl.gem_score,cc.canonical_definition,cc.canonical_pos,cc.synonyms_json,cc.antonyms_json,cc.examples_json,cc.misconception_distractors_json,
   COALESCE(m.status,'new') AS status,COALESCE(m.composite_mastery,0) AS composite_mastery,COALESCE(m.recognition_score,0) AS recognition_score,COALESCE(m.context_score,0) AS context_score,COALESCE(m.production_score,0) AS production_score,COALESCE(m.morphology_score,0) AS morphology_score,COALESCE(m.transfer_score,0) AS transfer_score,COALESCE(m.exposures,0) AS exposures,m.due_at,
   lu.context_examples_json,lu.collocations_json,lu.usage_frames_json,lu.morphology_json,lu.register_note,lu.nuance_note
  FROM word_levels wl JOIN words w ON w.id=wl.word_id JOIN curriculum_content cc ON cc.word_id=w.id AND cc.year_group=wl.year_group
  LEFT JOIN student_word_mastery_v1 m ON m.student_id=? AND m.word_id=w.id
  LEFT JOIN lexical_usage_v1 lu ON lu.word_id=w.id AND lu.year_group=wl.year_group
  WHERE wl.year_group=? AND wl.active=1 AND cc.content_status='curated' AND wl.gem_score BETWEEN ? AND ?
  ORDER BY CASE WHEN m.due_at IS NOT NULL AND m.due_at<=CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
   CASE COALESCE(m.status,'new') WHEN 'fragile' THEN 0 WHEN 'learning' THEN 1 WHEN 'new' THEN 2 WHEN 'secure' THEN 3 WHEN 'mastered' THEN 4 END,
   CASE WHEN COALESCE(m.context_score,0)<0.55 THEN 0 WHEN COALESCE(m.production_score,0)<0.65 THEN 1 WHEN COALESCE(m.transfer_score,0)<0.60 THEN 2 ELSE 3 END,
   ABS(wl.gem_score-?) ASC,RANDOM() LIMIT 1
 `).bind(studentId,year,Math.max(1,target-24),Math.min(100,target+24),target).first();
}

async function distractorPool(env,year,wordId,pos,target){
 const {results}=await env.DB.prepare(`SELECT w.id,w.lemma,wl.gem_score,cc.canonical_definition,cc.canonical_pos,cc.examples_json FROM word_levels wl JOIN words w ON w.id=wl.word_id JOIN curriculum_content cc ON cc.word_id=w.id AND cc.year_group=wl.year_group WHERE wl.year_group=? AND wl.active=1 AND w.id<>? AND cc.content_status='curated' ORDER BY CASE WHEN cc.canonical_pos=? THEN 0 ELSE 1 END,ABS(wl.gem_score-?) ASC,RANDOM() LIMIT 24`).bind(year,wordId,pos,target).all();
 return results;
}

function planQuestion(w,pool){
 const recognition=Number(w.recognition_score||0),context=Number(w.context_score||0),production=Number(w.production_score||0),morphology=Number(w.morphology_score||0),transfer=Number(w.transfer_score||0),exposures=Number(w.exposures||0);
 const examples=unique([...parse(w.context_examples_json),...parse(w.examples_json)]).filter(x=>String(x).length>=8);
 const morphologyData=parseObject(w.morphology_json);
 if(exposures<2||recognition<0.42)return recognitionQuestion(w,pool);
 if(context<0.58&&examples.length)return clozeQuestion(w,pool,examples[0]);
 if(production<0.65)return{type:'sentence_use',dimension:'production',response_mode:'free_text',prompt:`Write one natural sentence using “${w.lemma}” so that its meaning is clear from the context.`,word_id:w.id,gem_score:w.gem_score,grading_endpoint:'/api/learning/production'};
 if(morphology<0.52&&Object.keys(morphologyData).length)return morphologyQuestion(w,morphologyData,pool);
 if(transfer<0.64&&examples.length)return situationQuestion(w,pool,examples[0]);
 return Math.random()<0.5?situationQuestion(w,pool,examples[0]||null):recognitionQuestion(w,pool);
}

function recognitionQuestion(w,pool){
 const defs=pool.map(x=>x.canonical_definition).filter(Boolean).slice(0,3);
 return{type:'meaning',dimension:'recognition',response_mode:'mcq',prompt:`What does “${w.lemma}” mean?`,options:shuffle([w.canonical_definition,...defs]).slice(0,4),correct_answer:w.canonical_definition,word_id:w.id,gem_score:w.gem_score};
}
function clozeQuestion(w,pool,example){
 const rx=new RegExp(`\\b${escapeRX(w.lemma)}\\b`,'i');
 if(!rx.test(example))return situationQuestion(w,pool,example);
 const stem=example.replace(rx,'_____');const choices=pool.filter(x=>samePos(w,x)).map(x=>x.lemma).filter(Boolean).slice(0,3);
 return{type:'cloze',dimension:'context',response_mode:'mcq',prompt:`Which word best completes this sentence?\n${stem}`,options:shuffle([w.lemma,...choices]).slice(0,4),correct_answer:w.lemma,word_id:w.id,gem_score:w.gem_score};
}
function situationQuestion(w,pool,correctExample){
 if(!correctExample)return recognitionQuestion(w,pool);
 const wrong=pool.map(x=>parse(x.examples_json)[0]).filter(Boolean).slice(0,3);
 if(wrong.length<3)return recognitionQuestion(w,pool);
 return{type:'novel_context',dimension:'transfer',response_mode:'mcq',prompt:`Which situation best shows the meaning of “${w.lemma}”?`,options:shuffle([correctExample,...wrong]),correct_answer:correctExample,word_id:w.id,gem_score:w.gem_score};
}
function morphologyQuestion(w,data,pool){
 const family=unique([...(data.family||[]),...(data.derivatives||[])]).filter(x=>x&&String(x).toLowerCase()!==String(w.lemma).toLowerCase());
 if(!family.length)return recognitionQuestion(w,pool);
 const correct=family[0];const wrong=pool.map(x=>x.lemma).filter(Boolean).slice(0,3);
 return{type:'word_family',dimension:'morphology',response_mode:'mcq',prompt:`Which word belongs to the same word family as “${w.lemma}”?`,options:shuffle([correct,...wrong]).slice(0,4),correct_answer:correct,word_id:w.id,gem_score:w.gem_score};
}
function normalise(w){return{id:w.id,lemma:w.lemma,year_group:w.year_group,gem_score:w.gem_score,status:w.status,mastery:Number(w.composite_mastery||0),recognition:Number(w.recognition_score||0),context:Number(w.context_score||0),production:Number(w.production_score||0),morphology:Number(w.morphology_score||0),transfer:Number(w.transfer_score||0),definition:w.canonical_definition,part_of_speech:w.canonical_pos||w.stored_pos}}
function samePos(a,b){return String(a.canonical_pos||a.stored_pos||'').toLowerCase()===String(b.canonical_pos||'').toLowerCase()}
function parse(v){try{const x=v?JSON.parse(v):[];return Array.isArray(x)?x:[]}catch{return[]}}
function parseObject(v){try{const x=v?JSON.parse(v):{};return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}catch{return{}}}
function unique(a){return[...new Set(a.map(x=>String(x).trim()).filter(Boolean))]}
function shuffle(a){return[...a].sort(()=>Math.random()-.5)}
function escapeRX(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function validYear(v){v=String(v||'').toUpperCase();return['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(v)?v:null}
