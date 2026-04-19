# cPPG Vitals — Smartphone-Camera Vital Signs

A contact-PPG (cPPG) web app that turns the rear camera + flash of any
modern phone into a multi-modal vital signs monitor. The pipeline is
fully deterministic: every value emitted to the UI comes from real signal
math (no `Math.random()`, no fakes, no fallbacks that hide failures).

## What it measures

| Vital sign | Method | Status |
|---|---|---|
| Heart rate (BPM) | Triple detector (prominence + slope-sum + Pan-Tompkins) + Goertzel + Kalman1D | ✅ |
| SpO2 | Multi-channel R/G + R/B ratio-of-ratios, ridge calibration | ✅ |
| Blood pressure | 16-feature ridge regression (LOO-RMSE), ≥5 cuff calibration points | ✅ calibrable |
| Respiratory rate | AM+FM+BW modulations + Welch PSD over the 0.10–0.50 Hz band | ✅ |
| HRV (time + freq + non-linear) | SDNN, RMSSD, pNN50, SD1/SD2, LF/HF via Lomb-Scargle, DFA α1, SampEn | ✅ |
| Stress index | Baevsky SI + LF/HF + RMSSD + HR elev + PI variability | ✅ |
| Hemoglobin (g/dL) | Ridge over RGB + Beer-Lambert OD; WHO anemia screening | 🔬 research |
| Glucose (mg/dL) | Ridge with OD features + morphology | 🔬 research |
| Lipids (TC/LDL/HDL/Trig) | Per-target ridge | 🔬 research |
| Arrhythmia detection | Hierarchical: AF / bigeminy / trigeminy / ectopia + Poincaré 3D + morphology | ✅ |

## Getting started

```bash
npm install
npm run dev          # http://localhost:8080
npm run build        # production build
npm run test:run     # unit tests
npm run test:coverage  # coverage report
```

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — pipeline + data flow
- [`docs/algorithms.md`](./docs/algorithms.md) — math + paper references
- [`docs/calibration-guide.md`](./docs/calibration-guide.md) — per-modality calibration
- [`docs/medical-validation.md`](./docs/medical-validation.md) — anti-simulation policy

## Disclaimer

This is a research-grade tool for personal monitoring and informatics
study. It is NOT a medical device and is NOT FDA/CE cleared. BP and
biomarker estimates require user calibration against a validated reference
device; without calibration, the app marks them as RESEARCH_ONLY and
withholds high-confidence claims.
