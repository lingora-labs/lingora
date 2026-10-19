# LINGORA — Tutor Libre 7.2 · contrato único de ejecución
Fecha: 2026-10-19
Base histórica: 50f562aaba8d97b405a9f53f208b75527ca63af6

## Autoridad
Manifiesto 7.1: arts. 47–52, Tutor Maestro cognitivo primero; runtime autoriza solo efectos. Arts. 25–27 conservados: tokens simbólicos acumulados, oferta visual real al hito de cinco tokens. Los turnos no equivalen a tokens.

## Operaciones materiales sujetas a autorización
- PDF: exportación directa de UI o petición explícita; bytes y versión HTML se materializan o se comunica fallo. El contrato PDF multiturmo permanece limitado al pedido confirmado.
- Imagen: solo petición explícita actual, con límite de gasto y resultado material verificable.
- Audio: acción táctil o modalidad vocal iniciada por estudiante; proveedor y fallo instrumentales.
- Quiz/esquema/tabla nativos: el Tutor crea el contenido; runtime valida estructura, no redacta lecciones. Puntuación automática solo cuando está comprobada; tutor_review cuando no.
- Mutación de estado/tokens: incremento simbólico y créditos sustentados en evidencia; progreso sin marcador no se inventa.
- Leads e inmersión: captación cerrada por DAE hasta bucket privado, notificación, aviso RGPD y canal de tratamiento; no habilitar únicamente con variables S3.

## Justificación de cambios de pruebas previas
- tests/pdf-intent-authority.test.mjs: sustituir expectativa literal de tool_choice forzado por 'auto' con autorización PDF en el ejecutor.
- tests/quiz-tutor-review.test.mjs: UI de revisión autoactivada cuando la clave no es comprobable; no es error ni nota.
- tests/tutor-free-commercial.test.mjs: captación de leads apagada por restricción de privacidad.
- En 7.1, tests/quiz-answer-key.test.mjs: las claves erróneas dejaron de sobrescribirse con explicaciones incompatibles; se conserva modo tutor_review.
- En 7.1, tests/p1-contracts-7-1.test.mjs y tests/document-contract-tutor-first.test.mjs: se eliminaron expectativas del viejo refuerzo visual generado automáticamente; 7.2 añade prueba de hito y acción táctil.
- En 7.1, los cambios históricos de tests son evidencia contextual, no aceptación de UI ni PDF real. Ningún PASS se hereda de un SHA distinto.

## Cobertura nueva
- tests/tutor-7-2-progress.test.mjs: múltiples fuentes de tokens del art. 26, deduplicación y oferta exactamente al cruce de múltiplos de cinco.
- tests/tutor-7-2-contracts.test.mjs: autoría Tutor, no router cognitivo regex, contrato de error visible, revisión UI y cierre comercial.

## Deuda declarada, no ocultada
Las pruebas heredadas de recuperación estructural que esperan llamadas/reintentos eliminados no forman parte del build y deben actualizarse o archivarse con decisión DAE. El build no acredita interacción de navegador, PDFs/HTML reales ni SEEК 89,90/90.
