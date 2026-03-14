# LINGORA 10.1

**Cultural Immersion Platform for Spanish**
AI-powered language learning with real-world immersion programs.

---

## Stack

- **Next.js 14.2.3** App Router
- **TypeScript 5**
- **Vercel** deployment target
- **OpenAI** gpt-4o + whisper-1 + tts-1 + dall-e-3
- **pdf-lib** for PDF generation
- **AWS SDK** for S3 storage + Rekognition OCR (optional)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

This generates `package-lock.json` automatically. The file is intentionally
excluded from this ZIP — lockfiles must be generated in the target environment
to ensure reproducible resolution.

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
OPENAI_API_KEY=sk-...
```

### 3. Run locally

```bash
npm run dev
```

Verify:
- `http://localhost:3000` — landing
- `http://localhost:3000/beta` — AI tutor
- `http://localhost:3000/api/health` — health check (must return `status: healthy`)

### 4. Deploy to Vercel

```bash
npm run build    # verify build passes locally first
vercel deploy
```

Or connect the repository to Vercel dashboard — it auto-detects Next.js,
runs `npm install` + `npm run build`, and deploys.

Set environment variables under **Vercel > Project Settings > Environment Variables**.

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | ✅ Yes | gpt-4o, whisper-1, tts-1, dall-e-3 |
| `AWS_REGION` | Optional | S3 file storage + Rekognition OCR |
| `AWS_ACCESS_KEY_ID` | Optional | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | Optional | AWS credentials |
| `S3_BUCKET` | Optional | S3 bucket name |
| `LINGORA_TTS_ENABLED` | Optional | Set `true` to always return audio with tutor responses |

**Without AWS configured:** files fall back to base64 data URLs (functional, not persistent).
**Without Rekognition:** image OCR returns an honest failure message instead of silently failing.

---

## Pre-deploy checklist

```
[ ] npm install completes without errors
[ ] npm run build completes without errors
[ ] GET /api/health returns { status: "healthy", version: "v10.0" }
[ ] GET / — landing loads
[ ] GET /beta — tutor loads and shows onboarding
[ ] POST /api/chat responds with { message: "..." }
[ ] No references to Netlify in any file
[ ] OPENAI_API_KEY set in Vercel environment
[ ] .env.local never committed to repository
```

---

## Project structure

```
app/
  page.tsx                 Landing page
  beta/page.tsx            AI Tutor (full UX: onboarding, chat, artifacts)
  layout.tsx               Root layout
  api/
    chat/route.ts          Main orchestrator (intent → tool → response)
    audio/route.ts         STT (Whisper) + TTS + pronunciation evaluation
    rag/route.ts           RAG query endpoint
    export/pdf/route.ts    PDF generation endpoint
    health/route.ts        Health check

server/
  core/
    commercial-engine.ts   Commercial algorithm (strategic asset — do not modify)
    diagnostics.ts         CEFR level evaluation
    intent-detector.ts     Multilingual intent routing (35+ patterns)
  mentors/
    profiles.ts            Sarah, Alex, Nick — full prompts from cantera
    mentor-engine.ts       OpenAI call + session memory
  knowledge/
    rag.ts                 Hybrid semantic + lexical retrieval
  tools/
    schema-generator.ts    Educational schema generation (gpt-4o JSON)
    pdf-generator.ts       PDF with AI-generated content
    image-generator.ts     DALL-E 3 image generation
    audio-toolkit.ts       Whisper STT + OpenAI TTS + pronunciation eval
    attachment-processor.ts OCR + PDF extraction + honest fallbacks
    storage.ts             S3 with graceful fallback to data URL

lib/
  contracts.ts             Single source of truth: all TypeScript interfaces

data/
  rag_corpus.json          19-entry cultural corpus
  rag_embeddings.json      Pre-built vector embeddings
  rag_vectorizer.json      TF-IDF vectorizer
  CERVANTES_URLS.js        Instituto Cervantes reference URLs

public/
  manifest.webmanifest     PWA manifest
  icons/                   App icons
```

---

## Capabilities and honest fallbacks

| Feature | Requires | Fallback if unavailable |
|---|---|---|
| AI conversation | OPENAI_API_KEY | Error message |
| Schema generation | OPENAI_API_KEY | Error message |
| PDF generation | OPENAI_API_KEY | Error message |
| Image generation (DALL-E 3) | OPENAI_API_KEY | Honest error: "could not generate image" |
| Audio transcription (Whisper) | OPENAI_API_KEY | Honest error message |
| TTS spoken feedback | OPENAI_API_KEY | Text-only response (no audio artifact) |
| File storage | AWS S3 configured | Base64 data URL (functional, not persistent) |
| Image OCR | AWS Rekognition configured | Honest message: "OCR not available" |

The system never simulates success. Every tool either returns a real result or an honest failure message.

---

## Version

`10.1.0` — Clean architecture on Vercel/Next.js. No Netlify heritage.
deploy sync
