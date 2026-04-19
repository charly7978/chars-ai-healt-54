# Algorithm Index — math + references

This file lists every signal-processing primitive and biomarker estimator
in the app, with the math summary and the reference paper(s) each is based
on. Use it as a desk reference when reviewing or extending the code.

---

## Signal processing

### `RadiometricProcessor` — sRGB → Linear → OD
- `processTileRGB(R,G,B)`: removes dark offset, applies gamma, gain,
  computes optical density `OD = −log(I / Iref)` per channel.
- Refs: van Gastel et al. (Philips, 2016); CIE sRGB; Tremper & Barker.

### `AdaptiveROIMask` (7×7 tiles)
- Per-tile percentile-thresholded coverage with center-bias and temporal
  intersection.
- Outputs both raw and linearized RGB + per-channel OD.

### `TileFusionEngine` — Huber + trimmed mean
- Robust spatial fusion (Tukey 1960; Huber 1981; Hampel 1986).
- 80% Huber-weighted mean + 20% trimmed mean + temporal EMA.

### `POSExtractor` — Plane-Orthogonal-to-Skin
- Wang, den Brinker, Stuijk & de Haan (2017), IEEE TBME 64(7):1479-1491.
- Sliding 1.6 s window. Output `y = S1 + (σ₁/σ₂)·S2` with
  `S1 = G/Ḡ − B/B̄`, `S2 = G/Ḡ + B/B̄ − 2R/R̄`.

### `CHROMExtractor` — chrominance-based
- de Haan & Jeanne (2013), IEEE TBME 60(10):2878-2886.
- `X = 3R/R̄ − 2G/Ḡ`, `Y = 1.5R/R̄ + G/Ḡ − 1.5B/B̄`,
  output `S = X − (σ_X/σ_Y)·Y`.

### `BandpassFilter` — 0.5–5 Hz Butterworth biquads + EWMA detrend
- IIR 2nd order + slow EWMA baseline removal.

### `WaveletDenoiser` — Haar + Donoho soft-threshold
- Donoho (1995); Sweldens (1996).
- Threshold `λ = 1.4 · σ_MAD · √(2 log N)` per finest detail; softer at
  deeper levels.

### `PanTompkinsDetector` (PPG-adapted)
- Pan & Tompkins (1985), IEEE TBME 32(3):230-236.
- 5-tap derivative → square → 150 ms moving-window integrator → adaptive
  thresholds (0.125 weight Hamilton-Tompkins).

### `GoertzelBank` — selective DFT
- Goertzel (1958). 61 cardiac bins from 0.5..3.5 Hz.

### `Kalman1D` — scalar adaptive Kalman
- Random-walk model with adaptive measurement variance R from upstream
  SQI; used to smooth final BPM.

### `SignalSourceRanker` — 8-source winner-take-all
- Candidates: R, G, RG, absR, absG, diffRG, **POS**, **CHROM**.
- SQI per source = SNR + autocorrelation periodicity − ZC penalty −
  drift − clipping − motion. POS/CHROM get +25% under motion.

### `SignalQualityEstimator`
- Combines perfusion, periodicity, coverage, uniformity, range, source
  stability, motion/clip/drift penalties, contact bonus, pressure
  multiplier into 0..100 SQI.

---

## Heartbeat fusion (V2.1)

`HeartBeatProcessor`:
- Triple-detector arbitration (prominence + slope-sum + Pan-Tompkins).
- BPM hypotheses: lastIBI, medianIBI, trimmedIBI, autocorrBPM, spectralBPM
  (Goertzel). Final BPM through Kalman1D with adaptive R.

---

## HRV + Stress

`HRVTimeFreqProcessor`:
- Time-domain (Task Force ESC/NASPE, 1996): SDNN, RMSSD, pNN20/50, SD1/2,
  HRVTI, TINN.
- Frequency-domain via **Lomb-Scargle** (Lomb 1976; Scargle 1982; Press et
  al. NR §13.8) on uneven RR samples — no resampling artifacts.
- Bands: VLF <0.04 Hz, LF 0.04–0.15 Hz, HF 0.15–0.4 Hz; LF/HF, LFnu, HFnu,
  peakHfHz.
- Non-linear: DFA α1 (Peng 1995, n=4..16), Sample Entropy (Richman & Moorman
  2000) m=2 r=0.2·SDNN.

