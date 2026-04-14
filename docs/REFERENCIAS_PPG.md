# Referencias PPG / SpO2 / smartphone (estudio y mejores prácticas)

Documento de apoyo para alinear implementación con literatura y tendencias recientes. Las URLs son puntos de partida para profundizar; la app implementa ratio-of-ratios multi-canal, CHROM y pipelines élite propios.

## Oximetría y ratio-of-ratios (cámara / video)

- **Multi-channel ratio-of-ratios, video de mano (arxiv):** [A Multi-Channel Ratio-of-Ratios Method for Noncontact Hand Video Based SpO2 Monitoring Using Smartphone Cameras](https://arxiv.org/html/2107.08528v2) — uso de R/G/B con filtros adaptativos al FC; mejora frente a RoR clásico en escenarios no contacto.
- **Smartphone pulse oximetry, two-tone camera PPG (IEEE):** [IEEE Xplore — Smartphone Pulse Oximetry Using Two-tone Camera-based Photoplethysmography](https://ieeexplore.ieee.org/document/10175332) — enfoque dual-tono para PPG con cámara.
- **Meta-ROI (SmartPhOx, HAL):** [SmartPhOx: Smartphone-Based Pulse Oximetry Using a Meta-Region Of Interest](https://hal.science/hal-03559211v1/file/m68037-kateu%20final.pdf) — paradigma meta-ROI para estabilizar mediciones solo con cámara/flash; referencia de diseño de ROI y calidad.

## Señal PPG y corrección en smartphone

- **ROI frame-adaptive (dedo / vídeo):** p. ej. *Frame adaptive ROI for photoplethysmography signal extraction from fingertip video captured by smartphone* (IEEE) — reduce distorsión por saturación vs ROI fija; la app aplica servo de ventana + penalización de tiles saturados y EMA de clip para el tamaño de ROI en `FrameAnalysisCore` / `TilePulsatilityMap`.
- **PRISM / optimización adaptativa (literatura reciente):** buscar *PRISM photoplethysmography adaptive detrending* en arxiv (2024–2025) para métodos sin entrenamiento que ajustan mezcla cromática y detrending según calidad en tiempo real.

## Cómo se usa esto en el código

| Área | Módulos en repo |
|------|-----------------|
| RoR + CHROM | `SpO2ProcessorElite.ts`, `OpticalRatioEngine.ts` |
| PPG multi-canal | `PPGSignalProcessor.ts` |
| Meta-ROI (estabilidad máscara + pulsatility proxy) | `AdaptiveROIAssembler` + `TilePulsatilityMap` (`maskIoU` → `HeartBeatProcessor`) |
| Picos / RR / autocorr+espectral | `HeartBeatProcessor.ts` (Fs alineada a `estimatedSampleRate`, gating por `maskIoU`) |
| Pesos multi-escala según SNR previo | `AdvancedFingerTracker.ts` |
| PA morfológica / PTT-proxy + altura usuario | `BloodPressureProcessorElite.ts`, perfil en `DeviceProfileManager` |
| Pipeline UI principal | `VitalSignsProcessor.ts` (contexto upstream: Fs, IoU, clip, jitter RVFC → SpO₂/PA/ritmo), `Index.tsx` |
| Monitor pantalla completa + altura (TA) | `PPGSignalMeter.tsx` (barra superior izquierda, `z-index` sobre el canvas; `Guardar` → `setUserHeightM` + toast; valor inicial desde perfil o 1,70 m) |
| Integración pipeline (cámara → señal) | `ElitePPGProcessor.ts` vía `useSignalProcessor` en `Index.tsx` |
| Monitor E5 (solo espejo) | `PPGSignalMeter.tsx` recibe `pipelineTelemetry` + props clínicas; onda usa `VISUAL_WAVEFORM_GAIN` (dibujo) |

**Estabilidad de contacto / lectura:** `PPGSignalProcessor.ts` usa confirmación de dedo más larga, umbral de contacto estable mayor, EWMA RGB/cobertura algo más suaves y menos castigo por fotogramas dudosos; en `Index.tsx` la señal “humana estable” para BPM exige más calidad, más perfusión, sin deriva de posición y calidad extra si el candado óptico no está activo; alertas por arritmia en toast requieren al menos 2 eventos y cooldown.

Actualizar este archivo cuando aparezcan revisiones sistemáticas o validaciones clínicas nuevas relevantes para PPG por smartphone.
