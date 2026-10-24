# LINGORA 7.5 — CONGELADO

| | |
|---|---|
| **SHA congelado (código)** | `ca6ddac00d9020f5551db8d804263fbd8c293c38` |
| **Padre** | `0fcb602d8a64b0e2eedc2c12a1aa1dca3ceb238b` (head del PR #20, `ae/7-5-candidate-work-ijl`) |
| **Rama** | `release/7.5-congelado`, aislada. No toca `main`. El PR #20 no se fusiona. |
| **Preview** | https://lingora-goxetcw3v-adolfobalaguer7-1860s-projects.vercel.app (deployment `dpl_En3in3pbDafjfQy4AzcBpqa2do5Q`, READY, construido desde `ca6ddac0`; alias de rama: https://lingora-git-release-75-congelado-adolfobalaguer7-1860s-projects.vercel.app) |
| **Transporte** | Bundle git importado sin reescritura por `.github/workflows/lingora-75-congelado-import.yml` (rama `ops/7-5-congelado-transport`). Se verifica el SHA-256 de cada trozo y del bundle, que el padre es 0fcb602d y que el SHA es el exacto. |

## Superficie congelada
1. **Autoridad.** `app/api/chat/route.ts` es solo un adaptador.
   - Cada turno entra por `orchestrateTutorFirst` → `executor='mentor'`. No hay `classifyIntent` ni orquestador en la conversación.
   - `complete_tutor_turn`: `artifacts` es obligatorio y `reply` opcional. Un turno sin artifacts es prosa, y no hay tope de artifacts por turno.
2. **Idioma.**
   - `interfaceLanguage` viaja en `body.state` hasta el ContextPack.
   - La nota de saludo (ES + idioma de interfaz) solo se inyecta mientras el alumno no ha escrito (`opening`). Desaparece con el primer mensaje real, sea cual sea el contador de tokens.
   - Los rótulos de modo salen de `MODE_COPY_RAW[lang]`; están los 10 idiomas.
3. **Documentos.** Chat, PDF, HTML y export pasan por un único lector, `lib/content/markdown.ts`. `renderDocumentPage('print'|'web')` trabaja sobre las mismas secciones. Si falta alguna palabra, el documento se aborta con `export_content_loss` y una frase al alumno.
   - **Página final vacía: no se reproduce.** Medido sobre 110 documentos de 1 a 6 páginas, con la hoja de impresión de producción (`preparePrintHtml`): ninguno termina en página vacía. El código de paginación no se toca.
4. **Export.** Menú, chip y `clientDeliveries.conversation_pdf` usan la misma función, `prepareConversationExport`. Rechaza, con frase y tamaño real:
   - `persistLoss`;
   - `complete:false`;
   - una carga por encima de `EXPORT_PAYLOAD_LIMIT_BYTES`.
5. **Inmersión como contexto.**
   - `buildCommercialContext(state)` devuelve `{level, goal, interest, offerAllowed}`. Lo lleva `plan.commercial` y el ContextPack lo muestra como hechos `immersion.*`, sin imperativos.
   - Frecuencia: 1 invitación por conversación y como máximo 2 en una ventana móvil de 7 días por Space.
   - No hay plantillas ni texto añadido a la respuesta del Tutor.
   - El interés del alumno se guarda en su Space, en este navegador.
6. **Space.** Base IndexedDB `lingora-space-v1`, stores `spaces` y `conversations`.
   - N conversaciones aisladas.
   - Fuentes de texto con nombre, tipo, SHA-256 y fecha.
   - Instrucciones del espacio.
   - Memoria confirmada separada de la inferida por el Tutor; la inferida no viaja hasta que el alumno la confirma.
   - Recuperación por turno: las instrucciones siempre; las fuentes y la memoria confirmada por solapamiento léxico, hasta 1.500 tokens, con id `source:<id>#<pasaje>` / `memory:<id>`.
   - Reset vacía solo la conversación abierta. «Borrar espacio» es una acción aparte, de doble toque.
   - La sesión 7.4 se migra una sola vez.

## Superficie excluida (fuera de este congelado)
- **Cuentas / auth**, **analítica**, **PSP / checkout / reservas**: no existen y no están decididas.
- **Recepción de leads en servidor:** `LEAD_CAPTURE_RELEASED=false`, la puerta de privacidad de DAE, sigue cerrada. LINGORA no recibe el interés del alumno; queda solo en su navegador.
- **Fuentes PDF / imagen:** el Space solo admite texto en esta versión, y lo rechaza con un motivo visible.
- **Sincronización entre dispositivos.**
- **Puntuación SEEK 90/90:** ARCH-9.11 no contiene una rúbrica. No se puntúa.
- **User test:** no se ha hecho en este turno.

## Verificación
- `tsc --noEmit`: 0 errores.
- `npm test`: 29 suites PASS. Las nuevas son `space-7-5`, `freeze-7-5-contracts` y `tutor-free-commercial` (reescrita).
- `next build`: OK.
- E2E con Chromium real contra el build de producción, con `/api/chat` interceptado y sin modelo: 9/9 pasos (`tests/e2e/space-ui-7-5.mjs`).
- QA de la última página del PDF: 110/110 sin página vacía (`tests/qa/pdf-last-page-7-5.mjs`).

**CONGELADO** — `ca6ddac0`, sobre `release/7.5-congelado`.
