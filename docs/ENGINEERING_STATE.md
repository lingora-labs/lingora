# LINGORA — ENGINEERING STATE

CURRENT HEAD: 3ec47d16b5324123a808e1156b84c1576abf9891
CURRENT DEPLOY: seek-4.1c2-3ec47d16

## CERTIFIED / FROZEN — do not reopen without demonstrated regression

- Tutor Core authority (single decision-maker, no multi-brain)
- WILLY FREE
- mentor-first / intent-first routing
- ContextPack semantics
- STT → Tutor Core (route.ts, centralized, pre-intent-classification)
- Voice-turn TTS transport (streaming + blocking path parity)
- Text↔voice continuity (same session, same state, same mentor)
- N→N artifacts (P10b)
- PDF integrity — table/key_value wrap, no truncation (P12-A/B)
- Artifact taxonomy — lesson/study_guide/course/worksheet/reference/
  assessment/learning_plan (P13-B), "Nivel de español" metadata (P13-C)
- Artifact failure truth — streaming (P14-C) and blocking (P16 closure),
  same `artifactFailures` shape/consumer in both paths
- Pronunciation path (transcribeAudio → evaluatePronunciation → generateTTS)
  — dependency chain fixed by the withoutAudioSteps filter fix (P15);
  preserved by inspection, not re-verified live in P16 closure

## OPEN EXTERNAL GATE

- Physical/browser voice certification: real microphone, real playback,
  real autoplay behavior on an actual device. Backend evidence (STT/TTS
  roundtrip, multi-turn continuity, blocking-path parity) is complete;
  human ear + browser gate is outside DAE's reach in this environment.

## KNOWN NON-BLOCKING DEBT (P1/P2 — does not block commercialization)

- Advanced pronunciation improvements (real-time phonetic analysis)
- Rich visual chat (beyond current artifact rendering)
- BRAND-SCOPE-01 (cover page says "AI Cultural Immersion Platform for
  Spanish" even on non-Spanish-subject artifacts — constitutional,
  requires Manifiesto → Architecture path)
- Audio capability ambiguity: response to explicit audio requests is
  sometimes worded ambiguously ("te preparo la versión para leer en voz
  alta") instead of a clear accept/decline
- P12-C: historical paragraph-truncation defect, never reproduced under
  controlled conditions — kept as observed backlog, not an open incident
- Conceptual future separation: VoiceTurnOutput (conversational) vs
  AudioArtifact (deliberate pedagogical asset) currently share the same
  `type: 'audio'` transport shape. Stable for now; a cleaner split is a
  post-commercial refactor, not a correctness issue today.

## DO NOT REOPEN

Certified/frozen layers above, absent new evidence of a real regression.

## NEXT PRODUCT FRONT

M01 — COMMERCIALIZATION. Not another P-numbered engineering front.
