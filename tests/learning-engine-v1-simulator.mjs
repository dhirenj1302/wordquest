import {masteryStatus,questionDimension} from '../functions/_lib/learning-engine-v1.js';

function assert(ok,msg){if(!ok)throw new Error(`FAIL: ${msg}`);console.log(`PASS: ${msg}`)}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function gemStep(current,{correct,hints=0,dimension='recognition',responseMs=5000,productionScore=null}){
 let delta=correct?1.25:-1.65;
 if(hints)delta*=0.45;
 if(['production','transfer'].includes(dimension))delta*=1.15;
 if(responseMs>25000)delta*=0.75;
 if(productionScore!=null)delta*=0.6+0.4*clamp(productionScore,0,1);
 return Math.round(clamp(current+delta,5,95)*10)/10;
}
function runPattern(pattern,repeats=1,start=55){let gem=start;for(let r=0;r<repeats;r++)for(const e of pattern)gem=gemStep(gem,e);return gem}

const strong=runPattern([
 {correct:true,dimension:'recognition'},{correct:true,dimension:'context'},{correct:true,dimension:'production',productionScore:.9},{correct:true,dimension:'transfer'}
],8);
const struggling=runPattern([{correct:false},{correct:false},{correct:true,hints:2},{correct:false}],8);
const inconsistent=runPattern([{correct:true},{correct:false},{correct:true,dimension:'context'},{correct:false},{correct:true,hints:1}],6);

console.log({strong,struggling,inconsistent});
assert(strong>80,'strong synthetic learner moves to high Gem challenge');
assert(struggling<35,'struggling synthetic learner is brought down to a safer Gem range');
assert(inconsistent>35&&inconsistent<75,'inconsistent learner remains in a moderate challenge band');

const recognitionOnly={exposures:20,composite_mastery:.90,recognition_score:.95,context_score:.10,production_score:0,morphology_score:0,transfer_score:.10,distinct_question_types:4,delayed_successes:4};
assert(masteryStatus(recognitionOnly)!=='mastered','definition recognition alone cannot produce Mastered status');

const deep={exposures:20,composite_mastery:.82,recognition_score:.86,context_score:.79,production_score:.72,morphology_score:.60,transfer_score:.69,distinct_question_types:5,delayed_successes:3};
assert(masteryStatus(deep)==='mastered','deep mixed evidence plus delayed retrieval can produce Mastered status');

const fragile={exposures:6,composite_mastery:.34,recognition_score:.5,context_score:.2,production_score:.1,morphology_score:0,transfer_score:.1,distinct_question_types:3,delayed_successes:0};
assert(masteryStatus(fragile)==='fragile','weak multi-exposure knowledge is classified Fragile');

assert(questionDimension('cloze')==='context','cloze contributes contextual evidence');
assert(questionDimension('sentence_use')==='production','sentence use contributes productive evidence');
assert(questionDimension('novel_context')==='transfer','novel context contributes transfer evidence');

console.log('\nLearning Engine v1 simulator checks completed.');
