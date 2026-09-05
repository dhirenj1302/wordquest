# WordQuest Learning Engine v1

## Product objective

WordQuest should not equate recognising a definition with knowing a word. The product objective is **usable, retained vocabulary knowledge** that transfers to unfamiliar English and verbal-reasoning contexts, while keeping teacher workload very low.

For 11+ preparation this matters because the ISEB framework assesses vocabulary through word meaning, definitions, word families, prefixes/suffixes, and explaining word meaning in context. It also describes the tests as adaptive and requires pupils to apply knowledge to unfamiliar material.

## Evidence base used for v1

1. **Spacing + retrieval practice** — Carpenter, Pan & Butler (2022), *Nature Reviews Psychology*, DOI 10.1038/s44159-022-00089-1. Retrieval strengthens later retrieval; spacing is important for retention. WordQuest therefore gives more weight to successful delayed retrieval than immediate repetition and schedules weak words sooner.
2. **Classroom retrieval practice** — Agarwal, Nunes & Blunt (2021), *Educational Psychology Review*, DOI 10.1007/s10648-021-09595-9. Review of 50 classroom experiments found robust learning benefits across settings. WordQuest treats questions as evidence events, not merely scores.
3. **Primary vocabulary retrieval** — Karpicke-style retrieval findings are reflected in primary-school vocabulary studies where retrieval can outperform restudy on delayed cued-recall outcomes. WordQuest therefore requires active retrieval rather than repeated exposure alone.
4. **Contextual diversity** — Rosa, Salom & Perea (2022), *Journal of Experimental Child Psychology*, DOI 10.1016/j.jecp.2021.105312. Children learned words better when the same meaning appeared across different contexts. WordQuest therefore separates context and transfer mastery and will expose words in non-redundant situations.
5. **Morphological knowledge** — Colenbrander et al. (2024), *Educational Psychology Review*, DOI 10.1007/s10648-024-09953-3. Morphological instruction has positive effects on reading/spelling, especially directly trained words. WordQuest therefore tracks morphology separately rather than treating it as a synonym task.
6. **ISEB Common Pre-Tests framework** — vocabulary includes word meaning, word families, prefixes and suffixes; reading comprehension includes explaining word meaning in context; VR assesses vocabulary/definitions and reasoning. ISEB also states that the tests are adaptive.

The engine deliberately does **not** claim that any one task or algorithm is proven to maximise 11+ scores. It combines well-supported learning principles with the actual vocabulary demands described by ISEB.

## Five evidence dimensions

Every answer contributes to one dimension:

| Dimension | What it means | Example tasks |
|---|---|---|
| Recognition | Can recognise the core meaning | meaning MCQ, synonym, antonym, word-from-definition |
| Context | Can infer/select the word in a sentence | cloze, contextual meaning, shade/precision |
| Production | Can use the word meaningfully | write a sentence, explain in own words, rewrite |
| Morphology | Understands word family/structure | word family, prefix/suffix, derivative selection |
| Transfer | Can recognise correct use in a novel situation | scenario matching, analogy, collocation, unfamiliar context |

Weighting in v1: recognition 18%, context 25%, production 27%, morphology 10%, transfer 20%.

Recognition is intentionally the lowest-weighted dimension. A pupil cannot become `mastered` through MCQ definition recognition alone.

## Mastery states

- `new` — no evidence yet.
- `learning` — early evidence; insufficient breadth.
- `fragile` — repeated evidence suggests uncertainty or recent failure.
- `secure` — good knowledge across multiple task types, especially context.
- `mastered` — high composite score **plus** context, production and transfer thresholds, four or more question types, and at least two delayed successful retrievals.

Current v1 mastered gate:

- composite mastery >= 0.78
- context >= 0.70
- production >= 0.65
- transfer >= 0.60
- at least 4 question types
- at least 2 delayed successful retrievals

This is intentionally demanding. `Secure` is sufficient for many ordinary classroom purposes; `Mastered` means WordQuest has evidence of retained and usable knowledge.

## Evidence weighting

Evidence is not binary-only.

- Production and transfer evidence is weighted above definition recognition.
- Hints reduce evidence strength.
- Delayed successful retrieval increases evidence strength.
- Very fast answers are slightly discounted because guessing/automatic recognition provides weaker evidence of deep knowledge.
- Incorrect answers reduce the relevant dimension and bring the item forward for review.
- AI-scored sentence use supplies a continuous production score rather than merely pass/fail.

