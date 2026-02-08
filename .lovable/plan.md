
# Plan de Reestructuracion Completa del Sistema PPG

## Estado: ✅ IMPLEMENTADO (2026-02-08)

Este plan implementa una arquitectura PPG profesional basada en las especificaciones proporcionadas, eliminando codigo obsoleto y garantizando que todas las mediciones sean 100% derivadas de los datos de la camara en tiempo real.

### Fases Completadas:
- ✅ Fase 1: SignalQualityAnalyzer con SQI robusto (FFT-based SNR, PI, clipping, estabilidad)
- ✅ Fase 2: PPGSignalProcessor con detrending, AC/DC profesional, selección de canal
- ✅ Fase 3: HeartBeatProcessor con zero-crossing VPG, refinamiento sub-frame, mediana RR
- ✅ Fase 4: VitalSignsProcessor 100% PPG (SpO2 Ratio-of-Ratios, BP morfológica)
- ✅ Fase 5: useSignalProcessor integrado con QualityResult
- ✅ Fase 6: FrameProcessor.ts eliminado (obsoleto)

---

## Analisis del Estado Actual

### Problemas Identificados

1. **Flujo de datos fragmentado**: Multiples procesadores independientes sin pipeline unificado
2. **Formulas inconsistentes**: SpO2, BP y otras metricas usan calculos que no responden proporcionalmente a cambios reales
3. **Deteccion de dedo poco robusta**: Criterios demasiado laxos que permiten lecturas con ruido
4. **Sin validacion SQI robusta**: El Signal Quality Index no gobierna efectivamente la visualizacion
5. **Detrending ausente**: No hay remocion de deriva lenta de la senal
6. **Sin deteccion de artefactos de movimiento**: No se usa IMU/acelerometro para gating

### Arquitectura Actual (a reemplazar)

```text
CameraView
    |
    v
Index.tsx (frame loop)
    |
    v
PPGSignalProcessor (extraccion RGB + filtrado)
    |
    +---> HeartBeatProcessor (deteccion picos)
    |
    +---> VitalSignsProcessor (SpO2, BP, etc.)
    |
    v
UI (PPGSignalMeter + VitalSign displays)
```

---

## Nueva Arquitectura Propuesta

### Diagrama de Flujo Profesional

```text
[CAMARA 30fps + Flash]
         |
         v
[A] Camera Controller
    - Torch ON
    - Exposicion/ISO estables
    - 640x480 @ 30fps
         |
         v
[B] ROI Manager  
    - ROI central 85%
    - Deteccion de cobertura del lente
    - Validacion de luminosidad
         |
         v
[C] Signal Extraction Engine
    - RGB promedio por frame
    - Canal primario: VERDE (mejor SNR)
    - Fallback a ROJO si saturacion
         |
         v
[D] Preprocessing Pipeline
    - Detrending (remover deriva lenta)
    - Bandpass Butterworth 0.5-4Hz
    - Savitzky-Golay smoothing
    - Deteccion de outliers
         |
         v
[E] Signal Quality Index (SQI)
    - SNR de banda cardiaca
    - Perfusion Index (AC/DC * 100)
    - Porcentaje de clipping
    - Estabilidad temporal
    - GOVERNA toda la UI
         |
         v
[F] Beat/Rhythm Engine
    - Deteccion de picos (derivada + zero-crossing)
    - Refinamiento sub-frame (interpolacion)
    - Intervalos RR precisos
    - Deteccion de irregularidad
         |
         v
[G] Vital Signs Estimators
    - BPM: 60000 / avgRR
    - SpO2: Ratio-of-Ratios (110 - 25*R)
    - BP: Morfologia + HR + calibracion
    - HRV: SDNN, RMSSD, pNN50
         |
         v
[H] UI Monitor
    - Onda desplazandose (rolling)
    - BPM grande + SQI barra
    - SpO2 con indicador de confianza
    - Alertas por arritmia
```

---

## Implementacion Detallada

### Modulo A: Camera Controller (Optimizado)

**Archivo**: `src/modules/camera/CameraController.ts`

**Cambios**:
- Mantener torch ON como unica funcion
- Agregar validacion de capacidades de camara

### Modulo B: ROI Manager (Nuevo)

**Archivo**: `src/modules/signal-processing/ROIManager.ts`

**Funcionalidad**:
- Extraer ROI central del 85% (ya implementado en PPGSignalProcessor)
- Agregar **deteccion de cobertura del lente**:
  - Verificar que la luminosidad es uniforme en toda la ROI
  - Detectar bordes oscuros que indican dedo mal posicionado
- Agregar **deteccion de dedo robusta**:
  - Red > 80 (no 40)
  - Ratio R/G entre 1.0 y 4.0
  - No saturacion (< 253)
  - Validacion temporal de 5 frames consecutivos

### Modulo C: Signal Extraction Engine (Mejorado)

**Archivo**: `src/modules/signal-processing/PPGSignalProcessor.ts`

**Cambios Criticos**:

1. **Seleccion de canal inteligente**:
   ```typescript
   // VERDE tiene mejor SNR para PPG contacto
   // Solo usar ROJO si verde esta saturado (>250)
   const primaryChannel = greenAvg < 250 ? greenAvg : redAvg;
   ```

2. **Calculo AC/DC profesional**:
   ```typescript
   // Ventana de 3-4 segundos (90-120 frames)
   // DC = promedio (componente no pulsatil)
   // AC = RMS de la senal centrada (TI SLAA655)
   const dc = mean(window);
   const ac = sqrt(sum((x - dc)^2) / n) * sqrt(2);
   ```

3. **Ratio-of-Ratios para SpO2**:
   ```typescript
   // R = (AC_red/DC_red) / (AC_green/DC_green)
   const R = (redAC/redDC) / (greenAC/greenDC);
   // SpO2 = 110 - 25 * R (formula estandar TI)
   ```

### Modulo D: Preprocessing Pipeline (Mejorado)

**Archivo**: `src/modules/signal-processing/BandpassFilter.ts`

**Agregar**:

1. **Detrending** (nuevo):
   ```typescript
   // Remover deriva lenta con filtro pasa-altos muy bajo (0.1Hz)
   // O usar polinomio de grado bajo y restarlo
   detrendedSignal = signal - movingAverage(signal, 150);
   ```

2. **Savitzky-Golay smoothing** (nuevo):
   ```typescript
   // Ventana de 5-7 puntos, polinomio de grado 2-3
   // Suaviza sin distorsionar picos
   ```

3. **Deteccion de outliers**:
   ```typescript
   // Si valor esta a mas de 3 sigma del promedio, marcar como artefacto
   const isOutlier = Math.abs(value - mean) > 3 * stdDev;
   ```

### Modulo E: Signal Quality Index (SQI) Robusto

**Archivo**: `src/modules/signal-processing/SignalQualityAnalyzer.ts`

**Reescribir completamente** con metricas profesionales:

1. **SNR de banda cardiaca**:
   - FFT de la senal
   - Energia en 0.7-4Hz vs energia fuera de banda
   - SNR = 10 * log10(signal_power / noise_power)

2. **Perfusion Index**:
   ```typescript
   PI = (AC / DC) * 100; // Debe ser > 0.1% para senal valida
   ```

3. **Estabilidad temporal**:
   - CV (coeficiente de variacion) de intervalos RR
   - Debe ser < 0.25 para ritmo regular

4. **Porcentaje de clipping**:
   - % de muestras en 0 o 255
   - Debe ser < 5%

5. **SQI gobierna la UI**:
   ```typescript
   if (sqi < 30) return "SENAL INVALIDA - No mostrar valores";
   if (sqi < 50) return "BAJA CONFIANZA - Mostrar con advertencia";
   if (sqi < 70) return "CONFIANZA MEDIA";
   return "ALTA CONFIANZA";
   ```

### Modulo F: Beat/Rhythm Engine (Mejorado)

**Archivo**: `src/modules/HeartBeatProcessor.ts`

**Cambios**:

1. **Deteccion de picos mejorada**:
   - Zero-crossing de primera derivada (VPG)
   - Verificacion de amplitud relativa
   - Periodo refractario adaptativo (no fijo)

2. **Refinamiento sub-frame**:
   ```typescript
   // Interpolacion parabolica para precision sub-sample
   const peakOffset = (y_prev - y_next) / (2 * (y_prev - 2*y_peak + y_next));
   const refinedPeakTime = timestamp + peakOffset * frameInterval;
   ```

3. **Calculo BPM robusto**:
   ```typescript
   // Usar mediana de ultimos 8-10 intervalos RR (no promedio)
   // La mediana es mas robusta a outliers
   const medianRR = median(rrIntervals.slice(-10));
   const bpm = 60000 / medianRR;
   ```

4. **Suavizado adaptativo BPM**:
   ```typescript
   // Si cambio es pequeno (<10%), responder rapido
   // Si cambio es grande (>20%), suavizar mas (posible ruido)
   const relativeDiff = Math.abs(instantBPM - smoothBPM) / smoothBPM;
   const alpha = relativeDiff < 0.1 ? 0.4 : relativeDiff > 0.2 ? 0.1 : 0.25;
   smoothBPM = alpha * instantBPM + (1-alpha) * smoothBPM;
   ```

### Modulo G: Vital Signs Estimators (Reescritura Total)

**Archivo**: `src/modules/vital-signs/VitalSignsProcessor.ts`

**Principios fundamentales**:
- CERO valores base fijos
- CERO rangos fisiologicos artificiales
- TODO calculado desde datos PPG reales
- SQI gobierna si se muestra o no

**SpO2 - Ratio-of-Ratios** (formula estandar):
```typescript
// Solo calcular si PI > 0.1% y SQI > 40
const R = (redAC/redDC) / (greenAC/greenDC);
const spo2 = 110 - 25 * R;
// NO aplicar clamps - mostrar valor crudo
// UI muestra "BAJA CONFIANZA" si valor es < 85 o > 100
```