`StressProcessor`:
- Baevsky SI = AMo / (2·Mo·MxDMn) over central 95% (Baevsky 2008).
- Components weighted: Baevsky 0.30, LF/HF 0.25, parasymp withdrawal 0.20,
  HR elevation 0.15, PI variability CV 0.10. Output 0..100 +
  REPOSO/NORMAL/ALERTA/ESTRES_ALTO.

---

## Respiratory rate

`RespiratoryRateProcessor`:
- Three modulations (Charlton et al. 2016, IPEM):
  - **AM**: per-beat (peak − valley) amplitude.
  - **FM**: 60000/RR series (instantaneous HR).
  - **BW**: very-slow EWMA envelope of PPG (~3 s τ).
- Each resampled to 4 Hz uniform; **Welch PSD** (segmented + Hann);
  peak in 0.10–0.50 Hz band; SNR weighted.
- SNR-weighted median fusion (FM gets +10% structural bonus per Charlton).

---

## SpO2 V3

`SpO2ProcessorV3`:
- Two ratio-of-ratios candidates: `R_RG = (Rac/Rdc)/(Gac/Gdc)`,
  `R_RB = (Rac/Rdc)/(Bac/Bdc)`. Fused as `R = α·R_RG + (1-α)·R_RB`.
- Quadratic calibration `SpO2 = A + B·R + C·R²` via 3×3 normal equations
  with Tikhonov ridge (λ ≥ 1e-3) — Cramer's rule solver.
- α auto-grid search [0.40, 0.85] over 19 steps minimizing calibration
  RMSE when blue ratios are present.
- Reference: Banerjee et al. (2021), arXiv:2107.08528.

---

## Blood pressure V3

`BloodPressureProcessorV3` + `RidgeRegressor`:
- 16-feature vector: stiffnessIndex, augmentationIndex, sutMs, pw50/75/25,
  crestTimeMs, dicroticDepth, areaRatio, pwvProxy, hr, rrSDNN, rrRMSSD,
  apgBDivA, apgDDivA, apgAGI.
- Closed-form ridge: `w* = (XᵀX + λI)⁻¹ Xᵀy`, Cholesky-solved (SPD when
  λ>0). λ auto-grid by minimum LOO-RMSE.
- Calibration ≥5 cuff points (V2 needed 3); reports honest LOO-RMSE.
- SOTA reference (deep-learning, MIMIC):
  - Wang et al. 2025 CNN-BiLSTM-Att, MAE 1.88/1.34 mmHg.
  - Hu et al. 2025 Stacked U-Net, MAE 3.92/2.44 mmHg.

---

## Glucose V3 (research)

`GlucoseResearchProcessorV3`:
- 15-feature ridge with Beer-Lambert OD (odR/G/B) added.
- Training requires ≥20 samples and ≥30 mg/dL coverage span; auto-λ.
- Output forever `OutputStatus.RESEARCH_ONLY` because RGB cameras lack
  the NIR window (~940 nm) where glucose absorbs strongest.
- SOTA reference: Sahranavard 2024 Sci Rep, RMSE 19.7 mg/dL.

## Lipids V3 (research)

`LipidResearchProcessorV3`:
- One ridge per target (totalCholesterol / LDL / HDL / triglycerides).
- 13-feature vector. Auto-λ, per-target LOO-RMSE.
- Same RESEARCH_ONLY gating.

## Hemoglobin (screening / research)

`HemoglobinProcessor`:
- Ridge over 12 features including OD R/G/B + perfusion + morphology +
  rgRatio. Population prior with sex modulation when uncalibrated.
- Anemia screening flag (WHO: F<12, M<13 g/dL).
- SOTA reference: Devadhasan et al. 2024 Nature Sci Rep — RGB-imaging
  ROC-AUC 0.83.

---

## Arrhythmias

`RhythmClassifierV2` (with Phase 14 enhancements):
- Hierarchical: AF → bigeminy → trigeminy → ectopia → brady/tachy
  irregular → irregular_undetermined → sinus_variable → sinus_regular.
- Real morphology features (ampCV, widthCV, dicroticStd) and
  **Poincaré 3D dispersion** (std of distance from RR cube diagonal)
  feed into AF evidence.
- Persistence-based temporal smoothing per label.

---

## Persistence

`calibrationStore.ts`:
- Supabase `user_calibrations` (RLS, JSONB payload, UNIQUE per modality).
- localStorage L1 cache for offline / pre-auth boot.
