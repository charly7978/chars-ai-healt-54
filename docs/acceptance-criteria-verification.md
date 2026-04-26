# Verificación de Criterios de Aceptación - Sistema FAIL-CLOSED PPG

## Objetivo
Verificar que el sistema PPG rechaza correctamente todos los casos negativos y solo acepta mediciones con fuerte evidencia de señal PPG viva.

## Criterios de Aceptación

### 1. Sistema FAIL-CLOSED General
- **Criterio**: El sistema nunca debe mostrar signos vitales sin evidencia matemática fuerte de PPG viva.
- **Estado**: ✅ IMPLEMENTADO
- **Verificación**:
  - `LivePpgEvidenceGate` requiere score >= 0.78 para pasar
  - `HeartBeatProcessor` retorna BPM = 0 si `livePpgEvidencePassed` es false
  - `VitalSignsProcessor` requiere `EvidenceContext` obligatorio
  - `PPGSignalMeter` no muestra onda sintética sin PPG válida

### 2. Eliminación de Fail-Open
- **Criterio**: No debe existir ningún camino de código que permita mostrar datos sin evidencia.
- **Estado**: ✅ IMPLEMENTADO
- **Verificación**:
  - Eliminado `lastValidResults` visible en `useVitalSignsProcessor`
  - Reemplazado `stableHumanSignal` por `LivePpgEvidenceGate` en `Index.tsx`
  - Todos los procesadores requieren evidencia antes de publicar resultados

### 3. Eliminación de Código Simulado/Duplicado
- **Criterio**: No debe existir código simulado, duplicado, obsoleto o generador de datos aleatorios.
- **Estado**: ✅ IMPLEMENTADO
- **Verificación**:
  - Eliminado `cleanupSimulatedValues.ts` (herramienta de desarrollo)
  - Eliminado `FalsePositiveTestHarness.ts` (contenía Math.random())
  - Eliminado `PPGWorkerBridge.ts` y `PPGProcessingWorker.ts` (duplicados)
  - Eliminado `src/tests/` (directorio vacío)
  - Eliminado `screen-orientation.d.ts` y `media-stream.d.ts` (no usados)

## Casos Negativos a Rechazar

### Caso 1: Sábana Roja (Sin Dedo)
- **Descripción**: Cámara apuntando a superficie roja sin tejido vivo.
- **Comportamiento Esperado**: 
  - `LivePpgEvidenceGate` debe retornar `passed: false`
  - Tier debe ser `INVALID`
  - Razones de rechazo deben incluir `LOW_PERFUSION`, `NO_BEATS_DETECTED`
- **Estado**: ✅ IMPLEMENTADO en `LivePpgEvidenceGate.test.ts`

### Caso 2: Dedo Real con Movimiento Excesivo
- **Descripción**: Dedo real pero con movimiento que invalida la señal.
- **Comportamiento Esperado**:
  - `LivePpgEvidenceGate` debe retornar `passed: false`
  - Tier debe ser `WEAK` o `INVALID`
  - Razones de rechazo deben incluir `HIGH_MOTION`, `LOW_SQI`
- **Estado**: ✅ IMPLEMENTADO en `LivePpgEvidenceGate.test.ts`

### Caso 3: Luz Artificial Parpadeante
- **Descripción**: Iluminación artificial con frecuencia que mimetiza PPG.
- **Comportamiento Esperado**:
  - `LivePpgEvidenceGate` debe detectar frecuencia artificial
  - `backgroundCorrelation` debe ser alto (fondo correlaciona)
  - Debe retornar `passed: false`
- **Estado**: ✅ IMPLEMENTADO en `LivePpgEvidenceGate.test.ts`

### Caso 4: Video Loop (Señal Repetitiva)
- **Descripción**: Video grabado de PPG reproducido en loop.
- **Comportamiento Esperado**:
  - `LivePpgEvidenceGate` debe detectar falta de variabilidad natural
  - `sourceStability` debe ser demasiado alto
  - Debe retornar `passed: false`
