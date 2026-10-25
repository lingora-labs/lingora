# LINGORA 7.6 — Auditoría transversal de camisas de fuerza
Fecha: 2026-10-25
Base: f1a5cb6aa05e842d68df8c6ba9e48136356b7324
Rama: release/7.6-contextual-language-intent-20261025
Estado: prueba de build aprobada, navegador/micrófono humano todavía no certificados.

## Jerarquía
La intención actual del alumno gobierna la respuesta. El modo y las fases son contexto pedagógico, no soberanos.
El idioma de aprendizaje (español) no es una prohibición de responder en cualquier otro idioma.
Solo Willy decide si la última intervención exige un cambio conversacional de idioma, una traducción o un ejercicio.
El código ejecuta acciones deterministas, preserva estado, valida evidencia y traduce etiquetas instrumentales.
Prohibido crear otro router lingüístico basado en listas de palabras o detectar idioma de ejemplos con regex.

## Hallazgos y decisión
1. ROJO: el contrato anterior permitía cambiar explanatoryLanguage solo ante una petición explícita.
   Sustituido por declaración semántica del Tutor con evidence y basis (explicit_request/conversation_shift).
   Evidencia debe estar en el turno del alumno; se rechazan los segmentos de ASR inciertos.
2. ROJO: selector inicial ligado a la interfaz y traducción limitada a noruego.
   La interfaz ahora sigue explanatoryLanguageSource persistida en la conversación (student_turn o student_request).
   Las etiquetas estáticas están separadas en un catálogo fijo; locales nuevos se traducen con una capa
   instrumental y se cachean sin exponer mensajes del estudiante al traductor.
3. ROJO: texto de persona con prohibición superior de cambiar idioma sin petición explícita.
   Eliminado. La lengua del diálogo más reciente se interpreta semánticamente; ejemplos y tareas de traducción no secuestran el idioma.
4. AMARILLO: la secuencia pedagógica se expresaba como orden absoluta aun ante una intención nueva.
   Ajustada como secuencia por defecto, con prioridad para acciones explícitas.
5. AMARILLO: acciones explícitas podían quedar eclipsadas por modo interactivo/libre.
   En lib/tutorProtocol la acción explícita precede la resolución por modo.
6. AMARILLO: frases estáticas de controles internos de Schema Pro estaban en español.
   Conectadas a la misma autoridad de interfaz y catálogo.
7. AMARILLO: detección opcional de evaluación oral mediante palabras clave españolas en
   app/beta/use-beta-page.ts. Queda bajo observación: una reforma exige contrato multimodal completo;
   no debe hacerse un reemplazo improvisado por otra lista de palabras.
8. AMARILLO: persisten textos de error y algunas etiquetas en componentes no migrados.
   No afirmar cobertura universal verificada hasta completar un inventario DOM sobre otros idiomas.
9. AMARILLO: la traducción de un locale aún no cacheado depende de un servicio; los fallos se muestran,
   no se ocultan, y en la primera carga puede verse temporalmente la etiqueta fuente.
   Debe probarse latencia, traducción, límite de llamadas, seguridad y factura antes de presentación seed.

## Barreras correctas — NO tocar
- Un solo Tutor Maestro y ninguna clasificación semántica por regex/código.
- No inventar archivos ni afirmar descargas hasta verificar bytes, tamaño y SHA.
- Sin puntuaciones fabricadas: quizzes con clave no verificada pasan al Tutor.
- No confundir texto de ejercicio / transcripción ASR incierta con una preferencia lingüística.
- No mezclar decisiones pedagógicas y capa instrumental de renderizado.
- Espacio persistente y contexto restringido a la conversación elegida.
- Model pin y verificación de identidad de gpt-5.6-sol.
- Sin backend comercial, cuentas, pagos ni modificaciones de producción.

## Tests reales presentes
- Suite npm build existente, con nuevas regresiones Russian->Portuguese y ASR uncertain:
  tests/language-authority-7-5.test.mjs.
- Prueba de contratos explícitos y de primera respuesta:
  tests/explanatory-language-7-3-2.test.mjs.
- Test de exportación visual cambiado a contrato de onClick en lugar de texto español fijo:
  tests/visual-export-contract.test.mjs.
- No ha ocurrido un test de usuario multilingüe con navegador humano ni un test de traducción real
  de etiquetas en todos los idiomas. Build READY no equivale a E2E de i18n.

## Ledger de descartes de 7.6
- Descartado: el idioma del picker es una cárcel invariable durante toda la sesión.
- Descartado: necesitar siempre una orden expresa para responder en el nuevo idioma del alumno.
- Descartado: añadir diccionarios locales parcheados uno por uno como única arquitectura de i18n.
- Descartado: obligar cada turno del modo estructurado a seguir una fase independientemente del pedido.
- Descartado: corregir lengua e intención desde el frontend con una lista de palabras.
- Descartado: convertir todos los ejercicios textuales en botones falsos sin artifact tipado.

Criterio de aceptación pendiente: Work en vista limpia con portugués después de ruso,
con ejemplo español intercalado, y botones/Space/quiz/documento en el idioma efectivo;
persistencia tras recarga; móvil 390px; sin ASR ficticio; screenshot y transcripción real.
