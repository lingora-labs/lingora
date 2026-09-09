'use client'
// SEEK 5.0 P0 UI recovery — shell. Behavior from archived page.tsx.
import React, { useState, useRef, useEffect, useCallback, useMemo, type ChangeEvent } from 'react'
import { chromeLessonLabel, chromeLevelLabel } from './chrome-gate'
import {
  BACKEND_LANG, MENTOR_META, TOPIC_META, LANG_GRID, COPY, TOPIC_KEYS, MENTOR_KEYS, GREETINGS, TSYS,
  type MK, type TK, type Lang, type Phase, type ActiveMode, type Msg, type SS,
} from './beta-model'
import { Bubble, Typing } from './beta-chat-ui'
import { trimStateForPayload, doExportTxt, doExportPdfBackend } from './beta-io'

export { default } from './beta-page-shell'
