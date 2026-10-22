# LINGORA — REGLA OPERATIVA AE-CNF-01: CAPACIDAD NATIVA PRIMERO
Estado: PROPUESTA DE ADOPCIÓN (rama de revisión; requiere aprobación AE/Dirección para integrarse en baseline).
Jerarquía: Manifiesto 7.0 reformado por Constitución 7.1 > arquitectura > implementación.
Propósito: terminar el ciclo de fixes de límites arbitrarios y prompts sustitutos de arquitectura.

## Pregunta obligatoria antes de CUALQUIER propuesta de fix
**¿La LLM puede resolver correctamente la parte intelectual de esta petición sin reglas/prompt/parametrización particulares de LINGORA, con el modelo realmente servido y con suficiente contexto?**
Describir cómo se sabe (prueba con el modelo, evidencia previa o NOT VERIFIED). No confundir «puede redactarlo» con «puede emitir un PDF binario, botones operativos o garantizar datos».

**¿Qué parte precisa requiere instrumentación para ser visible, segura, persistente, táctil o descargable?**
Separar autoría cognitiva de transporte, renderización, validación, generación de archivos, persistencia, paginación, seguridad y presupuestos.

## Gate pre-fix obligatorio (CNP-01)
Antes de editar producción o proponer un cambio estructural se documentan:
1. EXPECTATIVA: intención explícita del alumno y comportamiento visible exigido.
2. PRUEBA NATIVA: qué produjo el mismo modelo sin el contrato específico que se quiere modificar, o NOT VERIFIED y motivo.
3. FRONTERA COGNITIVA/INSTRUMENTAL: ¿contenido conceptual, presentación, archivo o interacción? Puede ser MIXTA.
4. DEFECTO COMPROBADO: ¿el modelo falló realmente, falló el esquema, el render, la exportación, el estado, el proveedor o el dispositivo? Con log/payload/archivo.
5. NECESIDAD DE PARAMETRIZACIÓN: cada límite propuesto explica cuál restricción real lo justifica (contexto, tiempo, memoria, seguridad, tamaño de pantalla, formato, API) y cómo se pagina/continúa/reanuda.
6. ALTERNATIVA MÍNIMA: usar primero las capacidades existentes del Tutor y el motor general; proponer nuevos componentes solo si los existentes no pueden representar fielmente el resultado.
7. CONSISTENCIA: mismo contenido canónico en RTD, PDF, HTML y descarga; error explícito si la representación falla.
8. PRUEBA ANTES/DESPUÉS: fixture negativo reproducible, prueba viva y verificación en interfaz cuando la UX sea el criterio.
9. CLASIFICACIÓN: COGNITIVO / INSTRUMENTAL / MIXTO / NO DEMOSTRADO. Resultado de gate: PASS / FAIL / BLOCKED.
10. DEPENDENCIAS DE AUTORIZACIÓN: AE/Dirección para reformas estructurales, DAE revisión de arquitectura. No hacer merge ni deployment de producción sin aprobación.

## Rechazo automático de propuestas
- Subir 6→16 columnas o 8→20 preguntas como solución definitiva SIN analizar paginación y fuente de límites.
- «Más prompt» como remedio a un contrato, parseo, persistencia o render roto.
- Sustituir artifact fallido por contenido truncado, gráficos placebo o aceptación silenciosa.
- Reducir la calidad/fidelidad para hacer pasar tests o registrar PASS sin UI visible.
- Inferir que el modelo por sí solo puede ejecutar herramientas o producir archivos binarios y controles táctiles: eso requiere runtime.

## Ejemplos de clasificación
- «Explica subjuntivo»: capacidad cognitiva del modelo. No imponer un modo innecesario.
- «Tabla 30×60»: modelo decide contenido; runtime necesita celdas fieles, render adaptativo, paginación/exportación; NO cortar filas.
- «Quiz de 50»: modelo redacta preguntas y explicaciones; runtime dibuja opciones y recoge selecciones; puntuación automática solo con claves probadas.
- «Documento PDF con tabla/flujo»: modelo estructura contenido; runtime materializa bytes verificables y conserva visuales; falla explícitamente si pierde uno.
- «Pregunta en audio»: modelo responde; pipeline instrumental transcribe/emite voz y preserva sesión.

**Regla de decisión:** si el modelo podía producir el contenido pero la UI/file layer no, REPARAR EL INSTRUMENTO; no remodelar al Tutor. Si el modelo no puede, investigar capacidades, contexto y límites reales antes de inventar una regla o degradar el baseline.

Este archivo es una disciplina de ingeniería. NO reforma ni sustituye la Constitución, no reemplaza la rúbrica SEEK y no concede una certificación.
