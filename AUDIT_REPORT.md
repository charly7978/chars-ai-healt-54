# AUDITORÍA DE CÓDIGO - PPG Health Monitor
## Fecha: Abril 2026
## Estado: CRÍTICO - Requiere optimización inmediata

---

## 🔴 HALLAZGOS CRÍTICOS

### 1. DUPLICACIÓN DE IMPLEMENTACIONES EMA
**Severidad: ALTA**

Múltiples implementaciones de EMA (Exponential Moving Average) dispersas:

| Archivo | Valor EMA | Línea |
|---------|-----------|-------|
| `GlucoseResearchProcessor.ts` | 0.20 | Línea 84 |
| `LipidResearchProcessor.ts` | 0.18 | Línea 42 |
| `BloodPressureProcessor.ts` | 0.22 | Línea 50 |
| `VitalSignsProcessor.ts` | 0.20 / 0.30 | Líneas 554+ |
| `Index.tsx` | 0.30 (EMA_ALPHA_UI) | Línea 145 |
| `DeviceCalibrationEngine.ts` | 0.10 | Implícito |
| `ChromaticGate.ts` | 0.10 | Usa CHROMA_EMA_ALPHA |

**Recomendación**: Unificar en `physics.ts`:
```typescript
export const EMA_ALPHA_STABLE = 0.20;
export const EMA_ALPHA_DYNAMIC = 0.30;
export const EMA_ALPHA_SLOW = 0.10;
export const EMA_ALPHA_FAST = 0.35;
```

---

### 2. BUFFERS CIRCULARES DUPLICADOS
**Severidad: MEDIA**

Dos implementaciones separadas:
- `RingBuffer.ts` - Usado en PPGSignalProcessor, HeartBeatProcessor
- `CircularBuffer.ts` - Usado en PPGSignalMeter

Funcionalidad similar pero APIs diferentes. Consolidar en una sola implementación genérica.

---

### 3. COEFICIENTES DE MODELOS HARDCODEADOS
**Severidad: ALTA**

Coeficientes de modelos biométricos dispersos:

#### BloodPressureProcessor.ts (Líneas 17-41)
```typescript
const SBP_COEFF = {
  intercept: 82.0, bDivA: -16.0, dDivA: 10.5, invSUT: 2500.0,
  SI: 7.5, AIx: 0.30, HR: 0.25, areaRatio: 5.0, AGI: 4.8,
  dicroticDepth: -8.0, pw75_pw25: 6.0,
};

const DBP_COEFF = {
  intercept: 42.0, PW50: 0.10, DT: 0.030, RMSSD: -0.07,
  dicroticDepth: -10.0, areaRatio: 3.8, SI: 2.8, HR: 0.12,
  pw50_sut_ratio: 2.5,
};
```

#### GlucoseResearchProcessor.ts (Líneas 59-73)
```typescript
const POP_COEFF = {
  intercept: 95.0, sutMs: 0.12, pw50Ms: 0.04, augIndex: 0.10,
  stiffness: 1.8, dicroticDepth: -10.0, areaRatio: 4.0,
  hr: 0.22, sdnn: -0.25, rmssd: -0.15, piGreen: -3.0,
  rgACRatio: 6.0, pw75_25Ratio: 12.0,
};
```

#### LipidResearchProcessor.ts (Líneas 82-100)
Valores base hardcodeados:
```typescript
let chol = 150.0;  // Base arbitraria
let trig = 120.0;  // Base arbitraria
```

**Recomendación**: Mover a `constants/model-coefficients.ts`

---

### 4. VALORES DE UMBRAL HARDCODEADOS
**Severidad: MEDIA**

Múltiples umbrales dispersos que deberían centralizarse:

| Archivo | Umbral | Contexto |
|---------|--------|----------|
| `SignalQualityEstimator.ts` | redDominance < 12 | Gate de hemoglobina |
| `SignalQualityEstimator.ts` | perfusionIndex < 0.003 | Gate de perfusión |
| `LivePpgEvidenceGate.ts` | MIN_PERFUSION_INDEX = 0.30 | Ya centralizado |
| `VitalSignsProcessor.ts` | signalQuality < 8 | Gate de calidad |
| `SpO2Processor.ts` | quality < 24 | Threshold variado |

**Recomendación**: Consolidar todos los umbrales SQI/quality en `physics.ts`

---

### 5. DUPLICACIÓN DE CÁLCULOS DE CICLOS CARDÍACOS
**Severidad: MEDIA**

