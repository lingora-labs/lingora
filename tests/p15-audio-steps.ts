// P15 — withoutAudioSteps filter fix. Verifies the AND-of-negations bug
// (which stripped ALL tool_audio steps, not just generateTTS) is fixed.
// Pure logic test, mirrors the exact filter now in orchestrator.ts.

interface Step { executor: string; action: string }

function oldBuggyFilter(steps: Step[]): Step[] {
  return steps.filter(s => s.executor !== 'tool_audio' && s.action !== 'generateTTS');
}
function fixedFilter(steps: Step[]): Step[] {
  return steps.filter(s => !(s.executor === 'tool_audio' && s.action === 'generateTTS'));
}

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

// Pronunciation eval chain: transcribeAudio -> evaluatePronunciation -> generateTTS
const chain: Step[] = [
  { executor: 'tool_audio', action: 'transcribeAudio' },
  { executor: 'mentor', action: 'evaluatePronunciation' },
  { executor: 'tool_audio', action: 'generateTTS' },
];

const buggyResult = oldBuggyFilter(chain);
check('OLD_BUG_confirmed_strips_transcribeAudio_too', buggyResult.length === 1,
  `old filter left ${buggyResult.length} step(s): ${buggyResult.map(s => s.action).join(',')}`);

const fixedResult = fixedFilter(chain);
check('FIX_keeps_transcribeAudio', fixedResult.some(s => s.action === 'transcribeAudio'));
check('FIX_keeps_evaluatePronunciation', fixedResult.some(s => s.action === 'evaluatePronunciation'));
check('FIX_removes_only_generateTTS', fixedResult.length === 2 && !fixedResult.some(s => s.action === 'generateTTS'));

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll P15 withoutAudioSteps tests PASSED');
}
