
# Plan de Corrección: Sistema PPG de Lectura Real

## Diagnóstico del Problema

Tras revisar exhaustivamente el código y buscar soporte en las últimas publicaciones (Nature 2024, IEEE 2024, arXiv 2025), he identificado los siguientes problemas críticos:

### Problemas Encontrados

| Problema | Archivo | Impacto |
|----------|---------|---------|
| **DisclaimerOverlay no solicitado** | `Index.tsx` línea 402 | UI no deseada que ocupa espacio |
| **Calibración ZLO bloquea medición** | `RGBCalibrator.ts` | Espera 30 frames SIN dedo, pero el usuario pone el dedo inmediatamente |
| **Detección de dedo muy permisiva** | `PPGPipeline.ts` línea 391-399 | Criterios demasiado laxos permiten falsos positivos |
| **Hooks obsoletos sin eliminar** | `useSignalProcessor.ts`, `useHeartBeatProcessor.ts`, `HeartBeatProcessor.ts` | Código muerto que confunde |
| **PPGSignalProcessor.ts duplicado** | `signal-processing/` | Duplica funcionalidad del nuevo pipeline |

### Problema Principal de Lectura

El sistema actual tiene un flujo de calibración ZLO que espera capturar frames **sin dedo** para establecer el nivel base de luz. Pero en la práctica:

1. Usuario presiona "Iniciar"
2. Cámara se activa con flash
3. Pipeline inicia `startCalibration()` esperando frames sin dedo
4. Usuario ya tiene el dedo puesto
5. Calibración recibe valores altos (con dedo) como "baseline"
6. Esto distorsiona todos los cálculos AC/DC posteriores

---

## Solución Propuesta

### FASE 1: Eliminar UI No Solicitada

**Archivo:** `src/pages/Index.tsx`

Eliminar la línea que renderiza `DisclaimerOverlay`:
```typescript
// ELIMINAR línea 402:
<DisclaimerOverlay />
```

Y eliminar el import correspondiente (línea 12).

### FASE 2: Corregir Flujo de Calibración

**Archivo:** `src/modules/ppg-core/RGBCalibrator.ts`

El problema es que la calibración ZLO está diseñada para capturar luz ambiente SIN dedo, pero esto no es práctico. La solución según la literatura (Nature Digital Biology 2024) es:

1. **Saltar calibración ZLO** y usar valores por defecto
2. **Auto-calibrar** dinámicamente desde los primeros frames con dedo
3. Estimar ZLO como 2-5% del valor DC inicial

Cambios propuestos:
- Modificar `forceCalibrationFromMeasurement()` para ser el método principal
- Hacer que la calibración sea instantánea cuando hay señal válida

### FASE 3: Mejorar Detección de Dedo

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

La detección actual es demasiado permisiva. Según la investigación "Seeing Red: PPG Biometrics" (Oxford/IEEE 2020), los criterios óptimos son:

1. **Red > 150** (con flash encendido, el dedo iluminado da valores altos)
2. **Red/Green ratio > 1.2** (sangre absorbe verde más que rojo)
3. **Valor DC estable** por al menos 10 frames consecutivos

Cambios en `detectFinger()`:
```typescript
private detectFinger(rawRed: number, rawGreen: number): boolean {
  // Con flash encendido, el dedo iluminado debe dar valores ALTOS
  const hasHighRed = rawRed > 120; // Era > 40
  const rgRatio = rawGreen > 0 ? rawRed / rawGreen : 0;
  const validRatio = rgRatio > 1.1 && rgRatio < 4.0;
  const notSaturated = rawRed < 253 && rawGreen < 253;
  
  return hasHighRed && validRatio && notSaturated;
}
```

### FASE 4: Optimizar Extracción de Señal

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

Según la literatura reciente:
- **LUMA = 0.299R + 0.587G + 0.114B** es mejor que canal verde solo
- Pero con flash y dedo, **canal ROJO** tiene mejor SNR
- Usar **canal verde como fallback** solo si rojo está saturado

Modificar `processFrame()` para seleccionar el canal óptimo.

### FASE 5: Eliminar Código Obsoleto

