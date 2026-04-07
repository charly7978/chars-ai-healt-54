

# Plan: Mejorar Algoritmos de Medición — Mantener TODAS las Métricas con Enfoques Avanzados

## Contexto

El usuario quiere CONSERVAR todas las mediciones (glucosa, hemoglobina, colesterol/triglicéridos) pero reemplazar las fórmulas ad-hoc actuales con los mejores algoritmos disponibles basados en literatura científica reciente. También corregir los problemas pendientes: detección de dedo inestable, calibración BP que duplica valores, y bloqueo de exposición de cámara.

## Problemas Identificados

1. **Glucosa** (`calculateGlucoseRaw`): Coeficientes inventados (`acDcRatio * 2000`, `hr * 0.5`). No usa features basados en literatura.
2. **Hemoglobina** (`calculateHemoglobinRaw`): Coeficientes inventados (`rgRatio * 8`). No usa ratio Beer-Lambert correctamente.
3. **Lípidos** (`calculateLipidsRaw`): Coeficientes inventados (`stiffnessIndex * 15`). No aprovecha features de rigidez arterial según literatura.
4. **Cámara**: No bloquea exposición/ISO/WB → oscilaciones falsas en señal PPG.
5. **Detección de dedo**: Aún inestable con temblores según usuario.
6. **Calibración BP**: Puede seguir dando problemas de duplicación en ciertos escenarios edge.

## Cambios Planificados

### 1. CameraView — Bloqueo de Exposición/ISO/WB
**Archivo**: `src/components/CameraView.tsx`

Después de activar el flash (paso 5), aplicar constraints para bloquear parámetros automáticos:
- `exposureMode: 'manual'` con compensación baja (~20%)
- `whiteBalanceMode: 'manual'`  
- ISO bajo para evitar saturación con flash en contacto directo
- Esto elimina oscilaciones falsas que contaminan la señal

### 2. PPGSignalProcessor — Detección de Dedo más Tolerante + IMU
**Archivo**: `src/modules/signal-processing/PPGSignalProcessor.ts`

- Aumentar `FINGER_LOST_FRAMES` a 30 (~1 segundo de tolerancia)
- Reducir `FINGER_CONFIRM_FRAMES` a 3 para detección más rápida
- Reducir umbral mínimo de rojo a 25
- Agregar listener de `DeviceMotionEvent` para calcular `motionScore`
- Cuando hay movimiento moderado: reducir confianza pero NO descartar señal
- Emitir `motionArtifact` en señal procesada

### 3. Glucosa — Algoritmo Basado en Literatura (Islam et al. 2021, IEEE)
**Archivo**: `src/modules/vital-signs/VitalSignsProcessor.ts`

Reemplazar `calculateGlucoseRaw()` con modelo basado en:
- **Features PLS/SVR** de Islam et al.: systolic peak, diastolic peak, ΔT (peak-to-peak), primera derivada peaks, segunda derivada peaks
- **Features adicionales** de Satter et al. 2024: AC/DC ratio, pulse interval variability, perfusion index, augmentation index
- Modelo de regresión lineal multivariable con coeficientes calibrados desde literatura
- Usar `PPGFeatureExtractor.extractCycleFeatures()` (ya implementado) en vez de `extractAllFeatures()` legacy

### 4. Hemoglobina — Beer-Lambert Multichannel (arXiv 2025)
**Archivo**: `src/modules/vital-signs/VitalSignsProcessor.ts`

Reemplazar `calculateHemoglobinRaw()` con:
- **AC/DC ratios por canal** (R y G) — ya disponibles desde `PPGSignalProcessor.getRGBStats()`
- **Logarithmic attenuation**: `ln(AC/DC)` por canal, que correlaciona linealmente con concentración de Hb según Beer-Lambert
- **Cross-channel ratio**: `ln(AC_R/DC_R) / ln(AC_G/DC_G)` como proxy de absorción diferencial
- Coeficientes de regresión calibrados desde Nature Scientific Reports 2024
- Validación: solo emitir cuando perfusion index > 0.1% y señal estable

### 5. Colesterol/Triglicéridos — Rigidez Arterial (Ferizoli et al. 2024, Arguello-Prada 2025)
**Archivo**: `src/modules/vital-signs/VitalSignsProcessor.ts`

Reemplazar `calculateLipidsRaw()` con:
- **Features de rigidez arterial** (correlación demostrada con colesterol):
  - Stiffness Index, Augmentation Index, PWV proxy (ya extraídos por `extractCycleFeatures`)
  - Area-related features (systolicArea, diastolicArea, IPA ratio) — strongest correlators según Ferizoli 2024
  - Pulse width a múltiples niveles (PW10, PW25, PW50, PW75)
- **Modelo multivariable** con coeficientes basados en Arguello-Prada et al. 2025
- Triglicéridos desde viscosidad (pulse width + diastolic time + perfusion)

### 6. Refactorizar calculateVitalSigns para Usar CycleFeatures
**Archivo**: `src/modules/vital-signs/VitalSignsProcessor.ts`

El método `calculateVitalSigns()` actualmente usa `extractAllFeatures()` (legacy). Cambiarlo para:
- Usar `PPGFeatureExtractor.detectCardiacCycles()` + `extractCycleFeatures()` (la API moderna ya implementada)
- Calcular median features de los ciclos válidos (como ya hace `BloodPressureProcessor`)
- Pasar estos cycle features a glucosa, hemoglobina y lípidos
- Esto unifica el pipeline y elimina código duplicado

### 7. Calibración BP — Fix Edge Case de Baseline Cero
**Archivo**: `src/modules/vital-signs/BloodPressureProcessor.ts`

- Cuando `baselineSystolic` es 0 al momento de calibrar, usar un gain conservador (0.3) en vez de 0.45
- Agregar guard: si `systolicRef` es más del doble del baseline, limitar la corrección

### 8. Signal Type Update
**Archivo**: `src/types/signal.d.ts`

- Agregar `motionArtifact?: boolean` a `ProcessedSignal`

### 9. Disclaimers en UI
**Archivo**: `src/pages/Index.tsx`

- Agregar indicador "EST." (estimación) junto a glucosa, hemoglobina y colesterol
- Mantener todos los VitalSign visibles en el grid 3x2

## Archivos Afectados

| Archivo | Acción |
|---|---|
| `src/components/CameraView.tsx` | Bloqueo exposición/ISO/WB |
| `src/modules/signal-processing/PPGSignalProcessor.ts` | Dedo tolerante + IMU |
| `src/modules/vital-signs/VitalSignsProcessor.ts` | Refactorizar glucose/Hb/lipids con algoritmos de literatura |
| `src/modules/vital-signs/BloodPressureProcessor.ts` | Fix calibración edge case |
| `src/modules/vital-signs/PPGFeatureExtractor.ts` | Limpieza legacy (mantener extractAllFeatures pero deprecar) |
| `src/types/signal.d.ts` | Agregar motionArtifact |
| `src/pages/Index.tsx` | Agregar "EST." a métricas experimentales |

## Resultado

- **TODAS** las mediciones se mantienen en la UI
- Algoritmos basados en publicaciones reales (2024-2025)
- Detección de dedo más cómoda y tolerante
- Cámara con parámetros bloqueados para señal PPG limpia
- Calibración BP corregida
- Cada métrica experimental marcada como "ESTIMACIÓN"