## Spaced review

Initial v1 schedule:

- wrong: review in 1 day
- correct with hints: 2 days
- fragile: about 2 days
- learning: 3–7 days
- secure: 7–21 days
- mastered: 21–45 days

The engine gives overdue items explicit priority in future sessions.

## Adaptive challenge

Gem challenge becomes persistent server-side learner state rather than only browser state.

- clean correct answer: target Gem rises moderately
- wrong answer: target Gem falls more quickly
- hinted correct answer: small rise
- production/transfer evidence can move the estimate more than simple recognition
- response time moderates the step size

The backend session selector prioritises:

1. overdue words
2. fragile words
3. learning words
4. unseen words
5. secure words
6. mastered words

within an appropriate Gem band.

## Deep-mastery question planner

`/api/learning/next` chooses the next task based on the pupil's **weakest evidence dimension**, not random question type alone.

Typical progression for a word:

1. recognise its core meaning
2. retrieve/select it from sentence context
3. use it in a self-generated sentence
4. solve morphology/word-family tasks where appropriate
5. transfer it to a different scenario/context
6. retrieve it again after a delay

The system should vary contexts rather than repeatedly showing the same sentence.

## Productive-use grading

`/api/learning/production` grades a pupil-written sentence against:

- semantic fit (50%)
- natural collocation/use (22%)
- grammar (13%)
- register/nuance (15%)

A correct grammatical sentence using the wrong sense must fail. Copying a supplied example is capped because it provides weak evidence of productive mastery.

The endpoint requires an OpenAI API key in the Cloudflare environment. The model supplies a rubric score and short pupil-facing feedback; the Learning Engine stores the evidence event.

## Teacher model

Commercial WordQuest should organise pupils beneath **teacher → class → student**.

The v1 schema adds:

- `teachers`
- `teacher_sessions`
- `classes`
- `class_students`

A teacher can therefore own multiple classes and a pupil can be attached to a class without changing the pupil's own persistent WordQuest login.

## Teacher workload principle

The teacher dashboard should answer three questions in under a minute:

1. **Who is not practising?**
2. **Who needs intervention?**
3. **What exactly do they need help with?**

Class dashboard metrics:

- pupils in class
- active pupils in last 7 days
- pupils requiring attention
- questions completed in last 30 days
- sessions per pupil
- current Gem target
- mastered / secure / fragile word counts
- words currently due for review
- automatic attention flag

Student drill-down:

- proficient words (`secure` + `mastered`)
- words needing work (`learning` + `fragile`)
- mastery by dimension: recognition, context, production, morphology, transfer
- exposure count and delayed successes
- recent sessions and accuracy
- last practice date

The dashboard intentionally surfaces exceptions rather than asking teachers to inspect raw attempt logs.

## Teacher attention rules in v1

High priority:

- no practice for 7+ days; or
- 8+ fragile words

Medium priority:

- 10+ words due for review; or
- fewer than 2 sessions in the last 7 days

Otherwise: `On track`.

These are product defaults, not validated educational cut-offs. They should become configurable after school pilots.

## Files added/changed in v1

- `migrations/0030_learning_engine_v1.sql`
- `functions/_lib/learning-engine-v1.js`
- `functions/_lib/teacher-auth.js`
- `functions/api/attempts.js`
- `functions/api/practice.js`
- `functions/api/session.js`
- `functions/api/learning/session.js`
- `functions/api/learning/next.js`
- `functions/api/learning/production.js`
- `functions/api/teacher/auth.js`
- `functions/api/teacher/classes.js`
- `functions/api/teacher/dashboard.js`
- `teacher.html`

## Before production merge

1. apply migration 0030 to a staging D1 database
2. set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`) for sentence-use grading
3. run synthetic learner simulations
4. run authenticated API smoke tests
5. test teacher creation, class creation, roster assignment and class dashboard
6. test sentence-production grading with adversarial examples (definition copied, wrong sense, nonsense, grammatical but semantically wrong)
7. populate `lexical_usage_v1` with curated diverse contexts, collocations, morphology and nuance for the advanced word bank
8. only then merge/deploy to production
