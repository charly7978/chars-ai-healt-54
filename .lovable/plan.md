

# Plan: Garantizar Lecturas PPG Reales — Eliminar Falsos Positivos

## Problema Identificado

Tras auditar el pipeline completo, hay **5 puntos críticos** donde señales falsas (ruido ambiental, luz, movimiento) pueden disparar reacciones en la app como si fueran señal real:

### 1. Detección de dedo demasiado permisiva
- `detectFingerInstant()` acepta `r > 25` y `coverage > 0.12` — valores que ruido ambiental o luz de habitación pueden alcanzar
- `softHold` mantiene contacto con `smoothedCoverage > 0.08` — prácticamente cualquier imagen
- No valida la **firma espectral de hemoglobina** (rojo debe dominar significativamente sobre verde/azul cuando hay dedo con flash)

### 2. HeartBeatProcessor acepta señal sin energía mínima
- `normalizeSignal` usa `range < 0.15` como umbral mínimo — demasiado bajo, ruido normalizado puede parecer pulsátil
- `minScore = 25` para primeros picos — alcanzable por ruido con cualquier cruce por cero
- No hay **gate de perfusión**: acepta "latidos" incluso cuando AC/DC es cero

### 3. Frecuencia espectral reemplaza picos sin validación
- Cuando `smoothBPM === 0`, la autocorrelación (`frequencyBPM`) se muestra directamente
- La autocorrelación puede encontrar "periodicidad" en ruido con `bestScore > 0.15` — umbral muy bajo
- Resultado: BPM aparece antes de detectar un solo latido real

### 4. Signos vitales se calculan sin gate de calidad
- `processVitalSigns` se llama cuando hay ≥3 RR intervals, sin verificar si la calidad es suficiente
- SpO2, presión, etc. se calculan sobre señal potencialmente ruidosa

### 5. Canal CHROM amplifica ruido
- `CHROM: (3R - 2G)` amplifica diferencias R-G que pueden ser ruido óptico puro cuando no hay dedo

## Cambios Propuestos

### A. `PPGSignalProcessor.ts` — Detección de dedo estricta

**Umbrales de hemoglobina reales:**
- `rawRed > 80` (no 25) — con flash y dedo, el rojo siempre supera 80
- `rgRatio > 1.2` (no 0.8) — la hemoglobina absorbe verde/azul, rojo SIEMPRE domina
- `redDominance > 20` (no 5) — diferencia real dedo vs ambiente
- `coverage > 0.35` (no 0.12) — dedo cubre significativamente el sensor
- `fingerScore > 0.4` (no 0.28)
- Para mantener contacto: `coverage > 0.20`, `redDominance > 12`, `rgRatio > 1.1`

**Nuevo requisito de perfusión mínima para STABLE_CONTACT:**
- Solo transicionar a STABLE cuando `perfusionIndex > 0.01` (hay pulsatilidad real AC/DC)
- Si hay contacto pero perfusión = 0, mantener en UNSTABLE

**Eliminar canal CHROM del ranking** — es redundante y amplifica ruido sin dedo

### B. `HeartBeatProcessor.ts` — Gate de señal real

**Antes de detectar cualquier pico:**
- Nuevo parámetro `minimumSignalRange = 0.8` — si el rango normalizado de la ventana es < 0.8, rechazar (ruido puro tiene rango bajo post-filtro)
- `minScore = 40` siempre (no 25 para señal débil) — un latido real siempre tiene prominencia + morfología
- `energy < 2000` en `estimatePeriodicity` en vez de 800 — evita que ruido de baja energía genere BPM espectral

**Bloquear frequencyBPM sin validación cruzada:**
- No mostrar `frequencyBPM` como displayBPM hasta que haya al menos 1 pico confirmado en tiempo
- `periodicityScore` mínimo de 0.35 (no 0.15) para aceptar estimación espectral

**Aumentar prominencia mínima:**
- `prominence > 3.0` para aceptar pico (no cualquier valor > 0)
- Pico debe tener `risingSlope > 1.0` Y `fallingSlope > 0.5` — morfología PPG real tiene subida rápida y bajada gradual

### C. `Index.tsx` — Gate de calidad para signos vitales

- Solo llamar `processVitalSigns` cuando `signalQuality > 25` Y `heartBeatResult.confidence > 0.2`
- No mostrar BPM hasta `confidence > 0.3` y al menos 3 picos consecutivos

### D. `PPGSignalProcessor.ts` — SQI más estricto

- Si `perfusionIndex < 0.005`, SQI máximo = 15 (insuficiente para medición)
- Si `redDominance < 15` en smoothed values, SQI = 0
- Bonificar solo cuando hay evidencia de pulsatilidad real (AC > 0 en al menos un canal)

## Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/modules/signal-processing/PPGSignalProcessor.ts` | Umbrales dedo estrictos, eliminar CHROM, gate perfusión, SQI estricto |
| `src/modules/HeartBeatProcessor.ts` | Gate energía mínima, prominencia mínima, bloquear freq sin picos |
| `src/pages/Index.tsx` | Gate calidad para vitals, no mostrar BPM sin confianza |

## Resultado

- **Sin dedo** → la app NO muestra BPM, NO detecta latidos, NO calcula vitales
- **Con dedo pero sin pulso detectable** → muestra "buscando señal" sin inventar valores
- **Con dedo y pulso real** → detecta y muestra datos reales con confianza
- Filosofía: "sin lectura antes que lectura falsa"