La función `detectCardiacCycles` se llama desde:
- `VitalSignsProcessor.ts` (Línea 368)
- `BloodPressureProcessor.ts` (Línea 71 - con precomputedCycles)

Riesgo de cálculos duplicados por frame. Ya hay optimización parcial con `precomputedCycles` pero no es consistente.

---

### 6. IMPLEMENTACIONES DE SMOOTHING DUPLICADAS
**Severidad: BAJA**

Múltiples funciones `smoothValue`:
- `VitalSignsProcessor.ts` (Línea 554)
- UserBaselineEngine.ts usa EMA inline (Líneas 44-51)

---

## 🟡 HALLAZGOS MODERADOS

### 7. CONSTANTES DE TAMAÑO DE BUFFER DISPERSAS

| Archivo | Constante | Valor |
|---------|-----------|-------|
| `PPGSignalProcessor.ts` | BUF_SIZE | 360 |
| `HeartBeatProcessor.ts` | signalBuf | 360 |
| `VitalSignsProcessor.ts` | HISTORY_SIZE | 90 |
| `SignalQualityEngine.ts` | capacity | 420 |
| `GlucoseResearchProcessor.ts` | HISTORY_SIZE | 20 |
| `LipidResearchProcessor.ts` | HISTORY_SIZE | 15 |

Algunas ya están en `physics.ts` pero no todas se usan consistentemente.

---

### 8. VALORES DE CALIBRACIÓN HARDCODEADOS

UserBaselineEngine.ts:
```typescript
b.glucoseEma = b.glucoseEma > 0 ? b.glucoseEma * 0.88 + partial.glucoseEma * 0.12 : partial.glucoseEma;
```

Los valores 0.88/0.12 deberían ser constantes nombradas.

---

## 🟢 HALLAZGOS MENORES

### 9. IMPORTS DUPLICADOS
Algunos archivos importan tipos similares de múltiples fuentes.

### 10. DOCUMENTACIÓN INCONSISTENTE
Algunos archivos tienen comentarios extensos, otros carecen de documentación.

---

## ✅ OPTIMIZACIONES COMPLETADAS

### ✅ Fase 1: CRÍTICA - COMPLETADA
1. **Centralizar todas las constantes EMA** en `physics.ts` ✅
   - Agregadas: `EMA_ALPHA_SLOW`, `EMA_ALPHA_BIOMARKER`, `EMA_ALPHA_BP`, `EMA_ALPHA_RESEARCH_GLUCOSE`, `EMA_ALPHA_RESEARCH_LIPID`

2. **Crear archivo de coeficientes de modelos** centralizado ✅
   - Creado: `src/constants/model-coefficients.ts`
   - Centraliza: `SBP_COEFF`, `DBP_COEFF`, `GLUCOSE_COEFF`, `LIPID_BASE`, `LIPID_FACTORS`

3. **Actualizar procesadores biométricos** ✅
   - `GlucoseResearchProcessor.ts` - Usa `GLUCOSE_COEFF` y `EMA_ALPHA_RESEARCH_GLUCOSE`
   - `LipidResearchProcessor.ts` - Usa `LIPID_BASE`, `LIPID_FACTORS` y valores fail-closed (0)
   - `BloodPressureProcessor.ts` - Usa `SBP_COEFF`, `DBP_COEFF` y `EMA_ALPHA_BP`

### ✅ Fase 2: MEDIA - COMPLETADA
4. **Crear librería de utilidades matemáticas** ✅
   - Creado: `src/utils/mathUtils.ts` con funciones estadísticas centralizadas
   - Incluye: `median`, `mean`, `stdDev`, `variance`, `percentile`, `rmssd`, `pnn50`, etc.

5. **Eliminar duplicación de funciones median/std** ✅
   - Refactorizado `VitalSignsProcessor.ts` - usa `median` importado
   - Refactorizado `BloodPressureProcessor.ts` - usa `median` importado  
   - Refactorizado `RhythmClassifier.ts` - usa `median` y `stdDev` importados
   - Refactorizado `SpO2Processor.ts` - usa `median` importado
   - Eliminadas ~6 implementaciones duplicadas de `median`
   - Eliminadas ~2 implementaciones duplicadas de `std`/`stdDev`

### � Fase 3: BAJA - PARCIALMENTE COMPLETADA
6. **Unificar RingBuffer y CircularBuffer** - Determinado que tienen casos de uso diferentes:
   - `RingBuffer`: Para datos numéricos con operaciones estadísticas (Float64Array)
   - `CircularBuffer`: Para objetos PPGDataPoint con funciones específicas de marca de arritmia
   - ✅ Ambos tienen propósitos distintos, no requieren unificación

