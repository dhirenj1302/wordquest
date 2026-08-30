const DICT_BASE='https://api.dictionaryapi.dev/api/v2/entries/en/';

export async function onRequestGet({request,env}){
 try{
  const u=new URL(request.url);
  const year=validYear(u.searchParams.get('year'))||'Y3';
  const studentId=Number(u.searchParams.get('student_id')||0);
  const targetGem=clamp(Number(u.searchParams.get('targetGem')||55),5,95);
  const count=clamp(Number(u.searchParams.get('count')||12),5,20);
  const radius=clamp(Number(u.searchParams.get('radius')||22),10,45);

  let candidates=await getCandidates(env,year,studentId,targetGem,radius,Math.min(60,count*5));
  if(candidates.length<count*2)candidates=await getCandidates(env,year,studentId,targetGem,45,80);

  const selected=spreadPick(candidates,count);
  const enriched=await Promise.all(selected.map(w=>ensureCurriculum(env,w)));
  const usable=enriched.filter(w=>goodDefinition(w.definition));

  return Response.json({
   year,targetGem,version:'4.0',
   results:usable.length>=Math.min(5,count)?usable:enriched,
   content_source:'WordQuest curriculum layer'
  },{headers:{'Cache-Control':'no-store'}});
 }catch(err){
  return Response.json({error:'session_failed',detail:String(err?.message||err)},{status:500});
 }
}

async function getCandidates(env,year,studentId,target,radius,limit){
 const min=Math.max(1,target-radius),max=Math.min(100,target+radius);
 const {results}=await env.DB.prepare(`
 SELECT w.id,w.lemma,w.part_of_speech AS stored_pos,
        wl.year_group,wl.percentile_band,wl.gem_score,wl.difficulty,
        COALESCE(sws.exposures,0) AS exposures,
        COALESCE(sws.mastery,0) AS mastery,sws.due_at,
        cc.canonical_definition,cc.canonical_pos,
        cc.synonyms_json AS cc_synonyms_json,
        cc.antonyms_json AS cc_antonyms_json,
        cc.examples_json AS cc_examples_json,
        cc.content_status
 FROM word_levels wl
 JOIN words w ON w.id=wl.word_id
 LEFT JOIN student_word_state sws
   ON sws.word_id=w.id AND sws.student_id=?
 LEFT JOIN curriculum_content cc
   ON cc.word_id=w.id AND cc.year_group=wl.year_group
 WHERE wl.year_group=? AND wl.active=1 AND wl.gem_score BETWEEN ? AND ?
 ORDER BY
   CASE WHEN sws.due_at IS NOT NULL AND sws.due_at<=CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
   CASE WHEN cc.content_status='curated' THEN 0 ELSE 1 END,
   COALESCE(sws.mastery,0) ASC,
   ABS(wl.gem_score-?) ASC,RANDOM()
 LIMIT ?
 `).bind(studentId||-1,year,min,max,target,limit).all();
 return results;
}

async function ensureCurriculum(env,w){
 if(goodDefinition(w.canonical_definition)){
  return {
   ...w,
   definition:w.canonical_definition,
   part_of_speech:w.canonical_pos||w.stored_pos||null,
   synonyms:parse(w.cc_synonyms_json),
   antonyms:parse(w.cc_antonyms_json),
   examples:parse(w.cc_examples_json),
   content_status:w.content_status||'curated'
  };
 }

 // Fallback for still-pending curriculum rows:
 // choose the first acceptable contemporary sense in source order.
 try{
  const res=await fetch(DICT_BASE+encodeURIComponent(w.lemma),{
   headers:{'User-Agent':'WordQuest/4.0 curriculum-fallback'}
  });
  if(!res.ok)return safeFallback(w);
  const data=await res.json();
  const lex=extractMainstreamSense(data,w.lemma);
  if(!lex.definition)return safeFallback(w);

  // Persist the selected sense into the curriculum layer so it is stable across sessions.
  await env.DB.prepare(`
   INSERT INTO curriculum_content(
    word_id,year_group,canonical_definition,canonical_pos,
    synonyms_json,antonyms_json,examples_json,
    content_status,source,content_version,updated_at
   ) VALUES(?,?,?,?,?,?,?,'auto-reviewed','dictionaryapi-mainstream',4,CURRENT_TIMESTAMP)
   ON CONFLICT(word_id,year_group) DO UPDATE SET
    canonical_definition=excluded.canonical_definition,
    canonical_pos=excluded.canonical_pos,
    synonyms_json=excluded.synonyms_json,
    antonyms_json=excluded.antonyms_json,
    examples_json=excluded.examples_json,
    content_status='auto-reviewed',
    source='dictionaryapi-mainstream',
    content_version=4,
    updated_at=CURRENT_TIMESTAMP
  `).bind(w.id,w.year_group,lex.definition,lex.part_of_speech,
          JSON.stringify(lex.synonyms),JSON.stringify(lex.antonyms),
          JSON.stringify(lex.examples)).run();

  return {...w,...lex,content_status:'auto-reviewed'};
 }catch{
  return safeFallback(w);
 }
}

