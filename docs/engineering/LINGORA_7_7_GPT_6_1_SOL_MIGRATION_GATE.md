# LINGORA — 7.7-SOL: contrato de migración a GPT-6.1 Sol (evaluación aislada)
Fecha: 2026-11-05
Estado: PLAN TÉCNICO; SIN MIGRACIÓN IMPLEMENTADA; SIN AUTORIZACIÓN DE PRODUCCIÓN.

## Base inmutable
Rama origen: dae/7-6-call-mode-r1 @ 4d525fc35ae8f32fc5b63b12a3fba4de652c3df7 (R4-M).
Rama de evaluación: ae/7-7-sol-6-1-evaluation.
Producción/main y la rama DAE NO se modifican. Tutor de referencia GPT-5.6 Sol sigue siendo baseline.

## Hallazgos forenses en el código de base
1. server/mentors/mentor-engine.ts: PRODUCT_MODEL='gpt-5.6-sol', modelConfigurationError rechaza modelos distintos y gateByServedModel impide publicar texto antes de identidad verificada.
2. El Tutor utiliza openai.chat.completions.create({stream:true,tools,tool_choice,messages,...buildModelParams(...)}); consume choices[0].delta y tool_calls fragmentados.
3. buildModelParams usa reasoning_effort='none' y temperature=0.7 para gpt-5.6 Sol. GPT-6.1 Sol no admite none y, con reasoning activo, no admite temperature/top_p.
4. package.json usa openai '^4.28.0'; verificar/actualizar SDK y lockfile para Responses API.
5. package.json fuerza OPENAI_MAIN_MODEL=gpt-5.6-sol en build/test y tests/product-model-pin-7-5.test.mjs fija ese modelo.
6. No es un cambio de una variable de entorno: el contrato de streaming y herramientas es incompatible.

## Arquitectura objetivo
- El modelo Tutor es gpt-6.1-sol, usando Responses API, en la rama aislada.
- El Tutor sigue siendo el único autor: conservar manifiesto, memoria, contratos de materialización, herramientas y el protocolo de aprobación de artifacts. No mover herramientas al motor de voz.
- Adaptador consistente entre Responses stream (response.output_text.delta, response.output_item.added/done, response.function_call_arguments.delta/done, response.completed/failed) y el MentorStream vigente.
- Transformar herramientas Chat Completions (type:'function', function:{name,description,parameters}) a Responses (type:'function',name,description,parameters,strict:false cuando proceda); correlacionar resultados por call_id.
- Reproducir las continuaciones y resultados de herramientas con function_call_output, no mensajes role:'tool'; preservar history y estado del Tutor.
- Actualizar contabilidad de usage (input/output/cached tokens, reasoning tokens y cache writes cuando existan).
- Guardar explícitamente store:false si se preserva el contrato stateless/privacidad anterior; documentar cómo se conserva reasoning en continuaciones.
- No eliminar bloqueos de identidad ni suavizar tests de artifacts; parametrizar identidad únicamente por ambiente de preview con allowlist y trazabilidad. Producción sigue anclada a gpt-5.6-sol hasta decisión formal.
- Cambiar los scripts que fijan OPENAI_MAIN_MODEL y las pruebas del pin únicamente en la rama experimental.
- Mantener CALL MODE R4-M y su instrumentación; evaluar latencia del Tutor y audio de extremo a extremo por separado.

## Criterios de aceptación de la preview
A. Build + tsc + tests de seguridad/constitución intactos, sin aserciones placebo.
B. Identidad real servida: gpt-6.1-sol verificada en cada respuesta; sin fallback silencioso.
C. Historial de varios turnos, intención explícita, idioma y memoria intactos.
D. CALL MODE audible y exclusivo; R4-M sigue midiendo (mediana, rango y desglose).
E. Herramientas: complete_tutor_turn, deliver_from_text, set_explanatory_language, update_student_memory, record_learning_fact funcionan mediante Responses API; ninguna acción de herramienta sin autorización del Tutor.
F. Paridad de artifacts: SER/ESTAR, acupuntura, KPI y matriz comparativa, cada uno con UI y PDF/WEB verificables.
G. QA benchmark Zakia y casos adversariales para detectar personalidad, intención y structured-mode hijack.
H. Coste por turno / por sesión e ingestión de cached input y cache write reales; velocidad no inferida del precio.
I. Prueba física y regresión con >=20 turnos comparables y posterior repetición de muestra si la diferencia es pequeña. Declarar latencia de extremo a extremo y coste; no aceptar solo si es más barato.
J. No hacer merge a main ni cambiar variables Production sin aprobación CEO y revisión DAE, SEEK >=90/90.

## Referencias oficiales
https://developers.openai.com/api/docs/models/gpt-6.1-sol
https://developers.openai.com/api/docs/guides/migrate-to-responses
https://developers.openai.com/api/docs/guides/latest-model
