

# Plan: Reemplazar Sistema de Presión Arterial con Algoritmos Avanzados

## Análisis del Código Actual

El método `calculateBloodPressureFromMorphology()` en `VitalSignsProcessor.ts` (líneas 410-513) usa un modelo empírico ad-hoc con coeficientes inventados (ej. `180 - systolicTimeMs * 0.4`, `stiffnessIndex * 12`, `hr * 0.35`). Estos coeficientes no tienen base en literatura y producen estimaciones no calibradas. El extractor de features (`PPGFeatureExtractor.ts`) tiene implementaciones básicas correctas conceptualmente pero con limitaciones en robustez.

## Evidencia Científica (2024-2025)

Basado en la revisión de literatura actual:

1. **Elgendi 2024 (Diagnostics)**: Los ratios **b/a** y **d/a** de la segunda derivada (APG) son los predictores más significativos de presión sistólica
2. **Frontiers Digital Health 2025**: PPG verde reflectivo contiene marcadores confiables de BP que superan modelos basados solo en datos demográficos
3. **Nature Scientific Reports 2025**: PWV estimado desde PPG con visibility graphs y features morfológicos
4. **PMC 2024 (pyPPG)**: Librería con 632 features por ciclo cardíaco, estandarización de extracción de features PPG
5. **arxiv 2025**: Benchmarking de modelos cuffless BP confirma que features morfológicos + ML superan modelos lineales simples

## Cambios Planificados

### 1. Nuevo archivo: `src/modules/vital-signs/BloodPressureProcessor.ts`

Procesador dedicado de presión arterial con:

- **Detección precisa de fiducial points**: onset, systolic peak, dicrotic notch, diastolic peak por ciclo cardíaco usando primera y segunda derivada
- **74 features morfológicos por ciclo** (basado en pyPPG/PMC 2024):
  - Temporales: systolic upstroke time (SUT), diastolic time (DT), pulse width at 10/25/50/75% de amplitud, time to dicrotic notch
  - Amplitud: systolic amplitude, diastolic amplitude, dicrotic notch amplitude, inflection point area ratio (IPA)
  - Derivadas: VPG features (w, y, z points), APG features (a, b, c, d, e) con ratios b/a, c/a, d/a, e/a, AGI
  - Área: systolic area, diastolic area, area ratio
- **Modelo de regresión multivariable** calibrado con coeficientes de literatura (Elgendi, Mukkamala):
  - SBP = f(b/a, d/a, SUT, SI, AIx, HR, PWV_proxy, IPA)
  - DBP = f(pulse_width, diastolic_time, RMSSD, dicrotic_depth, area_ratio)
- **Estimación de PWV** desde timing entre systolic peak y reflected wave (sin ECG)
- **Sistema de confianza multi-nivel**: requiere mínimo 5 ciclos cardíacos limpios, reporta calidad por feature
- **Calibración personal opcional**: el usuario puede ingresar una medición de referencia con manguito para ajustar offset

### 2. Refactorizar `PPGFeatureExtractor.ts`

- Agregar detección robusta de fiducial points con validación cruzada entre primera derivada (VPG) y segunda derivada (APG)
- Agregar features de área (integral sistólica/diastólica)
- Agregar pulse width a múltiples niveles de amplitud (10%, 25%, 50%, 75%)
- Mejorar extracción del Stiffness Index usando timing peak-to-peak validado
- Agregar Inflection Point Area ratio (IPA = area_systolic / area_diastolic)

### 3. Actualizar `VitalSignsProcessor.ts`

- Reemplazar `calculateBloodPressureFromMorphology()` por delegación al nuevo `BloodPressureProcessor`
- Eliminar todos los coeficientes ad-hoc actuales (líneas 431-513)
- Requerir mínimo 5 ciclos cardíacos completos antes de reportar BP (no 3 intervalos como ahora)

### 4. Modelo de Estimación (sin ML pesado, viable en browser)

Basado en regresión ridge con features seleccionados por correlación de literatura:

```text
SBP = β0 + β1*(b/a) + β2*(d/a) + β3*(1/SUT) + β4*SI + β5*AIx + β6*HR + β7*PWV + β8*IPA
DBP = γ0 + γ1*(pulse_width_50) + γ2*(diastolic_time) + γ3*RMSSD + γ4*(dicrotic_depth) + γ5*(area_ratio)
```

Los coeficientes β y γ se tomarán de valores publicados en literatura (Elgendi 2024, Mukkamala 2022) con ajuste por calibración personal cuando esté disponible.

### 5. Eliminaciones

- Eliminar fórmulas con coeficientes inventados (`180 - systolicTimeMs * 0.4`, etc.)
- Eliminar el ratio diastólico fijo (`diastolicRatio = 1.5`)
- Eliminar ajustes ad-hoc por perfusión/pulseWidth en DBP

### Disclaimer en UI

El resultado se mostrará como "ESTIMACIÓN" con indicador de confianza, nunca como valor diagnóstico.

## Archivos Afectados

| Archivo | Acción |
|---|---|
| `src/modules/vital-signs/BloodPressureProcessor.ts` | Crear nuevo |
| `src/modules/vital-signs/PPGFeatureExtractor.ts` | Refactorizar features |
| `src/modules/vital-signs/VitalSignsProcessor.ts` | Reemplazar método BP |

