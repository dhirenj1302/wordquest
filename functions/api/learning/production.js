import {requireStudent,authResponse,authError} from '../../_lib/auth.js';
import {recordLearningEvidence} from '../../_lib/learning-engine-v1.js';

export async function onRequestPost({request,env}){
 try{
  const student=await requireStudent(request,env);const b=await request.json();
  const wordId=Number(b.word_id||0),year=String(b.year_group||student.current_year_group).toUpperCase();
  const sentence=String(b.sentence||'').trim().slice(0,500);const gem=Number(b.gem_score||55);
  if(!wordId||sentence.length<6)throw authError('word_id_and_sentence_required');
  const row=await env.DB.prepare(`SELECT w.lemma,cc.canonical_definition,cc.canonical_pos,cc.synonyms_json,cc.examples_json,cc.misconception_distractors_json FROM words w JOIN curriculum_content cc ON cc.word_id=w.id AND cc.year_group=? WHERE w.id=?`).bind(year,wordId).first();
  if(!row)throw authError('word_not_found',404);
  const rubric=await gradeUsage(env,{lemma:row.lemma,definition:row.canonical_definition,pos:row.canonical_pos,synonyms:parse(row.synonyms_json),examples:parse(row.examples_json),sentence});
  const correct=rubric.score>=0.70;
  const practiceSessionId=b.practice_session_id?Number(b.practice_session_id):null;
  if(practiceSessionId){const own=await env.DB.prepare(`SELECT id FROM practice_sessions WHERE id=? AND student_id=?`).bind(practiceSessionId,student.id).first();if(!own)throw authError('invalid_practice_session',403)}
  await env.DB.prepare(`INSERT INTO attempts(student_id,word_id,year_group,question_type,correct,hints_used,response_ms,gem_score_at_attempt,practice_session_id) VALUES(?,?,?,?,?,?,?,?,?)`).bind(student.id,wordId,year,'sentence_use',correct?1:0,Number(b.hints_used||0),b.response_ms?Number(b.response_ms):null,gem,practiceSessionId).run();
  const learning=await recordLearningEvidence(env,{student,wordId,yearGroup:year,questionType:'sentence_use',correct,hintsUsed:Number(b.hints_used||0),responseMs:b.response_ms?Number(b.response_ms):null,gemScore:gem,productionScore:rubric.score});
  return Response.json({ok:true,word:row.lemma,score:rubric.score,passed:correct,feedback:rubric.feedback,semantic_fit:rubric.semantic_fit,natural_usage:rubric.natural_usage,grammar:rubric.grammar,register_and_nuance:rubric.register_and_nuance,learning_engine_v1:learning});
 }catch(err){return authResponse(err)}
}

async function gradeUsage(env,x){
 if(!env.OPENAI_API_KEY)throw authError('openai_api_key_required_for_production_grading',503);
 const instructions=`You are a strict but encouraging UK primary-school vocabulary assessor. Judge whether a pupil has USED the target word naturally and correctly, not merely mentioned or defined it. Score semantic fit, natural collocation/usage, grammar, and register/nuance. A grammatically correct sentence with the wrong sense must score below 0.70. A sentence copied verbatim from the supplied example should not exceed 0.65 because it provides weak evidence of productive mastery. Return JSON only with: score (0 to 1), semantic_fit (0 to 1), natural_usage (0 to 1), grammar (0 to 1), register_and_nuance (0 to 1), feedback (one short child-friendly sentence).`;
 const input={target_word:x.lemma,definition:x.definition,part_of_speech:x.pos,synonyms:x.synonyms,known_examples:x.examples,pupil_sentence:x.sentence};
 const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_MODEL||'gpt-5.4-mini',instructions,input:JSON.stringify(input),text:{format:{type:'json_object'}}})});
 if(!res.ok)throw authError('production_grader_unavailable',503);
 const data=await res.json();const text=extractText(data);let j={};try{j=JSON.parse(text)}catch{throw authError('production_grader_invalid_response',503)}
 const semantic=clamp01(j.semantic_fit),natural=clamp01(j.natural_usage),grammar=clamp01(j.grammar),register=clamp01(j.register_and_nuance);
 const computed=0.50*semantic+0.22*natural+0.13*grammar+0.15*register;
 return{score:Math.round(Math.min(clamp01(j.score),computed)*100)/100,semantic_fit:semantic,natural_usage:natural,grammar,register_and_nuance:register,feedback:String(j.feedback||'').slice(0,180)};
}
function extractText(d){if(typeof d.output_text==='string')return d.output_text;for(const o of d.output||[])for(const c of o.content||[])if(typeof c.text==='string')return c.text;return''}
function parse(v){try{return v?JSON.parse(v):[]}catch{return[]}}
function clamp01(n){n=Number(n);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0}