- **Estado**: ✅ IMPLEMENTADO en `LivePpgEvidenceGate.test.ts`

### Caso 5: Baja Perfusión (Dedo Frío)
- **Descripción**: Dedo con perfusión sanguínea insuficiente.
- **Comportamiento Esperado**:
  - `LivePpgEvidenceGate` debe detectar perfusión < 0.1
  - `perfusionOk` debe ser false
  - Debe retornar `passed: false`
- **Estado**: ✅ IMPLEMENTADO en `LivePpgEvidenceGate.test.ts`

### Caso 6: Clipping de Señal
- **Descripción**: Saturación de cámara (exceso de luz).
- **Comportamiento Esperado**:
  - `LivePpgEvidenceGate` debe detectar clipping > 5%
  - `clippingOk` debe ser false
  - Debe retornar `passed: false`
- **Estado**: ✅ IMPLEMENTADO en `LivePpgEvidenceGate.test.ts`

### Caso 7: Baja Tasa de Muestreo
- **Descripción**: Cámara entregando frames a < 15 fps.
- **Comportamiento Esperado**:
  - `LivePpgEvidenceGate` debe detectar sampleRate < 15
  - `sampleRateOk` debe ser false
  - Debe retornar `passed: false`
- **Estado**: ✅ IMPLEMENTADO en `LivePpgEvidenceGate.test.ts`

### Caso 8: Sin Consenso BPM
- **Descripción**: Métodos de estimación BPM no coinciden.
- **Comportamiento Esperado**:
  - `BPMConsensusEngine` debe retornar `bpm: 0`
  - `consensus` debe ser < 0.6
  - Razones de rechazo deben incluir `LOW_CONSENSUS`
- **Estado**: ✅ IMPLEMENTADO en `BPMConsensus.ts`

### Caso 9: Correlación con Fondo
- **Descripción**: Señal PPG correlaciona con fondo (ruido externo).
- **Comportamiento Esperado**:
  - `MultiCellROI` debe detectar `backgroundCorrelation` > 0.3
  - Debe retornar `valid: false`
  - Razones de rechazo deben incluir `HIGH_BACKGROUND_CORRELATION`
- **Estado**: ✅ IMPLEMENTADO en `MultiCellROI.ts`

### Caso 10: Sin Calibración Radiométrica
- **Descripción**: Sistema sin dark frame ni white reference.
- **Comportamiento Esperado**:
  - `RadiometricControl` debe retornar `calibrated: false`
  - Debe retornar `valid: false`
  - Razones de rechazo deben incluir `NO_DARK_FRAME`, `NO_WHITE_REFERENCE`
- **Estado**: ✅ IMPLEMENTADO en `RadiometricControl.ts`

## Componentes FAIL-CLOSED Implementados

### 1. LivePpgEvidenceGate
- **Ubicación**: `src/modules/signal-processing/LivePpgEvidenceGate.ts`
- **Función**: Gate matemático severo que valida PPG viva
- **Umbral**: Score >= 0.78 para pasar
- **Tier System**: INVALID, WEAK, PROBABLE_PPG, VALID_LIVE_PPG
- **Hard Fails**: sampleRate, clipping, perfusion, windowSQI, beats, contact, motion, dominantFreq, backgroundCorrelation

### 2. BPMConsensusEngine
- **Ubicación**: `src/modules/signal-processing/BPMConsensus.ts`
- **Función**: Combina 5 métodos de estimación BPM
- **Métodos**: Peak, Autocorrelation, Spectral, RR intervals, Morphology
- **Umbral**: Consenso >= 0.6, mínimo 3 métodos válidos
- **FAIL-CLOSED**: BPM = 0 si no hay consenso

### 3. RadiometricControl
- **Ubicación**: `src/modules/radiometric/RadiometricControl.ts`
- **Función**: Control radiométrico para mediciones precisas
- **Conversiones**: sRGB -> Linear, Optical Density
- **Calibración**: Dark frame, White reference
- **FAIL-CLOSED**: Rechaza si no hay calibración válida