function extractMainstreamSense(data,lemma){
 const entries=Array.isArray(data)?data:[];
 const candidates=[];
 let order=0;

 for(const entry of entries){
  for(const m of(entry.meanings||[])){
   const pos=m.partOfSpeech||null;
   for(const d of(m.definitions||[])){
    order++;
    const raw=String(d?.definition||'').trim();
    if(!raw)continue;
    if(rejectSense(raw))continue;
    const definition=simplify(raw,lemma);
    if(!goodDefinition(definition))continue;
    candidates.push({
     order,definition,pos,
     synonyms:cleanWords([...(m.synonyms||[]),...(d.synonyms||[])],lemma),
     antonyms:cleanWords([...(m.antonyms||[]),...(d.antonyms||[])],lemma),
     example:d.example?clean(d.example):null
    });
   }
  }
 }
 if(!candidates.length)return {definition:null,part_of_speech:null,synonyms:[],antonyms:[],examples:[]};

 // Source order is the strongest signal of mainstream sense.
 // We only use readability as a tie-breaker among the first few acceptable senses.
 const shortlist=candidates.slice(0,3);
 shortlist.sort((a,b)=>(a.order-b.order)||readability(b.definition)-readability(a.definition));
 const best=shortlist[0];

 return {
  definition:best.definition,
  part_of_speech:best.pos,
  synonyms:best.synonyms.slice(0,6),
  antonyms:best.antonyms.slice(0,6),
  examples:best.example?[best.example]:[]
 };
}

function rejectSense(raw){
 const x=raw.toLowerCase();
 return /\b(archaic|obsolete|dated|historical|grammar|linguistics|printing|typography|heraldry|law|legal|medicine|anatomy|botany|zoology|music|nautical|computing|mathematics)\b/.test(x)
   || x.includes('three degrees of comparison')
   || x.includes('past participle')
   || x.includes('present participle');
}

function simplify(raw,lemma){
 let s=clean(raw);
 s=s.replace(/^\([^)]*\)\s*/,'');
 s=s.replace(/\([^)]{1,70}\)/g,'');
 let parts=s.split(/\s*;\s*/).map(x=>x.trim()).filter(Boolean);
 if(parts.length>1){
  // Keep the first clear clause; do not reorder senses by "interesting" wording.
  const clear=parts.find(p=>p.length>=12&&p.length<=105&&!rejectSense(p));
  s=clear||parts[0];
 }
 if(s.length>120){
  const stop=s.search(/[.!?]/);
  if(stop>15&&stop<120)s=s.slice(0,stop);
 }
 if(s.length>120){
  const comma=s.indexOf(',');
  if(comma>20&&comma<105)s=s.slice(0,comma);
 }
 s=s.replace(/[.;:,]+$/,'').trim();
 if(/^[A-Z][a-z]/.test(s))s=s[0].toLowerCase()+s.slice(1);
 return s;
}

function readability(s){
 let n=0;
 if(s.length>=15&&s.length<=90)n+=4;
 if(!/[()]/.test(s))n+=2;
 if(/^(to |a |an |the |being |having )/i.test(s))n+=1;
 return n;
}
function safeFallback(w){
 return {...w,definition:null,part_of_speech:w.stored_pos||null,
  synonyms:[],antonyms:[],examples:[],content_status:'pending'};
}
function goodDefinition(s){
 if(!s)return false;
 const x=String(s).toLowerCase();
 return x.length>=8 && x.length<=150
   && !x.includes('a vocabulary word to learn and use accurately')
   && !x.includes('needs more context')
   && !x.includes('three degrees of comparison');
}
function cleanWords(a,lemma){
 return unique(a).map(x=>x.toLowerCase())
  .filter(x=>/^[a-z][a-z -]{1,28}$/i.test(x))
  .filter(x=>x!==String(lemma).toLowerCase())
  .slice(0,10);
}
function parse(v){try{return v?JSON.parse(v):[]}catch{return[]}}
function spreadPick(arr,count){
 const due=arr.filter(x=>x.due_at&&new Date(x.due_at)<=new Date());
 const unseen=arr.filter(x=>!x.exposures);
 const learning=arr.filter(x=>x.exposures&&x.mastery<0.6);
 const rest=arr.filter(x=>!due.includes(x)&&!unseen.includes(x)&&!learning.includes(x));
 return uniqueById([...shuffle(due),...shuffle(unseen),...shuffle(learning),...shuffle(rest)]).slice(0,count);
}
function uniqueById(a){const s=new Set();return a.filter(x=>!s.has(x.id)&&s.add(x.id))}
function unique(a){return[...new Set(a.map(x=>String(x).trim()).filter(Boolean))]}
function shuffle(a){return[...a].sort(()=>Math.random()-.5)}
function validYear(v){v=String(v||'').toUpperCase();return['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(v)?v:null}
function clamp(n,min,max){return Math.max(min,Math.min(max,Number.isFinite(n)?Math.round(n):min))}
function clean(s){return String(s).replace(/\s+/g,' ').trim()}
