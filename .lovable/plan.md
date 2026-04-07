
Objetivo: estabilizar de forma prioritaria la detección de dedo, fortalecer la señal PPG real y recuperar latidos confiables, eliminando lógica superpuesta que hoy se invalida entre sí.

## Diagnóstico del código actual

Encontré varios problemas estructurales que explican la inestabilidad:

1. Desincronización entre capas
- `PPGSignalProcessor` tolera pérdida de contacto hasta 45 frames.
- `useHeartBeatProcessor` resetea el detector tras solo 8 frames sin dedo.
- Resultado: la capa de dedo dice “todavía hay contacto”, pero la capa de latidos ya destruyó su historial.

2. Calidad duplicada y conflictiva
- `PPGSignalProcessor` calcula su propio SQI.
- `VitalSignsProcessor` vuelve a calcular otro SQI distinto sobre la señal ya filtrada.
- Resultado: una capa considera la señal usable y otra la invalida.

3. Captura no alineada al video real
- En `Index.tsx` la captura usa `requestAnimationFrame` + throttle manual a 30 fps.
- Esto no garantiza sincronía con frames reales del sensor; mete jitter en timestamps y perjudica RR/PPG.

4. Carga gráfica innecesaria durante medición
- Hay dos videos activos: `CameraView` y `CameraPreview`.
- `PPGSignalMeter` redibuja un canvas grande continuamente y además vuelve a detectar picos/vales solo para visualización.
- Resultado: más CPU/GPU, más jitter, peor estabilidad temporal.

5. Extracción de pulso todavía limitada
- `PPGSignalProcessor` mezcla solo `R/G/RG`.
- No aprovecha selección competitiva entre múltiples fuentes pulsátiles ni ranking temporal de canal.
- Falta una estrategia más robusta tipo “winner channel / best source per window”.

6. Detección de dedo demasiado binaria
- Aunque hay grilla 5x5, el sistema sigue terminando en un `fingerDetected` booleano con thresholds rígidos.
- Falta separar claramente:
  - contacto óptico,
  - calidad de perfusión,
  - contaminación por movimiento,
  - saturación/clipping.

## Lo que conviene cambiar primero

### 1) Unificar el “estado de contacto” en una sola fuente de verdad
Archivos:
- `src/modules/signal-processing/PPGSignalProcessor.ts`
- `src/hooks/useHeartBeatProcessor.ts`
- `src/pages/Index.tsx`

Cambios:
- Definir 3 estados en vez de solo booleano:
  - `NO_CONTACT`
  - `UNSTABLE_CONTACT`
  - `STABLE_CONTACT`
- El `HeartBeatProcessor` debe resetearse solo cuando `NO_CONTACT` sea sostenido, no ante microcortes.
- `useHeartBeatProcessor` debe heredar la misma histéresis del detector de dedo, no usar su umbral separado de 8 frames.

Impacto:
- Evita perder el historial justo cuando el dedo tiembla o se desplaza mínimamente.

### 2) Reemplazar el loop de captura por frames reales del video
Archivo:
- `src/pages/Index.tsx`

Cambios:
- Migrar de `requestAnimationFrame + throttle` a `HTMLVideoElement.requestVideoFrameCallback` con fallback.
- Usar timestamps reales del frame para toda la cadena.
- Mantener un sampler estable y desacoplado del render UI.

Impacto:
- Mejora mucho la estabilidad de BPM, RR y periodicidad.

### 3) Refactorizar extracción PPG a selección competitiva de señal
Archivo:
- `src/modules/signal-processing/PPGSignalProcessor.ts`

Cambios:
- Evaluar en paralelo varias fuentes:
  - R norm
  - G norm
  - B norm opcional
  - R-G
  - G-B
  - CHROM-like / combinación cromática estable para contacto
- Rankear cada ventana corta por:
  - perfusión AC/DC,
  - SNR,
  - periodicidad,
  - clipping,
  - estabilidad temporal.
- Elegir la mejor fuente activa por ventana con histéresis para no saltar de canal en cada frame.

Impacto:
- Permite rescatar señal real cuando el canal verde se satura o el rojo cae por presión/cobertura.

### 4) Separar “contacto” de “calidad útil”
Archivo:
- `src/modules/signal-processing/PPGSignalProcessor.ts`

