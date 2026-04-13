# Auditoría y arquitectura actual (2026)

## Estado del pipeline principal

La aplicación usa **`src/pages/Index.tsx`** como pantalla principal (`App.tsx` → ruta `/`).

Flujo en vivo:

1. **`useSignalProcessor`** → `PPGSignalProcessor` (frames reales de cámara).
2. **`useHeartBeatProcessor`** → `HeartBeatProcessor` (latidos, RR, calidad).
3. **`useVitalSignsProcessor`** → **`VitalSignsProcessor`**:
   - **SpO2:** `SpO2ProcessorElite` + fusión con curva de **`SpO2Calibrator`** / perfil dispositivo (`DeviceCalibrationEngine`).
   - **Presión arterial:** `BloodPressureProcessorElite` + offsets de **`BPCalibrationManager`** y motor de dispositivo.
   - **Glucosa / lípidos / ritmo:** `GlucoseResearchProcessor`, `LipidResearchProcessor`, `RhythmClassifier` (sin cambiar de propósito).
4. Cada frame pasa **timestamp** de señal a `processSignal(..., frameTimestamp)` para alinear buffers PPG/TA élite.

## Pipeline alternativo (panel élite)

- **`ElitePPGProcessor`**: integra dedo, PPG, latidos, HRV, arritmias, SpO2 élite y PA élite en un solo bucle (p. ej. `EliteMeasurementPanel`, `useEliteMeasurement`).
- No sustituye automáticamente a `Index.tsx`; es una vía compacta para medición completa con un solo procesador.

## Duplicación resuelta

- **Antes:** `Index.tsx` volvía a ejecutar SpO2/PA élite en paralelo a `VitalSignsProcessor`.
- **Ahora:** una sola fuente de verdad para SpO2/TA en sesión principal: **`VitalSignsProcessor`** con procesadores élite internos.

## Archivos de referencia legacy (no usados en el pipeline principal)

- `SpO2Processor.ts` / `BloodPressureProcessor.ts`: se mantienen como **referencia de tipos** (`SpO2Result`) y posibles pruebas; el runtime principal usa las variantes **Elite**.

## Referencias técnicas externas

Ver **`docs/REFERENCIAS_PPG.md`** (ratio-of-ratios multi-canal, meta-ROI, literatura reciente).

## Build

```bash
npm run build
```

La ruta **`IndexElite.tsx` fue eliminada** del árbol de código; la documentación antigua que la citaba queda obsoleta.
