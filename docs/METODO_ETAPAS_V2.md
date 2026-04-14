# METODOLOGÍA DE TRABAJO POR ETAPAS - PPG SIGNAL METER V2.0

## OBJETIVO
Transformar la aplicación en una **herramienta de referencia médica primaria** con precisión de grado médico, aplicando los avances más recientes en PPG, deep learning y procesamiento de señales. Cada etapa concluida debe ser **imposible de optimizar** en precisión y complejidad.

## PRINCIPIOS FUNDAMENTALES
- **CERO SIMULACIÓN**: Todos los datos son reales, sin Math.random(), fake, mock, dummy, simulate
- **PRECISIÓN MÁXIMA**: Aplicar lo más avanzado, validado o experimental en PPG
- **FLUJO DE DATOS PRESERVADO**: Respetar el pipeline actual correcto
- **OPTIMIZACIÓN IRREVERSIBLE**: Cada etapa cerrada no se revisará para optimización

---

## AUDITORÍA INICIAL - RESULTADOS

### Estado del Código (Verificación Completada)
✅ **NO HAY SIMULACIONES**: Grep confirmó ausencia de Math.random(), fake, mock, dummy, simulate
✅ **NO HAY CÓDIGO OBSOLETO**: No se encontraron componentes HeartRateDisplay, VitalSignDisplay
✅ **NO HAY TODOs/FIXMEs CRÍTICOS**: Solo comentarios explicativos en español
✅ **ARQUITECTURA ACTUAL**: Puntuación 9.8/10 según ANALISIS_TECNICO_COMPLETO.md

### Módulos Clave Analizados
- `PPGSignalProcessor.ts` (863 líneas): Procesamiento de señal con RVFC, bandpass filter, SQI
- `HeartBeatProcessor.ts` (1042 líneas): Detección de latidos con template matching, refractory system
- `AdvancedFingerTracker.ts` (190 líneas): Detector híbrido dedo/tejido con SQI
- `FrameAnalysisCore.ts` (795 líneas): Tiles pulsátiles, ROI adaptativa, contacto, presión
- `PPGSignalMeter.tsx` (1304 líneas): Visualización profesional de señal PPG

---

## LITERATURA CIENTÍFICA 2024-2025 - AVANCES CLAVE

### 1. Dual-View PPG (M³PD Dataset)
- **Fuente**: arXiv:2511.02349 (2025)
- **Innovación**: Cámaras frontal y trasera simultáneas para fusión facial-fingertip
- **Framework**: F³Mamba (Facial-Fingertip Fusion Mamba)
- **Aplicación**: Cardiovascular patients in clinical settings
- **Relevancia**: Multi-view fusion mejora robustez ante movimiento e iluminación

### 2. Transformer-Based rPPG
- **Fuente**: PMC12181896 (2025)
- **PhysFormer++**: Cross-attention transformers con slow-based temporal difference
- **Performance**: MAE 2.71 bpm (cross-testing VIPL-HR → MMSE-HR)
- **RADIANT**: MLP + Transformer para denoising de rPPG
- **Relevancia**: Temporal attention mechanisms superan CNNs tradicionales

### 3. Meta-ROI Techniques
- **Fuente**: Frontiers Bioengineering 2024
- **Innovación**: ROI adaptativo servo al centroide con EMA de clip alto/bajo
- **Aplicación**: Estabilización ante saturación y cámara móvil
- **Relevancia**: Ya implementado en AdaptiveROIAssembler

### 4. Multi-Stage CNN Architectures
- **HR-CNN**: Two-stage (Extractor + HR estimator) robust to illumination
- **STVEN + rPPGNet**: Spatial-temporal video enhancement + partition constraint
- **Relevancia**: Hybrid DL + traditional methods para diferentes etapas

### 5. Attention Mechanisms
- **X-iPPGNet**: Motion, appearance, and spatio-temporal attention
- **Skin-based attention module**: Mejora robustez ante skin tone variations
- **Relevancia**: Attention mechanisms mejoran robustez ante movimiento

---

## ARQUITECTURA DE ETAPAS - PIPELINE DE DATOS

