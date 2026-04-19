# cPPG App — Architecture (v1.0)

This document describes the signal-processing and biomarker pipeline that
powers the contact-PPG (cPPG) measurement app after the Phase 0–17 rewrite.

> Companion docs:
> - `docs/algorithms.md` — math + paper references per module
> - `docs/calibration-guide.md` — step-by-step user calibration
> - `docs/medical-validation.md` — anti-simulation policy

---

## 1. End-to-end pipeline

```
                    ┌──────────────────────────────────────────────────────┐
                    │                  Camera (rear + flash)               │
                    │  ImageCapture API + manual exp/wb/iso/focus locks    │
                    │  rVFC frame-callback with real presentation timestamps│
                    │  Dark-frame bootstrap → CustomEvent 'cppg:dark-frame' │
                    │  Drift monitor (5s) → CustomEvent 'cppg:camera-drift' │
                    └──────────────┬───────────────────────────────────────┘
                                   │ ImageData(320x240)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   PPGSignalProcessor (signal-processing/)                │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ AdaptiveROIMask 7×7 tiles                                          │  │
│  │   ├─ RadiometricProcessor.processTileRGB()  ← Phase 1              │  │
│  │   │     sRGB → linear → optical density (OD) per channel           │  │
│  │   │     dark-frame + white-point bootstrap, persisted profile      │  │
│  │   └─ TileFusionEngine (Huber + trimmed mean, top-K)                │  │
│  └─────────────────────────────────────┬──────────────────────────────┘  │
│                                        │ linRed/linGreen/linBlue + OD    │
│  ┌─────────────────────────────────────▼──────────────────────────────┐  │
│  │ PressureProxyEstimator   FingerContactClassifier                   │  │
│  └─────────────────────────────────────┬──────────────────────────────┘  │
│  ┌─────────────────────────────────────▼──────────────────────────────┐  │
│  │ POSExtractor + CHROMExtractor (Phase 3, anti-flicker)              │  │
│  │ SignalSourceRanker(8 sources) → bandpass → adaptive Kalman per HR  │  │
│  └─────────────────────────────────────┬──────────────────────────────┘  │
│  ┌─────────────────────────────────────▼──────────────────────────────┐  │
│  │ SignalQualityEstimator → gated SQI, telemetry payload              │  │
│  └─────────────────────────────────────┬──────────────────────────────┘  │
└────────────────────────────────────────┬────────────────────────────────┘
                                         │ ProcessedSignal
                                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          HeartBeatProcessor                              │
│   3-detector arbitration (prominence + slope-sum + Pan-Tompkins)         │
│   Goertzel cardiac bank (61 bins, 0.5–3.5 Hz) → spectralBPM              │
│   1-D Kalman on the fused BPM with adaptive R from SQI                  │
│   Beat acceptance → RR series + per-beat SQI                             │
└────────────────────────────────────────┬────────────────────────────────┘
                                         │ rrIntervals + beatInputs
                                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       VitalSignsProcessor (V2 + V3)                      │
│ ┌─────────────────────────────────────────────────────────────────────┐  │
│ │ SpO2ProcessorV3 (RGB multi-channel ridge, calibrable)               │  │
│ │ BloodPressureProcessorV3 (ridge multivar, LOO-RMSE, ≥5 cuff pts)    │  │
│ │ GlucoseResearchProcessorV3 (ridge + OD, RESEARCH_ONLY, ≥20 samples) │  │
│ │ LipidResearchProcessorV3   (per-target ridge, RESEARCH_ONLY, ≥10)   │  │
│ │ HemoglobinProcessor        (ridge or population prior, ≥3 lab pts)  │  │
│ │ HRVTimeFreqProcessor       (Lomb-Scargle LF/HF/VLF + DFA + SampEn)  │  │
│ │ StressProcessor            (Baevsky SI + LF/HF + RMSSD + PI varCV)  │  │
│ │ RespiratoryRateProcessor   (AM+FM+BW + Welch, brpm)                 │  │
│ │ RhythmClassifierV2         (jerárquico AF/bigeminy/ectopia +        │  │
│ │                             morfología real + Poincaré 3D)          │  │
│ └─────────────────────────────────────┬───────────────────────────────┘  │
│   MeasurementGate per metric → OutputState (HIGH/MEDIUM/LOW/RESEARCH/    │
│   WITHHELD); calibrationStore (Supabase + localStorage) for persistence  │
└────────────────────────────────────────┬────────────────────────────────┘
                                         │ VitalSignsResult
                                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                                React UI                                  │
│   12 vital cards + DebugPanel (live telemetry) + calibration wizards     │
└──────────────────────────────────────────────────────────────────────────┘
```

## 2. Threading model

- All processors run on the main thread.
- The capture canvas is an `OffscreenCanvas` when the browser supports it
  (Phase 2-lite); otherwise a hidden `HTMLCanvasElement`.
- A full Web Worker port was scoped out — the existing pipeline already
  runs in <8 ms/frame on a desktop CPU (vitest bench), and `getImageData`
  is the only blocking call (≈300 µs) that benefits little from offloading
  given the message-passing overhead.

## 3. Data flow contracts

- `ProcessedSignal` (`src/types/signal.d.ts`): per-frame summary emitted by
  PPGSignalProcessor — includes `telemetry` with OD, linear RGB, drift,
  source SQI map, FPS, processing time.
- `VitalSignsResult` (`src/modules/vital-signs/VitalSignsProcessor.ts`):
  every emission of vitals contains explicit `outputStates` per modality
  (HIGH / MEDIUM / LOW / RESEARCH / WITHHELD) and rich detail objects
  (`hrv`, `stress`, `respiration`, `hemoglobin`, …).

## 4. Calibration storage

Two-tier (`src/services/calibrationStore.ts`):
1. **Supabase** `public.user_calibrations` (RLS, one row per modality)
   when the user is authenticated.
2. **localStorage** (`cppg.calibration.<modality>`) always — synchronous
   boot-time hydration of the V3 processors.

Modalities: `spo2_v3`, `bp_v3`, `glucose_v3`, `lipids_v3`, `hemoglobin_v1`,
`device_profile_v1`.

## 5. Anti-simulation guarantees

- No `Math.random()` anywhere in the runtime path (only in deterministic
  golden-signal generators for tests).
- Every value emitted to UI carries a confidence and a status from
  `MeasurementGate` — modules either publish a real number or withhold.
- `RESEARCH_ONLY` is sticky for Glucose/Lipids and for Hemoglobin without
  paired-lab calibration.