7. **Consolidar umbrales SQI restantes** - Identificados múltiples umbrales hardcodeados:
   - Se encontraron ~25+ umbrales dispersos en 11 archivos
   - Prioridad baja: la mayoría son parámetros internos de algoritmos específicos
   - No se centralizaron para mantener flexibilidad de cada módulo

8. **Documentar funciones públicas** - Parcialmente completado mediante:
   - ✅ `mathUtils.ts` completamente documentado
   - ✅ `model-coefficients.ts` completamente documentado
   - Resto del código mantiene comentarios existentes

9. **Crear tests de integración** - Pendiente para futura iteración

---

## ✅ ESTADO ACTUAL DE SIMULACIONES

**NO SE ENCONTRARON** simulaciones activas o valores aleatorios (Math.random) en el código de producción. 

El sistema parece estar libre de:
- ✅ Generación de datos falsos
- ✅ Valores aleatorios no deterministas  
- ✅ Fallbacks con valores "típicos" o "promedio"

Todos los valores por defecto son 0 (fail-closed design).

---

## 📊 MÉTRICAS FINALES

| Categoría | Antes | Después | Estado |
|-----------|-------|---------|--------|
| Constantes EMA duplicadas | 8 dispersas | Centralizadas en physics.ts | ✅ COMPLETADO |
| Coeficientes hardcodeados | 3 modelos locales | Centralizados en model-coefficients.ts | ✅ COMPLETADO |
| Funciones median duplicadas | ~6 implementaciones | 1 centralizada en mathUtils.ts | ✅ COMPLETADO |
| Funciones std duplicadas | ~2 implementaciones | 1 centralizada en mathUtils.ts | ✅ COMPLETADO |
| Valores base arbitrarios | 150/120 mg/dL | 0 (fail-closed) | ✅ COMPLETADO |
| Umbrales SQI dispersos | 25+ en 11 archivos | Documentados, no centralizados | 🔄 PARCIAL |

---

## � ARCHIVOS CREADOS

1. ✅ `src/constants/model-coefficients.ts` - Coeficientes de modelos biométricos centralizados
2. ✅ `src/utils/mathUtils.ts` - Librería de utilidades matemáticas

---

## 📝 ARCHIVOS MODIFICADOS

### Constantes y Coeficientes:
- `src/constants/physics.ts` - Agregadas 5 constantes EMA adicionales

### Procesadores Biométricos:
- `src/modules/biomarkers/GlucoseResearchProcessor.ts` - Usa `GLUCOSE_COEFF`, `EMA_ALPHA_RESEARCH_GLUCOSE`
- `src/modules/biomarkers/LipidResearchProcessor.ts` - Usa `LIPID_BASE` (0), `LIPID_FACTORS`, `EMA_ALPHA_RESEARCH_LIPID`
- `src/modules/vital-signs/BloodPressureProcessor.ts` - Usa `SBP_COEFF`, `DBP_COEFF`, `EMA_ALPHA_BP`, `median` importado

### Procesadores de Señal:
- `src/modules/vital-signs/VitalSignsProcessor.ts` - Usa `median` importado de mathUtils
- `src/modules/vital-signs/RhythmClassifier.ts` - Usa `median` y `stdDev` importados de mathUtils
- `src/modules/vital-signs/SpO2Processor.ts` - Usa `median` importado de mathUtils

---

## ✅ RESUMEN DE OPTIMIZACIONES

### Completadas (100%):
1. ✅ Eliminación de console.log debugging en CameraView.tsx
2. ✅ Centralización de constantes EMA en physics.ts
3. ✅ Centralización de coeficientes de modelos en model-coefficients.ts
4. ✅ Conversión de valores base a fail-closed (0) en LipidResearchProcessor
5. ✅ Eliminación de ~6 implementaciones duplicadas de `median`
6. ✅ Eliminación de ~2 implementaciones duplicadas de `std`/`stdDev`
7. ✅ Creación de librería mathUtils.ts con funciones estadísticas

### Parcialmente Completadas:
8. 🔄 Revisión de Elgendi synthesization - umbral ajustado a 90%
9. 🔄 Refactorización de chromatic gate a módulo separado
10. 🔄 Simplificación de comentarios excesivos

### Determinadas No Necesarias:
11. ❌ Unificación de RingBuffer y CircularBuffer (casos de uso diferentes)
12. ❌ Centralización de todos los umbrales SQI (mantener flexibilidad por módulo)

---

*Auditoría completada - Mayo 2026*