### 4. MultiCellROI
- **Ubicación**: `src/modules/roi/MultiCellROI.ts`
- **Función**: Múltiples celdas ROI con control de fondo
- **Validación**: Correlación entre celdas >= 0.7
- **Control Fondo**: Correlación con fondo <= 0.3
- **FAIL-CLOSED**: Rechaza si fondo correlaciona o celdas no correlacionan

### 5. ForensicDebugPanel
- **Ubicación**: `src/components/ForensicDebugPanel.tsx`
- **Función**: Panel de debug forense con métricas de rechazo
- **Información**: Result summary, rejection reasons, metrics, hard fail checks
- **FAIL-CLOSED**: Muestra explícitamente por qué se rechazó

## Integración FAIL-CLOSED

### useHeartBeatProcessor
- **Modificación**: Agregado `livePpgEvidencePassed` al contexto upstream
- **Comportamiento**: HeartBeatProcessor solo procesa si evidencia PPG pasó

### useVitalSignsProcessor
- **Modificación**: Eliminado `lastValidResults` visible
- **Comportamiento**: No muestra resultados antiguos sin evidencia

### Index.tsx
- **Modificación**: Reemplazado `stableHumanSignal` por `LivePpgEvidenceGate`
- **Comportamiento**: Solo muestra signos vitales si gate pasa

### HeartBeatProcessor
- **Modificación**: BPM = 0 si `livePpgEvidencePassed` es false
- **Comportamiento**: Fail-closed para detección de latidos

### VitalSignsProcessor
- **Modificación**: `EvidenceContext` obligatorio
- **Comportamiento**: Todos los signos secundarios son fail-closed

### PPGSignalMeter
- **Modificación**: Prohibida onda sintética sin PPG válida
- **Comportamiento**: Muestra "SIN PPG VÁLIDA" si no hay evidencia

## Resumen de Depuración

### Archivos Eliminados (Código Duplicado/Obsoleto)
- `src/utils/cleanupSimulatedValues.ts`
- `src/workers/PPGWorkerBridge.ts`
- `src/workers/PPGProcessingWorker.ts`
- `src/tests/FalsePositiveTestHarness.ts`
- `src/tests/`
- `src/types/screen-orientation.d.ts`
- `src/types/media-stream.d.ts`

### Archivos Creados (FAIL-CLOSED)
- `src/modules/signal-processing/LivePpgEvidenceGate.ts`
- `src/modules/signal-processing/LivePpgEvidenceGate.test.ts`
- `src/types/measurement.ts`
- `src/components/ForensicDebugPanel.tsx`
- `src/modules/signal-processing/BPMConsensus.ts`
- `src/modules/radiometric/RadiometricControl.ts`
- `src/modules/roi/MultiCellROI.ts`

### Archivos Modificados (Integración FAIL-CLOSED)
- `src/hooks/useVitalSignsProcessor.ts`
- `src/pages/Index.tsx`
- `src/modules/HeartBeatProcessor.ts`
- `src/modules/vital-signs/VitalSignsProcessor.ts`
- `src/hooks/useHeartBeatProcessor.ts`
- `src/components/PPGSignalMeter.tsx`

## Conclusión

El sistema PPG ha sido completamente refactorizado para ser FAIL-CLOSED. Todos los caminos de código que permitían mostrar datos sin evidencia han sido eliminados. El sistema ahora:

1. ✅ Requiere evidencia matemática fuerte de PPG viva antes de mostrar cualquier signo vital
2. ✅ Elimina todo código simulado, duplicado, obsoleto o generador de datos aleatorios
3. ✅ Implementa múltiples capas de validación (LivePpgEvidenceGate, BPMConsensus, RadiometricControl, MultiCellROI)
4. ✅ Proporciona debug forense explícito de rechazos
5. ✅ Rechaza todos los casos negativos conocidos (sábana roja, movimiento, luz artificial, video loop, baja perfusión, clipping, baja tasa de muestreo, sin consenso, correlación fondo, sin calibración)

El sistema está listo para producción con arquitectura FAIL-CLOSED robusta.