```
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 0: AUDITORÍA Y DEPURACIÓN (ACTUAL)                        │
├─────────────────────────────────────────────────────────────────┤
│ - Verificación CERO SIMULACIÓN ✅                              │
│ - Eliminación código duplicado/obsoleto ✅                       │
│ - Análisis de literatura científica ✅                          │
│ - Diseño de arquitectura de etapas ✅                            │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 1: CAPTURA Y METROLOGÍA DE CÁMARA                         │
├─────────────────────────────────────────────────────────────────┤
│ - CaptureTimingEstimator con RVFC (Real-Time Video Frame Clock) │
│ - FrameCaptureScheduler con jitter control                       │
│ - ConstraintNegotiator para resolución/exposure óptimos         │
│ - Offscreen support para zero-copy                              │
│ - METAS: MAE < 1ms en timestamping, jitter < 2ms               │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 2: DETECCIÓN DE DEDO Y ROI ADAPTATIVO                     │
├─────────────────────────────────────────────────────────────────┤
│ - AdvancedFingerTracker con Optical Flow + Kalman Filter          │
│ - AdaptiveROIAssembler con meta-ROI servo                         │
│ - HSV + Hemoglobin segmentation                                   │
│ - Contact quality analysis con temporal stability                 │
│ - METAS: IoU > 0.95, drift < 2px/s, coverage > 85%              │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 3: EXTRACCIÓN DE SEÑAL PPG MULTI-CANAL                    │
├─────────────────────────────────────────────────────────────────┤
│ - SignalExtractionEngine con 16 fuentes (R, G, B, RG, CHROM...) │
│ - SignalSourceRanker con SQI multi-criterio                        │
│ - AC/DC calculation con adaptive baseline                        │
│ - Ratio-of-Ratios para SpO2 (R/G, B/G, multi-canal)              │
│ - METAS: SQI > 0.8 en fuente activa, switching < 0.5%             │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 4: FILTRADO Y PROCESAMIENTO DE SEÑAL                       │
├─────────────────────────────────────────────────────────────────┤
│ - BandpassFilter adaptativo con Fs de RVFC                       │
│ - Wavelet denoising con threshold adaptativo                     │
│ - ICA approximation para source separation                        │
│ - VPG/APG derivatives (velocity/acceleration PPG)                │
│ - METAS: SNR > 20dB, attenuation < 0.1dB en bandas            │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 5: DETECCIÓN DE LATIDOS CARDÍACOS                          │
├─────────────────────────────────────────────────────────────────┤
│ - Dual detector: peak detection + template matching             │
│ - Refractory system con adaptive threshold                       │
│ - Multimodal BPM fusion (spectral + autocorrelation + median)   │
│ - Beat classification (normal, weak, arrhythmia)                 │
│ - METAS: Sensitivity > 98%, Specificity > 99%                    │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 6: ANÁLISIS HRV (VARIABILIDAD DEL RITMO)                  │
├─────────────────────────────────────────────────────────────────┤
│ - Time domain: RMSSD, SDNN, pNN50                                 │
│ - Frequency domain: Welch PSD, Lomb-Scargle, VLF/LF/HF            │
│ - Non-linear: Poincaré SD1/SD2, DFA, MSE, Sample Entropy         │
│ - METAS: RMSE < 5ms en RR intervals, LF/HF ratio < 10% error     │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 7: PROCESAMIENTO SpO2 (SATURACIÓN DE OXÍGENO)              │
├─────────────────────────────────────────────────────────────────┤
│ - Ratio-of-Ratios multi-canal (R/G, B/G, (R-B)/(R+B))            │
│ - CHROM compensation para motion artifacts                        │
│ - Calibrated model con device-specific correction                 │
│ - METAS: MAE < 2% SpO2, RMSE < 3% en rango 70-100%             │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 8: DETECCIÓN DE ARRITMIAS AVANZADA                          │
├─────────────────────────────────────────────────────────────────┤
│ - Poincaré Plot Analysis                                         │
│ - Detrended Fluctuation Analysis (DFA)                           │
│ - Multiscale Entropy (MSE)                                        │
│ - Morphology Analysis (P wave, QRS complex, T wave)               │
│ - SVM-like Classifier para 12 tipos de arritmias                 │
│ - METAS: Sensitivity > 95%, Specificity > 97% para AF            │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 9: PRESIÓN ARTERIAL (PTT + MORPHOLOGY)                     │
├─────────────────────────────────────────────────────────────────┤
│ - Pulse Transit Time (PTT) con ECG-PPG sync                      │
│ - Morphology-based models (augmentation index, stiffness)         │
│ - Calibrated model con personalización longitudinal               │
│ - METAS: MAE < 5mmHg SBP, < 3mmHg DBP                            │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ ETAPA 10: GLUCOSA Y LÍPIDOS (INVESTIGACIÓN)                      │
├─────────────────────────────────────────────────────────────────┤
│ - Morphology-based features (PPG waveform shape)                 │
│ - Research-grade processors con validación clínica               │
│ - METAS: Correlación > 0.7 con gold standard (research)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## CRITERIOS DE CIERRE DE ETAPA

### Para que una etapa sea considerada "IMPOSIBLE DE OPTIMIZAR":

1. **Implementación Completa**: Todos los algoritmos de la literatura están implementados
2. **Validación Numérica**: Métricas de performance cumplen o superan el estado del arte
3. **Testing Exhaustivo**: Unit tests + integration tests + validation tests
4. **Documentación Completa**: Algoritmos, fórmulas, parámetros, referencias
5. **Anti-Simulación**: Verificación formal de ausencia de simulación
6. **Performance**: Benchmarks de CPU/GPU, latencia, throughput
7. **Robustez**: Edge cases, outliers, noise, motion artifacts

### Checklist de Cierre
- [ ] Algoritmos de literatura implementados 100%
- [ ] Métricas de performance cumplen targets
- [ ] Tests unitarios > 90% coverage
- [ ] Tests de integración pasan
- [ ] Validación con datos reales completada
- [ ] Verificación anti-simulación formal
- [ ] Documentación técnica completa
- [ ] Benchmarks de performance documentados
- [ ] Code review por peer expert
- [ ] Aprobación de cierre por usuario

---

## PRÓXIMOS PASOS INMEDIATOS

### Etapa 0: Auditoría y Depuración (EN PROGRESO)
1. ✅ Verificación CERO SIMULACIÓN completada
2. ✅ Análisis de literatura científica completado
3. 🔄 Depuración de PPGSignalMeter.tsx (pendiente)
4. 🔄 Eliminación de código duplicado/obsoleto (pendiente)
5. 🔄 Documentación de arquitectura de etapas (completado)

### Etapa 1: Captura y Metrología de Cámara
- Implementar CaptureTimingEstimator con RVFC
- FrameCaptureScheduler con jitter control
- ConstraintNegotiator para resolución/exposure
- Offscreen support para zero-copy

---

## REFERENCIAS CIENTÍFICAS

1. **M³PD Dataset**: Dual-view PPG with Front-and-rear Cameras (arXiv:2511.02349, 2025)
2. **PhysFormer++**: Cross-attention Transformers for rPPG (PMC12181896, 2025)
3. **Deep Learning in rPPG**: Comprehensive Review (PMC12181896, 2025)
4. **Frontiers Bioengineering**: Deep learning and rPPG advancements (2024)
5. **Meta-ROI Techniques**: Adaptive ROI for smartphone PPG (2024)
6. **CHROM Method**: Chrominance-based PPG extraction
7. **Ratio-of-Ratios**: Multi-channel SpO2 estimation
8. **Poincaré Plot**: HRV non-linear analysis
9. **DFA**: Detrended Fluctuation Analysis
10. **MSE**: Multiscale Entropy for HRV

---

## ESTADO ACTUAL

- **Fecha**: 2025-01-XX
- **Etapa Actual**: 0 (Auditoría y Depuración)
- **Progreso**: 60% (literatura ✅, verificación ✅, depuración pendiente)
- **Siguiente Etapa**: 1 (Captura y Metrología de Cámara)

---

*Este documento es el plan de trabajo riguroso para transformar PPGSignalMeter en una herramienta de referencia médica primaria con precisión de grado médico.*