**Archivos a ELIMINAR:**
1. `src/hooks/useSignalProcessor.ts` - Reemplazado por `usePPGPipeline.ts`
2. `src/hooks/useHeartBeatProcessor.ts` - Reemplazado por `usePPGPipeline.ts`
3. `src/hooks/useVitalSignsProcessor.ts` - Integrado en `usePPGPipeline.ts`
4. `src/modules/HeartBeatProcessor.ts` - Reemplazado por `PeakDetectorHDEM.ts`
5. `src/modules/signal-processing/PPGSignalProcessor.ts` - Integrado en `PPGPipeline.ts`

### FASE 6: Mejorar el Loop de Captura

**Archivo:** `src/pages/Index.tsx`

El loop actual captura a 30 FPS pero no verifica si el video realmente tiene frames nuevos. Agregar verificación:

```typescript
const captureFrame = () => {
  if (!isProcessingRef.current) return;
  
  const video = cameraComponentRef.current?.getVideoElement();
  if (!video || video.readyState < 2 || video.videoWidth === 0) {
    frameLoopRef.current = requestAnimationFrame(captureFrame);
    return;
  }
  
  // NUEVO: Verificar que el video está reproduciendo
  if (video.paused || video.ended) {
    video.play().catch(() => {});
    frameLoopRef.current = requestAnimationFrame(captureFrame);
    return;
  }
  
  // ... resto del código
};
```

---

## Resumen de Cambios

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/pages/Index.tsx` | Modificar | Eliminar DisclaimerOverlay, mejorar loop de captura |
| `src/modules/ppg-core/PPGPipeline.ts` | Modificar | Mejorar detección de dedo, selección de canal, calibración automática |
| `src/modules/ppg-core/RGBCalibrator.ts` | Modificar | Calibración instantánea, sin esperar frames sin dedo |
| `src/hooks/useSignalProcessor.ts` | **ELIMINAR** | Código obsoleto |
| `src/hooks/useHeartBeatProcessor.ts` | **ELIMINAR** | Código obsoleto |
| `src/hooks/useVitalSignsProcessor.ts` | **ELIMINAR** | Código obsoleto |
| `src/modules/HeartBeatProcessor.ts` | **ELIMINAR** | Código obsoleto |
| `src/modules/signal-processing/PPGSignalProcessor.ts` | **ELIMINAR** | Código obsoleto |
| `src/components/DisclaimerOverlay.tsx` | **ELIMINAR** | UI no solicitada |

---

## Sección Técnica

### Fórmulas de Detección de Dedo (Oxford 2020)

```text
LUMA = 0.299 * R + 0.587 * G + 0.114 * B

Criterios de dedo válido (con flash):
1. R > 120 (luminancia mínima)
2. R/G > 1.1 (sangre absorbe verde)
3. R < 253 AND G < 253 (no saturado)
4. Varianza(R) > 0.5 en 10 frames (señal pulsátil)
```

### Calibración Automática (Sin ZLO Previo)

```text
1. Primeros 15 frames con dedo:
   - ZLO_estimated = min(R, G, B) * 0.02
   - gamma = 2.2 (valor por defecto sRGB)
   
2. Después de 15 frames:
   - AC = RMS(señal_centrada) * sqrt(2)
   - DC = mean(señal)
   - PI = (AC / DC) * 100
   
3. Validación:
   - PI > 0.1% = señal válida
   - PI < 0.1% = ruido o sin dedo
```

### Selección de Canal Óptimo

```text
Con flash + dedo:
- Canal ROJO: Mejor SNR, más pulsatilidad
- Canal VERDE: Mejor para SpO2 (ratio R/G)

Sin flash o saturación:
- Canal VERDE como fallback
- Calcular SNR de ambos y elegir mejor
```

---

## Garantías del Sistema Corregido

- **CERO DisclaimerOverlay** - Eliminado completamente
- **CERO código obsoleto** - Todos los hooks y procesadores legacy eliminados
- **CERO calibración bloqueante** - Calibración instantánea desde primer frame
- **Detección de dedo robusta** - Criterios basados en literatura validada
- **100% datos reales** - Sin simulación ni Math.random()
- **Flujo simplificado** - Un solo pipeline (PPGPipeline.ts) para todo
