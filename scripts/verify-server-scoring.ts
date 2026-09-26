/**
 * verify-server-scoring.ts (2026-09-26)
 *
 * The browser used to receive every answer and explanation, score itself,
 * and post the score and the pass flag, which the server recorded for any
 * email in the body and turned into a CERTIFICATE on a final-exam pass.
 *
 *   A. The rule, RUN: what the browser sees of a question carries no answer
 *      and no explanation in any field name the source uses; scoring is by
 *      the option TEXT, so shuffled options score the same; an unknown
 *      question key is reported (the route refuses), never guessed; the key
 *      is revealed only once the final attempt is used.
 *   B. The questions route sends only the public shape, to the signed session.
 *   C. submit-assessment takes nothing about the result from the body: the
 *      student is the signed session, the score is computed here, the limit
 *      and pass mark and final flag are the server's, the limit is ENFORCED,
 *      the certificate follows the server's pass, a held result says only
 *      that, and the key goes out only when revealed.
 *   D. The page holds no key and computes no score; it shows which questions
 *      were wrong on every attempt, and the correct answer only when revealed.
 *
 * Run: npx tsx scripts/verify-server-scoring.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import {
  publicQuestion, scoreSubmission, revealAnswerKey, questionKey, type SourceQuestion,
} from '../src/hubs/training/lib/assessment/serverScoring';
import { maxAttemptsFor, resolveIsFinal } from '../src/hubs/training/lib/assessment/modelGateScope';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('=== A. The rule, RUN ===');
const SRC: SourceQuestion[] = [
  { questionId: 'Q1', q: 'Two plus two?', options: ['3', '4', '5'], correctIndex: 1, explanation: 'Arithmetic.' },
  { q: 'Capital of France?', options: ['Rome', 'Paris'], correctAnswer: 1, hint: 'Eiffel.' },
  { question: 'Largest planet?', options: ['Jupiter', 'Mars'], answer: '0', rationale: 'Gas giant.' },
];
const pub = SRC.map(publicQuestion);
const wire = JSON.stringify(pub);
check('A1 the browser shape carries no answer and no explanation, under any field name the source uses',
  !/correctIndex|correctAnswer|"answer"|explanation|hint|rationale|Arithmetic|Eiffel|Gas giant/.test(wire), wire);
check('A2 and it keeps what the page needs: a key, the text and every option', pub.every((p, i) => p.key && p.q && p.options.length === (SRC[i].options as string[]).length));
check('A3 a question with an id is keyed by the id, one without by its text', pub[0].key === 'id:Q1' && pub[1].key === 'q:capital of france?');
const all = scoreSubmission(SRC, [{ key: pub[0].key, choice: '4' }, { key: pub[1].key, choice: 'Paris' }, { key: pub[2].key, choice: 'Jupiter' }]);
check('A4 all right: 100, three correct', all.score === 100 && all.correctCount === 3 && all.unknownKeys.length === 0);
const some = scoreSubmission(SRC, [{ key: pub[0].key, choice: '3' }, { key: pub[1].key, choice: 'Paris' }]);
check('A5 one wrong, one unanswered: 33, and each outcome says which', some.score === 33 && some.unanswered === 1
  && some.outcomes.filter((o) => !o.isCorrect).map((o) => o.key).join() === [pub[0].key, pub[2].key].join());
check('A6 scoring is by option TEXT, so a shuffled order in the browser cannot change the result',
  scoreSubmission(SRC, [{ key: pub[0].key, choice: '4' }]).correctCount === 1);
const forged = scoreSubmission(SRC, [{ key: 'id:NOT-A-QUESTION', choice: 'x' }]);
check('A7 an answer for a question the source does not have is reported, never scored', forged.unknownKeys.length === 1 && forged.correctCount === 0);
check('A8 a choice that is not one of the options scores nothing', scoreSubmission(SRC, [{ key: pub[0].key, choice: '4 ' + 'x' }]).correctCount === 0);
check('A9 the key is revealed only once the final attempt is used', !revealAnswerKey(1, 3) && !revealAnswerKey(2, 3) && revealAnswerKey(3, 3) && revealAnswerKey(1, 1));
check('A10 the attempt limit and final flag come from the course config', maxAttemptsFor('3SFM_S1') >= 1 && resolveIsFinal('3SFM_Final') === true && resolveIsFinal('3SFM_S1') === false);
check('A11 the key is stable across calls (the server can match what it sent)', questionKey(SRC[1]) === pub[1].key);

console.log('\n=== B. The questions route ===');
const qr = strip(src('app/api/training/questions/route.ts'));
check('B1 the student is the signed session, and the URL identity is not read', /getTrainingCookieSession\(\)/.test(qr) && !/searchParams\.get\('email'\)/.test(qr) && !/searchParams\.get\('regId'\)/.test(qr));
check('B2 only the public shape is sent (no spread of the raw question, no answer field)',
  /rawQs\.map\(publicQuestion\)/.test(qr) && !/\.\.\.q\b/.test(qr) && !/correctIndex|correctAnswer|explanation/.test(qr));

console.log('\n=== C. submit-assessment ===');
const sr = strip(src('app/api/training/submit-assessment/route.ts'));
const fromBody = ['score', 'passed', 'email', 'regId', 'isFinal', 'maxAttempts', 'passingScore', 'attemptNo', 'studentName'].filter((f) => new RegExp(`body\\.${f}\\b`).test(sr));
check('C1 nothing about the student or the result is read from the body', fromBody.length === 0, fromBody.join(', '));
check('C2 the student is the signed session', /const session = await getTrainingCookieSession\(\);/.test(sr) && /const cleanEmail = session\.email;/.test(sr));
check('C3 the score is computed on the server from re-read questions', /getAssessmentQuestions\(tabKey, cleanEmail, regId, false, isFinal\)/.test(sr) && /scoreSubmission\(source, answers\)/.test(sr));
check('C4 an unknown question key is refused, never guessed', /scored\.unknownKeys\.length > 0/.test(sr) && /questions_changed/.test(sr));
check('C5 final flag and attempt limit are the server\'s, and the limit is ENFORCED',
  /const isFinal = resolveIsFinal\(tabKey\);/.test(sr) && /const maxAtt = maxAttemptsFor\(tabKey\);/.test(sr)
  && /if \(used >= maxAtt\)/.test(sr) && /already_passed/.test(sr));
check('C6 the certificate follows the SERVER\'s pass', /const didPass = scored\.score >= passMark;/.test(sr) && /if \(didPass && isFinal && !finalResultHeld\)/.test(sr));
check('C7 a held final result returns only that', /if \(finalResultHeld\) \{\s*return NextResponse\.json\(\{ success: true, recorded: true, held: true, attempts: attempt, maxAttempts: maxAtt \}\);/.test(sr));
check('C8 the answer key goes out only when revealed', /review: reveal \?/.test(sr) && /const reveal = revealAnswerKey\(attempt, maxAtt\);/.test(sr));

console.log('\n=== D. The page ===');
const pg = strip(src('app/training/assessment/[tabKey]/page.tsx'));
check('D1 the page holds no answer key and computes no score',
  !/correctIndex/.test(pg) && !/Math\.round\(\(correctCount/.test(pg) && !/passed\s*=\s*score >= passScore/.test(pg));
check('D2 it sends only the tab and, per question, the key and the chosen option text',
  /body: JSON\.stringify\(\{ tabKey, answers: submitted \}\)/.test(pg) && /choice: picked >= 0 \? \(q\.options\[picked\] \?\? ''\) : ''/.test(pg));
check('D3 the review is shown on every attempt, not only on a pass', /\{Array\.isArray\(result\.results\) && result\.results\.length > 0 && \(/.test(pg) && !/\{passed && Array\.isArray\(result\.results\)/.test(pg));
check('D4 the correct answer is taken ONLY from the server\'s review', /const correct = r \? q\.options\.indexOf\(r\.correctText\) : -1;/.test(pg) && /correctText: r\?\.correctText \?\? ''/.test(pg));
check('D5 a held result shows nothing but that', /result\?\.held/.test(pg) && /released once your financial model has been reviewed and approved/.test(pg));
check('D6 a refused submission keeps the answers and does not auto-retry every second', /if \(remaining <= 0 && !submitFailedRef\.current\)/.test(pg));

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
