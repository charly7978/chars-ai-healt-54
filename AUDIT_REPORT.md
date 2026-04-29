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

### 🔄 Fase 2: MEDIA - PENDIENTE
4. **Unificar RingBuffer y CircularBuffer** (opcional)
5. **Consolidar umbrales SQI** en physics.ts
6. **Optimizar duplicación de detectCardiacCycles**

### 📋 Fase 3: BAJA - PENDIENTE
7. **Refactorizar UserBaselineEngine** para usar constantes nombradas
8. **Documentar todas las funciones públicas**
9. **Crear tests de integración** para flujo end-to-end

---

## ✅ ESTADO ACTUAL DE SIMULACIONES

**NO SE ENCONTRARON** simulaciones activas o valores aleatorios (Math.random) en el código de producción. 

El sistema parece estar libre de:
- ✅ Generación de datos falsos
- ✅ Valores aleatorios no deterministas  
- ✅ Fallbacks con valores "típicos" o "promedio"

Todos los valores por defecto son 0 (fail-closed design).

---

## 📊 MÉTRICAS

| Categoría | Count | Prioridad |
|-----------|-------|-----------|
| Constantes EMA duplicadas | 8 | ALTA |
| Coeficientes hardcodeados | 3 modelos | ALTA |
| Umbrales dispersos | 15+ | MEDIA |
| Implementaciones buffer | 2 | MEDIA |
| Valores base arbitrarios | 2 | MEDIA |

---

## 🔧 ARCHIVOS REQUERIDOS NUEVOS

1. `src/constants/model-coefficients.ts` - Centralizar coeficientes BP, Glucosa, Lípidos
2. `src/constants/quality-thresholds.ts` - Consolidar umbrales SQI
3. `src/utils/UnifiedBuffer.ts` - Reemplazar RingBuffer + CircularBuffer

---

*Reporte generado automáticamente - Requiere revisión humana*
