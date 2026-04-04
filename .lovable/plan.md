
# Plan de Evolución Técnica — App PPG Profesional

## Fase 1: Infraestructura de Calidad y Trazabilidad
**Criterio de aceptación**: Cada medición guardada incluye metadata de calidad, versión de algoritmo y ventana temporal.

1. **Extender esquema DB** — Agregar columnas a `measurements`: `glucose`, `hemoglobin`, `total_cholesterol`, `triglycerides`, `sdnn`, `rmssd`, `pnn50`, `lf_power`, `hf_power`, `lf_hf_ratio`, `signal_quality_index`, `algorithm_version`, `measurement_window_seconds`, `measurement_confidence`, `calibration_id` (FK a calibration_settings).
2. **Resultado tipado con metadata** — Crear interfaz `MeasurementResult` con: valor, incertidumbre (±), signalQuality, measurementConfidence, windowDuration, algorithmVersion, timestamp.
3. **Guardar todas las métricas** — Actualizar `useSaveMeasurement` para persistir HRV, glucosa, hemoglobina, lípidos y metadata de confianza.

## Fase 2: Pipeline de Señal en Web Worker
**Criterio de aceptación**: El procesamiento PPG no bloquea el hilo UI; latencia de render < 16ms.

4. **Mover PPGSignalProcessor a Web Worker** — Offload extracción de señal, filtros y QA al worker; comunicar vía postMessage con transferables (ArrayBuffer).
5. **SQI multi-métrico unificado** — Consolidar los 8+ SQIs existentes en un score compuesto documentado con pesos configurables.

## Fase 3: Mejora Algorítmica por Dominio
**Criterio de aceptación**: Cada estimador documenta ecuación, referencia bibliográfica y rango de incertidumbre.

6. **SpO₂** — Agregar calibración por sesión basada en PI mínimo, documentar proxy RGB vs LED rojo/IR, rechazar cuando PI < umbral configurable.
7. **Presión Arterial** — Agregar ventana temporal de validez de calibración (expiración configurable), drift detection, y presentar intervalo de confianza (±mmHg).
8. **Glucosa** — Implementar flujo de calibración periódica (glucómetro de referencia), modelo de regresión con features PPG morfológicas, mostrar en rejilla de error tipo Clarke/Parkes como QA interno.
9. **Hemoglobina** — Fusión temporal multi-ventana con cuantificación de incertidumbre, calibración individual opcional.
10. **Lípidos** — Documentar limitaciones, agregar intervalo de confianza amplio, flag de "estimación experimental".

## Fase 4: Fusión IMU Avanzada
**Criterio de aceptación**: Artefactos de movimiento reducen confidence pero no crashean; estrategia de cancelación adaptativa activa.

11. **Sincronización IMU-PPG por timestamp** — Buffer circular sincronizado acelerómetro/giroscopio con frames de video.
12. **Cancelación adaptativa** — Filtro adaptativo (LMS/NLMS) usando señal IMU como referencia de ruido para limpiar PPG.

## Fase 5: Preparación ML On-Device
**Criterio de aceptación**: Interfaz de inferencia lista para TFLite/ONNX con fallback determinista.

13. **Abstracción de modelo** — Interfaz `VitalModel` con `predict(features) → {value, confidence}` + loader para TFLite/ONNX.
14. **Pipeline A/B** — Ejecutar heurística y modelo en paralelo, comparar, usar modelo solo si confidence > umbral.

## Fase 6: UI Clínica Responsable
**Criterio de aceptación**: Cada métrica muestra nivel de confianza e intervalo; disclaimers visibles.

15. **Intervalos de confianza en UI** — Mostrar ± en cada signo vital, color-coded por confidence.
16. **Estado de calibración visible** — Badges de "calibrado", "requiere recalibración", "experimental".
17. **Textos legales** — Disclaimers de "referencia profesional, no sustituye dispositivo certificado" sin eliminar funcionalidad.

## Fase 7: Documentación y QA
18. **Documentación técnica** — Diagrama de pipeline, ecuaciones con DOI, tabla de rangos fisiológicos.
19. **Tests unitarios** — Filtros, peak detection, SQI, cada estimador con datos sintéticos conocidos.
20. **Registro de sesión** — Hash de algoritmo + parámetros + duración + calidad media por sesión.
