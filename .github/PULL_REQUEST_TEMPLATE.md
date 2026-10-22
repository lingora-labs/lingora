# Preflight obligatorio — CNP-01
> Cada propuesta de fix debe distinguir capacidad nativa de la LLM e instrumentación necesaria. No presentar un cambio de límites como solución estructural definitiva.

## 1. Intención y resultado visible
<!-- Describir lo solicitado por el alumno, no cómo lo queremos implementar. -->
Obligatorio: 

## 2. ¿Podría la LLM resolver la parte intelectual sin parámetros específicos de LINGORA?
<!-- YES / NO / NOT VERIFIED, modelo realmente servido, evidencia y qué puede producir sin herramientas. -->
Respuesta: 
Evidencia: 

## 3. ¿Qué parte SÍ requiere runtime?
<!-- Render, interacción, PDF/PNG/SVG binario, persistencia, seguridad, validación, paginación. -->
Responsabilidad instrumental: 

## 4. Causa raíz evidenciada
<!-- COGNITIVO / INSTRUMENTAL / MIXTO / NO DEMOSTRADO y prueba del fallo -->
Clasificación: 
Evidencia reproducible: 

## 5. ¿Por qué existe cada límite nuevo? ¿Cómo se conserva el excedente?
<!-- Límites por API/seguridad/recursos. Paginación/backpressure/continuación, no truncamiento. -->
Justificación: 
Tratamiento sin pérdida: 

## 6. Cambio mínimo y alternativas
<!-- No prompt fixes ni nuevos componentes ad hoc si un motor común basta. -->
Alternativas evaluadas: 
Solución propuesta: 

## 7. Fidelidad entre RTD / PDF / HTML / descargas
<!-- Cómo falla explícitamente en lugar de omitir datos. -->
Contrato único y errores visibles: 

## 8. Verificación
<!-- Antes/después: negativo + determinista + Tutor vivo + navegador si UI. -->
Prueba negativa: 
Prueba real: 
Limitaciones sin verificar: 

## 9. Autoridad, descartes y semáforo
<!-- ¿Afecta jerarquía Manifesto → arquitectura → código? ¿requiere AE/Dirección? -->
Dependencia constitucional: 
Decisión gate CNP-01 (PASS/FAIL/BLOCKED): 

**No autorizar merge/release ni marcar PASS cuando cualquiera de estas casillas quede vacía.**