**Blood Pressure - Morfologia PPG**:
```typescript
// Basado en literatura (Mukkamala 2022, Elgendi 2019)
// Factores derivados 100% del PPG:
const features = {
  hr: 60000 / medianRR,
  systolicTime: detectarTiempoSistolico(ppgBuffer),
  dicroticDepth: detectarMuescaDicrotica(ppgBuffer),
  stiffnessIndex: calcularSI(ppgBuffer),
  augmentationIndex: calcularAIx(ppgBuffer),
  pwvProxy: calcularPWV(ppgBuffer, rrIntervals)
};

// Modelo multifactorial (sin base fija)
systolic = features.hr * 0.8 + 
           (180 - features.systolicTime) * 0.15 +
           features.stiffnessIndex * 4 +
           features.augmentationIndex * 0.12 +
           features.pwvProxy * 2.5;

diastolic = systolic / pulsePressureFactor;
```

**HRV Metrics** (para arritmias y estrés):
```typescript
// SDNN, RMSSD, pNN50 desde intervalos RR crudos
// Sin filtros fisiologicos - usar todos los datos
```

### Modulo H: UI Monitor (Mejoras)

**Archivo**: `src/components/PPGSignalMeter.tsx`

**Cambios**:

1. **Indicador SQI prominente**:
   - Barra de calidad que gobierna la visualizacion
   - Si SQI < 30: "COLOQUE DEDO CORRECTAMENTE"
   - Si SQI 30-50: valores con "(baja confianza)"

2. **Marcadores de latido**:
   - Cada pico detectado = beep + vibracion + marca visual

3. **Onda normalizada**:
   - AGC automatico para que onda siempre sea visible
   - No mostrar senal cruda (ruidosa)

---

## Archivos a Modificar

| Archivo | Accion |
|---------|--------|
| `src/modules/signal-processing/PPGSignalProcessor.ts` | Reescribir extraccion RGB, AC/DC, detrending |
| `src/modules/signal-processing/SignalQualityAnalyzer.ts` | Reescribir completamente con SQI robusto |
| `src/modules/signal-processing/BandpassFilter.ts` | Agregar detrending y Savitzky-Golay |
| `src/modules/HeartBeatProcessor.ts` | Mejorar deteccion picos, refinamiento sub-frame |
| `src/modules/vital-signs/VitalSignsProcessor.ts` | Reescribir SpO2, BP con formulas correctas |
| `src/modules/vital-signs/PPGFeatureExtractor.ts` | Optimizar extraccion de caracteristicas |
| `src/hooks/useSignalProcessor.ts` | Integrar pipeline unificado |
| `src/components/PPGSignalMeter.tsx` | Agregar indicador SQI prominente |
| `src/pages/Index.tsx` | Integrar SQI para gobernar visualizacion |

## Archivos a Eliminar (Obsoletos)

| Archivo | Razon |
|---------|-------|
| `src/modules/signal-processing/FrameProcessor.ts` | Funcionalidad movida a PPGSignalProcessor |

---

## Formulas Finales con Soporte Cientifico

### SpO2 (Ratio-of-Ratios)
**Fuente**: Texas Instruments SLAA655, Webster 1997, Frontiers in Digital Health 2023

```text
R = (AC_red / DC_red) / (AC_green / DC_green)
SpO2 = 110 - 25 * R
```

### BPM (Intervalos RR)
**Fuente**: IEEE Transactions on Biomedical Engineering

```text
BPM = 60000 / median(RR_intervals)
```

### Blood Pressure (Morfologia PPG)
**Fuente**: Mukkamala 2022, Schrumpf 2021, Frontiers Digital Health 2025

```text
SBP = f(HR, Ts, SI, AIx, PWV, dicroticDepth)
DBP = SBP / pulsePressureFactor
```

Donde:
- HR = frecuencia cardiaca
- Ts = tiempo sistolico
- SI = stiffness index
- AIx = augmentation index
- PWV = pulse wave velocity proxy

### Signal Quality Index
**Fuente**: Elgendi 2016, rPPG-Toolbox 2022

```text
SQI = w1*SNR + w2*PI + w3*stability + w4*(1-clipping)
```

---

## Secuencia de Implementacion

1. **Fase 1**: Reescribir `SignalQualityAnalyzer.ts` con SQI robusto
2. **Fase 2**: Actualizar `PPGSignalProcessor.ts` con detrending y AC/DC profesional
3. **Fase 3**: Optimizar `HeartBeatProcessor.ts` con deteccion de picos mejorada
4. **Fase 4**: Reescribir `VitalSignsProcessor.ts` con formulas 100% PPG
5. **Fase 5**: Integrar SQI en UI para gobernar visualizacion
6. **Fase 6**: Eliminar codigo obsoleto

---

## Resultado Esperado

- Mediciones 100% derivadas de datos PPG reales
- SpO2 que responde a cambios reales de saturacion
- BPM estable y preciso
- BP coherente con estado fisiologico (reposo vs ejercicio)
- Indicador de calidad que informa al usuario cuando la lectura es confiable
- Sin valores simulados, aleatorios o con rangos fisiologicos artificiales