Cambios:
- No invalidar toda la medición cuando hay movimiento moderado.
- Exponer métricas separadas:
  - `contactScore`
  - `perfusionScore`
  - `motionScore`
  - `clipScore`
  - `sourceLabel`
  - `signalQuality`
- `fingerDetected` debe derivarse de contacto estable, no de la calidad total.

Impacto:
- El usuario puede seguir teniendo contacto aunque la calidad baje temporalmente; eso evita cortes artificiales.

### 5) Fortalecer detector de latidos con fusión tiempo + frecuencia
Archivo:
- `src/modules/HeartBeatProcessor.ts`

Cambios:
- Mantener el detector de picos, pero agregar una fusión explícita:
  - modo pico dominante cuando hay buena morfología,
  - modo espectral dominante cuando la onda es débil,
  - transición suave entre ambos.
- Añadir “peak candidate scoring” por prominencia, pendiente, consistencia con RR esperado y SQI de ventana.
- No usar una sola normalización global; usar ventanas más cortas para señales débiles y más largas para señales estables.

Impacto:
- Más detección de pulso real en señales bajas, menos silencios prolongados.

### 6) Eliminar duplicación de SQI y validación
Archivos:
- `src/modules/signal-processing/PPGSignalProcessor.ts`
- `src/modules/vital-signs/VitalSignsProcessor.ts`

Cambios:
- Convertir `PPGSignalProcessor` en la única fuente de SQI de captura.
- `VitalSignsProcessor` debe consumir esa calidad, no recalcular otra incompatible.
- Mantener validaciones fisiológicas aparte, pero no otro SQI paralelo.

Impacto:
- Evita que una capa apruebe y otra rechace la misma ventana.

### 7) Reducir carga visual durante medición
Archivos:
- `src/components/CameraPreview.tsx`
- `src/components/PPGSignalMeter.tsx`
- `src/pages/Index.tsx`

Cambios:
- Evitar doble reproducción simultánea de video si no aporta al procesamiento.
- Simplificar el monitor en tiempo real durante captura:
  - menos redibujado,
  - menos re-detección gráfica de picos/vales en canvas,
  - usar marcadores ya calculados por la capa cardiaca.
- Mantener la visualización avanzada solo si no compromete el loop de señal.

Impacto:
- Menos jitter y mejor señal útil.

## Estrategias web recientes a aplicar

Basado en literatura/prácticas recientes:
- Acceso y calibración de cámara para PPG móvil con control consistente de exposición/flash.
- SQI óptimo y desacople entre contacto, movimiento y calidad usable.
- Análisis PPG más estandarizado por ventanas/ciclos tipo pyPPG.
- Entornos reproducibles y sensor-aware para no confiar en fps nominal sino real.

## Limpieza de código obsoleto/superpuesto

Eliminar o consolidar:
- Reset corto de 8 frames en `useHeartBeatProcessor`.
- SQI duplicado en `VitalSignsProcessor`.
- Lógica redundante de detección visual de picos en `PPGSignalMeter` cuando ya existen picos reales detectados.
- Cualquier dependencia de render UI para temporización de captura.

## Orden de implementación recomendado

1. Unificar estados de contacto y reset.
2. Cambiar captura a `requestVideoFrameCallback`.
3. Refactorizar `PPGSignalProcessor` a multi-source ranking.
4. Simplificar `HeartBeatProcessor` con fusión tiempo/frecuencia.
5. Eliminar SQI duplicado.
6. Reducir carga visual/cámara duplicada.
7. Exponer diagnóstico claro en UI del monitor:
   - contacto,
   - perfusión,
   - movimiento,
   - canal activo,
   - calidad real.

## Archivos principales afectados

- `src/pages/Index.tsx`
- `src/modules/signal-processing/PPGSignalProcessor.ts`
- `src/modules/HeartBeatProcessor.ts`
- `src/hooks/useHeartBeatProcessor.ts`
- `src/components/PPGSignalMeter.tsx`
- `src/components/CameraPreview.tsx`
- `src/modules/vital-signs/VitalSignsProcessor.ts`
- `src/types/signal.d.ts`

## Resultado esperado

- Detección de dedo mucho más tolerante a temblores y microdesplazamientos.
- Señal PPG más fuerte y continua.
- Recuperación de latidos incluso en señales débiles.
- Menos reinicios falsos y menos “caídas” de medición.
- Pipeline más limpio, sin capas superpuestas invalidándose entre sí.
