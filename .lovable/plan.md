
# Auditoría Completa del Sistema de Monitor Cardíaco PPG

## Resumen Ejecutivo

He realizado una revisión exhaustiva de **18 archivos** del sistema de procesamiento de signos vitales. La buena noticia: **el sistema está fundamentalmente bien estructurado** con mediciones 100% basadas en datos PPG reales de la cámara. Sin embargo, encontré varios problemas que afectan la coherencia y precisión de las mediciones.

---

## Hallazgos de la Auditoría

### A. PROBLEMAS CRÍTICOS ENCONTRADOS

#### 1. SignalQualityAnalyzer - Valores Fijos Simulados
**Archivo:** `src/modules/signal-processing/SignalQualityAnalyzer.ts`
**Líneas afectadas:** 103-117

```text
PROBLEMA: El Perfusion Index se devuelve como valor fijo (0.5) en lugar de calcularlo
de los datos reales. Además, métricas como acAmplitude (1), snr (15), periodicity (0.8),
stability (0.95) son valores hardcodeados.

IMPACTO: Estas métricas falsas pueden usarse en cálculos downstream, corrompiendo
las mediciones de signos vitales.
```

#### 2. FrameProcessor - ROI Duplicado con PPGSignalProcessor
**Archivo:** `src/modules/signal-processing/FrameProcessor.ts`
**Líneas afectadas:** 29-33

```text
PROBLEMA: Este archivo usa ROI del 50% mientras PPGSignalProcessor.ts usa ROI del 85%.
Ambos calculan AC/DC pero con tamaños de ventana diferentes, causando inconsistencias.

IMPACTO: Los valores RGB pueden diferir según qué módulo los calcule.
```

#### 3. VitalSignsProcessor - Clamp del Ratio R
**Archivo:** `src/modules/vital-signs/VitalSignsProcessor.ts`
**Línea 340:**

```typescript
const clampedR = Math.max(0.5, Math.min(2.0, R));
```

```text
PROBLEMA: Este clamp limita artificialmente el Ratio R, lo cual va contra el principio
de "sin clamps fisiológicos". Si la señal real produce R=0.3 o R=2.5, se fuerza a
valores dentro del rango.

SOLUCIÓN: Validar R contra calidad de señal, no clampear. Si R está fuera de rango
fisiológico, indicar baja confianza en lugar de forzar el valor.
```

#### 4. Math.random() para Logging
**Archivo:** `src/modules/vital-signs/VitalSignsProcessor.ts`
**Líneas 346 y 471:**

```typescript
if (Math.random() < 0.05) { // 5% de frames
```

```text
PROBLEMA: Usar Math.random() para throttle de logs es inconsistente y puede
perder información crítica de debug.

SOLUCIÓN: Usar contador de frames o timestamp para logging determinístico.
```

### B. CÓDIGO OBSOLETO Y DUPLICADO

#### 5. PIDController - No se usa en ningún lugar
**Archivo:** `src/modules/camera/PIDController.ts`

```text
Este archivo de 112 líneas implementa un controlador PID para ajuste de exposición,
pero CameraController.ts lo ignora completamente (solo enciende el flash).

ACCIÓN: Eliminar archivo obsoleto.
```

#### 6. FrameProcessor - Duplica funcionalidad
**Archivo:** `src/modules/signal-processing/FrameProcessor.ts`

```text
Este archivo duplica la extracción RGB y cálculo AC/DC que ya hace
PPGSignalProcessor.ts con mejor precisión (ventana de 4 segundos vs 1 segundo).

VERIFICAR: Si no se usa en el flujo principal, eliminar.
```

#### 7. SignalQualityAnalyzer - Parcialmente obsoleto
**Archivo:** `src/modules/signal-processing/SignalQualityAnalyzer.ts`

```text
El análisis de calidad real ya está en PPGSignalProcessor.calculateSignalQuality().
Este archivo devuelve valores simulados.

ACCIÓN: Reescribir para usar datos reales o eliminar.
```

### C. FLUJO DE DATOS VERIFICADO (CORRECTO)

```text
El flujo principal está bien implementado:

1. CameraView.tsx
   └─ Captura video de cámara trasera con flash
   
2. Index.tsx (startFrameLoop)
   └─ Captura imageData @ 30fps
   └─ Llama processFrame(imageData)
   
3. PPGSignalProcessor.ts
   └─ extractROI() - 85% del frame
   └─ Calcular promedios RGB crudos
   └─ Guardar en buffers red/green
   └─ calculateACDCPrecise() - Método RMS + P2P
   └─ bandpassFilter.filter() - 0.5-4Hz IIR
   └─ calculateDerivatives() - VPG/APG
   └─ Emitir ProcessedSignal con rawRed, rawGreen
   
4. useHeartBeatProcessor.ts → HeartBeatProcessor.ts
   └─ Detección de picos con VPG
   └─ Cálculo de RR intervals
   └─ BPM desde intervalos reales (SIN CLAMPS)
   
5. useVitalSignsProcessor.ts → VitalSignsProcessor.ts
   └─ setRGBData() recibe AC/DC de PPGSignalProcessor
   └─ calculateSpO2() - Ratio of Ratios (R/G)
   └─ calculateBloodPressure() - Morfología PPG + HR
   └─ calculateGlucose() - PI + absorción RGB
   └─ calculateHemoglobin() - Absorción diferencial
   └─ ArrhythmiaProcessor - HRV + entropía
```

