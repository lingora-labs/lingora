# REGISTRO AE — LINGORA 7.4.5 RTD-CONTINUITY
Fecha: 2026-10-22
Autoridad normativa: Manifiesto 7.0 reformado por Constitución 7.1 conciliada.
Base inmutable Work: 7.4.4 SHA 317f283eb947e45e7c7288010763481e7225c386

## Hallazgos reales Work 7.4.4
Expediente: LINGORA_WORK_RTD_7_4_4_UI_ACCEPTANCE.zip, SHA256 09b728d9a99fe7d93fb38ba731d798f7c90041616ff2693215d93598750fc903.
Resultados históricos: PASS 11, PASS_WITH_LIMIT 1, FAIL 3, BLOCKED 2.
P1-01 tabla nativa rechazada; P1-02 quiz 12 preguntas inerte; P1-03 PDF solo texto, sin artifacts, Markdown literal, respuesta incompleta. P1-05 HTML export no visible y composer bloqueado por turno largo.
No extrapolar a SEEK.

## Cambios reales 7.4.5
- Compartir límites de tabla hasta 16 columnas y 80 filas con JSON schema del Tutor.
- Normalizar columnas texto/objeto y celdas texto/objeto sin inventar datos; rechazo íntegro fuera del contrato.
- Presentar tabla nativa con fondos cromáticos legibles en las columnas.
- Soportar hasta 20 preguntas táctiles en materializer y parser de texto; conservar revisión del Tutor sin score inventado.
- Conservar turnos + artifacts tipados en export PDF; renderizar datos canónicos chart, flowchart, infographic, table_matrix y quiz, sin generación cognitiva adicional.
- Interpretar Markdown con escapado de HTML para impresión.
- Marcar los turnos SSE como incompletos hasta cierre, no exportar un turno no terminado como historial íntegro.
- Regression gate: tests/rtd-continuity-7-4-5.test.mjs.

## Evidencia verificada
Build Vercel completada 7.4.5 y tests deterministas PASS.
Sonda viva aislada con OPENAI_MAIN_MODEL=gpt-5.6-sol:
- tabla nativa 10 columnas x 16 filas, sin fallos de materialización;
- quiz táctil 12 preguntas, gradingMode=tutor_review, sin fallos de materialización;
- Chromium PDF 157501 bytes, 3 páginas; HTML fuente con 3 SVG canónicos, Markdown en negrita interpretado y sin Markdown literal en el caso ensayado.
Sonda de diagnóstico separada de la rama de producto; no se fusiona.

## Límites honestos
- Falta captura independiente de UI real y comprobación de botones, feedback y exportación del hilo grande de 18 páginas.
- Falta inspección visual de páginas de PDF de prueba y móvil físico/emulado.
- El flujo largo de acupuntura (>90s) requiere validar finalización y recuperación real en la próxima aceptación.
- HTML como descarga explícita de conversación aún no certificado.
- No hay matriz SEEK ponderada aprobada: NO SE EMITE 89,90/90. IJL, release y monetización continúan NO-GO.
- NO modificar main ni producción por este registro.
