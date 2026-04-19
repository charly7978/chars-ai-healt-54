# Auditoría quirúrgica y unificación de pipeline cPPG (abril 2026)

## Alcance

Esta auditoría documenta la unificación funcional aplicada sobre el pipeline existente para endurecer reglas anti-simulación y separar claramente módulos operativos vs research-calibrated.

## Mapeo rápido del repositorio

- Captura y cámara móvil: `src/components/CameraView.tsx`, `src/components/CameraPreview.tsx`.
- Finger/ROI/contacto y SQI de señal: `src/modules/signal-processing/*`.
- Extracción de señal + beat engine: `src/hooks/useSignalProcessor.ts`, `src/modules/HeartBeatProcessor.ts`.
- Cálculo de signos: `src/modules/vital-signs/VitalSignsProcessor.ts`.
- UI monitor y overlays: `src/components/PPGSignalMeter.tsx`, `src/pages/Index.tsx`, `src/components/DebugPanel.tsx`.

## Hallazgos clave

1. La base técnica ya incorporaba motores multi-módulo (V1/V2/V3) con trazabilidad razonable.
2. Existía riesgo de clasificación de ritmo sobre ventanas de calidad insuficiente por un floor artificial de SQI.
3. La UI mezclaba etiquetas “estimadas” con módulos que conceptualmente deben quedar en research-calibrated.
4. Faltaba exponer explícitamente en salida el estatus de madurez por módulo.

## Cambios de unificación aplicados

1. **Rhythm gating estricto previo a clasificación**
   - Se agregó compuerta determinista `evaluateRhythmGate(...)` antes de correr clasificadores.
   - Bloquea clasificación con motivos explícitos (`INSUFFICIENT_BEATS`, `LOW_SIGNAL_QUALITY`, etc.).
   - Elimina el sesgo de “forzar SQI mínimo” en clasificación.

2. **Telemetría de bloqueo y trazabilidad**
   - `VitalSignsResult.debugMetrics` ahora publica:
     - `rhythmGatePassed`
     - `rhythmBlockedReasons[]`

3. **Mapa de madurez por módulo (operativo vs calibración vs research)**
   - `VitalSignsResult.moduleMaturity` clasifica cada métrica como:
     - `production-grade`
     - `advanced-calibration-dependent`
     - `research-calibrated`

4. **UI alineada a política de publicación real**
   - Glucosa, lípidos y hemoglobina renombrados a **RESEARCH**.
   - La UI de glucosa/lípidos ya no publica si su gate no está en estado `ENABLED_*`.

5. **Debug panel profundo**
   - Se añadió visualización explícita de:
     - estado del rhythm gate
     - motivos de bloqueo
     - maturity map de módulos

## Estado posterior

- Operativo: BPM + waveform PPG.
- Avanzado/calibración dependiente: SpO2, HRV, ritmo.
- Research-calibrated: presión arterial, glucosa, lípidos, hemoglobina.

## Notas

- Esta unificación es de arquitectura interna (pipeline y política de emisión), no de Git branches remotas: en este repositorio local solo existe una rama (`work`).
