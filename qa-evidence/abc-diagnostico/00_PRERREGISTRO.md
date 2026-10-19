# PR #14 — PRERREGISTRO A/B2/C PARA COMENTARIO PREVIO A LA PRIMERA LLAMADA
Fecha: 19/10/2026 — Ingeniería de Soporte LINGORA

**Autorización CEO:** GO diagnóstico, hasta 3 USD; no constituye aprobación de producto ni certificación SEEK.

**Fuente inmutable:** 08fa9c5e4d993c1d574760c3e2461f6c013a1cc4, main y PR #14 protegidos. Vercel deployment dpl_4z4HRNChUSyM2XtHqEHeigWtJNgd.

**Modelo:** gpt-5.4-mini, temperatura 0.7, max_completion_tokens=4096, top_p omitido. Reintentos automáticos del SDK desactivados solo en arnés (maxRetries:0). Fuente de precio oficial: 0.75 USD/1M tokens de entrada y 4.50 USD/1M tokens de salida.

**Condiciones:** A = modelo desnudo, solo user, sin tools; B2 = mismo system/history exacto de C excepto 12 reemplazos instrumentales ratificados, sin tools; C = primer borrador de modelo con complete_tutor_turn forzado, ANTES de reparaciones, reintentos semánticos y materialización. A/B2 son respuestas de texto, no se penalizan por no crear UI táctil.

**Muestra:** 10 solicitudes idénticas Gate C por condición = 30 llamadas. Paridad de 10 dominios distintos en A y C = 20 llamadas. Total base 50. Techo técnico 80; máximo económico absoluto de 3 USD a monitorizar por usage. D (modelo superior) excluido del plan inicial. E (temperatura 0.2) NO APROBADA por IJL: NO EJECUTAR.

**Fidelidad del arnés:** C corre primero. Verificar primer borrador sin reparaciones con verificador del repositorio solo para similitud con 1/9 observado en Gate C; se tolera diferencia <=1 caso o <=10 puntos porcentuales. Si falla, declarar NO FIEL y DETENER sin repetir ni sustituir.

**Ceguera IJL:** pseudonimizar las condiciones, mezclar respuestas; calificación independiente por pregunta (unicidad, respuesta si es declarada, explicación coherente si existe, razonamiento filtrado) y por turno afectado. NO_EVALUABLE para clave que A/B2 reserven correctamente; >=15 ítems evaluables por clase/condición, de lo contrario clase no concluyente.

**Reglas preregistradas:** B2=0 y C>=3 defectos de misma clase: señal; C>=5: fuerte. B2>0, C>=3xB2, B2<=10%. Igualdad aproximada: <=1 defecto o <=10 puntos porcentuales. Reforma G5 solo con señal fuerte o en >=3 turnos distintos. Paridad LLM: C inferior a A en >=7/10 pares es señal. Las puntuaciones de IJL no pueden proceder del propio verificador del repositorio.

**Cierre:** guardar TODOS los outputs crudos, fallos, finish_reason, tokens usage, hashes y ejemplos; no sustituir fallos. Sin código, commits sobre candidato o merge. No SEEK ni monetización hasta decisión de arquitectura y QA independiente.

**Escaneo pre-ejecución:** 12 anclajes exactos. SHA256 C=851ea732e8c1b2a42ac7fa9d716c3c360a211916f5c6e16728889621bd22c947; SHA256 B2=3f55870e16867af843e7aaac0999b652728cb251e0f79fadfae8b77c4a2d28ff. Siete expresiones prohibidas a 0; ampliadas informativas: artifact=4,runtime=1,materializ=2,native=0,declare=0,emit=1.

**IMPORTANTE:** este prerregistro se prepara para publicar ANTES de las primeras llamadas. Su presencia en este archivo NO equivale a publicación en PR.

---
## ADENDA DAE (19/10/2026) — requisitos de ejecución añadidos antes de la primera llamada
1. Publicación: este archivo se registra por commit en la rama `qa/abc-prerregistro-2026-10-19` (padre = 08fa9c5e, sin tocar el candidato). El commit es el sello temporal; un comentario espejo en PR #14 por un operador autorizado es deseable, no bloqueante.
2. Ceguera: en la comparación de paridad (A vs C), la respuesta de C se extrae como texto plano (`reply`); los artifacts se evalúan por separado. Ninguna pista de formato (JSON, tool_call) puede llegar al calificador.
3. Fidelidad del arnés: C corre primero; si falla, NO FIEL y se detiene (ya preregistrado).
4. Condición E no se ejecuta (IJL no la aprobó). Queda registrada como no ejecutada.
5. Se publican TODAS las salidas crudas, incluidas las de los fallos, aunque superen el tope; el tope de 3 USD aborta la batería, no los resultados.
