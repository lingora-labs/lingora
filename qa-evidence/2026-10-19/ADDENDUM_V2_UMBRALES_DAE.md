# LINGORA — ADDENDUM NUMÉRICO AL PRERREGISTRO V2 (DAE)

**Fecha de sello:** 2026-10-19
**Objeto inmóvil:** producto `954d27b70c725eaf8d915e3187c201861726b5b7`
**Documento matriz (no sustituido):** `qa-evidence/2026-10-19/PREREG_V2_TUTOR_LIBRE_7_2.md`
**Mandato:** dictamen DAE sobre 7.2, criterios numéricos fijados ANTES de cualquier nueva llamada.
**Prioridad:** ante discrepancia, este addendum define umbrales y el prerregistro original define prompts, rutas y procedimiento.

## 1. Paridad cognitiva, A frente a C
- Diez pares P01–P10 exactos, idénticos en A y C y sin reintentos ni reemplazo de una respuesta fallida.
- IJL puntúa A/C a ciegas, con criterio consistente; empate cuenta como «C no peor».
- **PASS:** C no peor que A en por lo menos **8/10** pares.
- **PASS adicional obligatorio:** **0/10** respuestas de C convierten una pregunta externa en lección de español; P09 es únicamente el mensaje de agradecimiento solicitado, sin explicación pedagógica.
- Los diez pares cuentan, incluso respuestas vacías, errores y fallos del modelo.
- Diferencias de herramientas/instrucciones y cualquier parámetro no igualable se documentan en los datos crudos; no declararlas equivalentes de forma ficticia.

## 2. Gate C táctil
- Diez solicitudes idénticas, Sarah, modo `interact`, idioma español, `state.tokens=2`, sin reintentos ni sustitución.
- **PASS:** **10/10** quizzes táctiles realmente entregados; **0/10** PDFs no solicitados; **0/10** imágenes no solicitadas; **0/10** falsas alarmas del verificador de entregas.
- **PASS:** **10/10** entregas contienen preguntas y opciones válidas, con claves y explicaciones coherentes **o** modo `tutor_review` seguro sin calificación automática falsa y con turno real de revisión.
- El modo `tutor_review` no se presenta como puntuación automática. Registrar separadamente `n_auto_grade`, `n_tutor_review`, calidad de explicación, errores de cierre y falsas notas.
- Un quiz pedido que no se materializa cuenta **FAIL** aunque exista aviso y reintento ofrecido. Una nota gramatical falsa es **FAIL** incluso si el HTML muestra opciones.
- Registrar discrepancias entre texto libre y herramienta; un artifact descartado por divergencia **no** cuenta como entregado.

## 3. Reservas, errores y comportamiento de degradación
- **PASS:** **0** turnos terminan con texto de reserva sin causa real trazable del proveedor.
- **PASS:** **0** excepciones sin gestionar que rompen turnos completos.
- Cada causa de proveedor debe contar con estado o clase registrados sin exponer PII.
- Distinguir degradación honesta de entrega completa; las respuestas de reserva no sustituyen un quiz ni un artifact.

## 4. Cinco condiciones de producto — navegador real
- **PASS solo con 5/5 observadas en Chromium real sobre la preview del SHA exacto:**
  1. inteligencia general sin sobreconvertir en lección de español;
  2. quiz táctil, selección completa y revisión efectiva por el MISMO Tutor;
  3. PDF y HTML reales en un único turno con fidelidad árabe/español (revisar bytes, texto y render visual);
  4. persistencia tras recarga y equivalencia de contenido al exportar;
  5. enseñanza correcta, continuidad y trayectoria tipo Zakia.
- **Art. 27 adicional obligatorio:** la acción **«Crear mi esquema visual»** aparece en UI al cruzar 5 tokens simbólicos acumulados según Arts. 25–26 (también por vías no equivalentes a turnos), y no antes. Al pulsarla, contenido genuino y exportación funcional PNG/PDF; si falla cualquiera, incumple C3.
- La ruta SSE predominante debe demostrarse en Chromium; suposiciones de código sobre SSE no bastan.
- C5 permanece cerrado: 0 capturas de leads, 0 ofertas de inmersión hacia un canal no operativo, 0 promesas de plaza/contrato.

## 5. Gasto y prueba válida
- **Techo global:** USD **3,00**. Abortar antes de excederlo; si falta medición confiable del consumo, **0 llamadas nuevas** hasta disponer de ella.
- Sin retries, sin maquillaje de denominadores, sin sustituir FAIL, sin sumar pruebas de otros SHA.
- Registrar parámetros efectivos, modelo exacto, marcas temporales, identificadores, outputs completos, costos por llamada, SHA de preview y evidencias de UI.
- IJL evalúa pares anonimizados antes de conocer grupos; Work confirma visualmente en Chromium; DAE adjudica después de recibir evidencia bruta.
- **SEEK 89,90/90 sigue siendo objetivo, NO calificación.** Audio humano sigue PENDING; ningún score se infiere de este addendum.

**Estado al sello:** addendum prerregistrado, sin ejecutar llamadas como consecuencia de este documento.