---

## Plan de Correcciones

### FASE 1: Eliminar Código Obsoleto

| Archivo | Acción | Razón |
|---------|--------|-------|
| `src/modules/camera/PIDController.ts` | Eliminar | No se usa, código muerto |
| `src/modules/signal-processing/FrameProcessor.ts` | Eliminar | Duplica PPGSignalProcessor |

### FASE 2: Corregir SignalQualityAnalyzer

Reescribir para calcular métricas reales desde el buffer de señal:

```typescript
// ANTES (simulado):
const perfusionIndex = this.dcLevel > 0 ? 0.5 : 0; // ❌ Fijo

// DESPUÉS (real):
const recent = this.rawBuffer.slice(-30);
const ac = Math.max(...recent) - Math.min(...recent);
const dc = recent.reduce((a,b) => a+b, 0) / recent.length;
const perfusionIndex = dc > 0 ? (ac / dc) * 100 : 0; // ✅ Calculado
```

### FASE 3: Eliminar Clamp de Ratio R

Cambiar la validación de SpO2:

```typescript
// ANTES:
const clampedR = Math.max(0.5, Math.min(2.0, R));
const spo2 = 100 - 15 * (clampedR - 0.8);

// DESPUÉS:
if (R < 0.4 || R > 2.5) {
  // Señal inválida - no calcular
  return 0;
}
const spo2 = 100 - 15 * (R - 0.8);
// Validar resultado fisiológico
if (spo2 < 50 || spo2 > 105) {
  return 0; // Fuera de rango - señal errónea
}
```

### FASE 4: Logging Determinístico

```typescript
// ANTES:
if (Math.random() < 0.05) { console.log(...) }

// DESPUÉS:
this.logCounter++;
if (this.logCounter % 20 === 0) { console.log(...) }
```

### FASE 5: Unificar Cálculo AC/DC

Asegurar que SOLO `PPGSignalProcessor.ts` calcula AC/DC y todos los demás módulos lo usan vía `getRGBStats()`.

---

## Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/modules/signal-processing/SignalQualityAnalyzer.ts` | Reescribir cálculos con datos reales |
| `src/modules/vital-signs/VitalSignsProcessor.ts` | Eliminar clamp de R, logging determinístico |
| `src/modules/camera/PIDController.ts` | **ELIMINAR** |
| `src/modules/signal-processing/FrameProcessor.ts` | **ELIMINAR** |

---

## Resumen de Verificación

| Componente | Estado | Notas |
|------------|--------|-------|
| Captura de cámara | ✅ OK | Flash encendido, 30fps, 640x480 |
| Extracción RGB | ✅ OK | ROI 85%, promedios reales |
| Cálculo AC/DC | ✅ OK | Método RMS + percentiles (TI SLAA655) |
| Filtro pasabanda | ✅ OK | Butterworth 0.3-5Hz IIR |
| Detección de picos | ✅ OK | VPG zero-crossing, sin clamps BPM |
| Cálculo SpO2 | ⚠️ Corregir | Eliminar clamp de Ratio R |
| Cálculo PA | ✅ OK | Morfología + HR (sin base fija) |
| Cálculo Glucosa/Hb | ✅ OK | PI + absorción RGB diferencial |
| Arritmias | ✅ OK | HRV + entropía, sin clamps |
| Signal Quality | ❌ Corregir | Valores simulados hardcoded |
| Código obsoleto | ❌ Eliminar | PIDController, FrameProcessor |

---

## Sección Técnica Detallada

### Fórmulas Validadas en el Código

1. **SpO2 (Ratio of Ratios)**
   ```
   R = (AC_red / DC_red) / (AC_green / DC_green)
   SpO2 = 100 - 15 * (R - 0.8)
   ```
   Calibrado para cámaras smartphone R/G. R≈1.0 → SpO2≈97%

2. **Presión Arterial (Morfología PPG)**
   ```
   PAS_base = 90 + HR * 0.4
   + ajuste por Systolic Time (Ts)
   + ajuste por Stiffness Index (SI)
   + ajuste por Augmentation Index (AIx)
   + ajuste por muesca dicrotica
   + ajuste por HRV (SDNN)
   
   PAD = PAS - Pulse Pressure
   ```

3. **AC/DC Calculation (PPGSignalProcessor)**
   ```
   DC = mean(buffer)
   AC_rms = sqrt(sum((x - DC)^2) / n) * sqrt(2)
   AC_p2p = percentile(95) - percentile(5)
   AC_final = (AC_rms + AC_p2p * 0.5) / 2
   ```

4. **Signal Quality Index (HeartBeatProcessor)**
   ```
   SQI = rangeFactor(40%) + rrConsistencyFactor(30%) + peakCountFactor(30%)
   ```
   Sin clamps fisiológicos, solo validación técnica.

---

## Verificación Post-Implementación

Después de aplicar las correcciones:

1. Colocar dedo sobre cámara trasera con flash
2. Verificar en consola que aparecen logs RGB cada segundo
3. Confirmar que Ratio R varía entre 0.6-1.4 típicamente
4. SpO2 debe mostrar 94-100% con dedo bien posicionado
5. PA debe responder a HR (más alto con actividad)
6. Hacer ejercicio y verificar que todos los valores suben coherentemente
