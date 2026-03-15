import { NextRequest, NextResponse } from 'next/server'
import { transcribeAudio, generateSpeech, evaluatePronunciation } from '@/server/tools/audio-toolkit'
import { getMentorResponse } from '@/server/mentors/mentor-engine'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { audio, state = {}, ttsRequested = false, pronunciationTarget = null } = body

    if (!audio?.data) {
      return NextResponse.json({ error: 'audio.data required' }, { status: 400 })
    }

    const transcription = await transcribeAudio(audio)
    if (!transcription.success) {
      return NextResponse.json({
        message: 'Could not transcribe audio: ' + (transcription.message || 'unknown error'),
        state,
      })
    }

    const transcribedText = transcription.text

    // Pronunciation evaluation path
    if (pronunciationTarget) {
      const evalResult = await evaluatePronunciation(transcribedText, pronunciationTarget, state.lang)
      if (evalResult.success) {
        return NextResponse.json({
          message:            evalResult.feedbackText,
          transcription:      transcribedText,
          pronunciationScore: evalResult.score,
          artifact:           evalResult.audioFeedback
            ? { type: 'audio', url: evalResult.audioFeedback.url, method: evalResult.audioFeedback.method }
            : null,
          ttsAvailable: evalResult.ttsAvailable,
          state,
        })
      }
      return NextResponse.json({
        message:       'Transcription: "' + transcribedText + '"\n\n' + (evalResult.message || 'Could not evaluate pronunciation.'),
        transcription: transcribedText,
        state,
      })
    }

    // Standard path: mentor response + optional TTS
    const mentorText = await getMentorResponse(transcribedText, state).catch(() => null)
    const responseText = mentorText || '🎤 "' + transcribedText + '"'

    const wantTts = ttsRequested || process.env.LINGORA_TTS_ENABLED === 'true'
    let ttsArtifact = null
    if (wantTts && mentorText) {
      const tts = await generateSpeech(mentorText, { voice: 'nova' })
      if (tts.success) ttsArtifact = { type: 'audio', url: tts.url, method: tts.method }
    }

    return NextResponse.json({
      message:       responseText,
      transcription: transcribedText,
      artifact:      ttsArtifact,
      state,
    })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[AUDIO ROUTE] Fatal:', msg)
    return NextResponse.json({ message: 'Internal error: ' + msg }, { status: 500 })
  }
}
