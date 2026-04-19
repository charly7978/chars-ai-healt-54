# Calibration Guide

The app ships with sane population priors so you can use it immediately,
but every advanced biomarker improves dramatically when calibrated against
a reference device. This guide walks through every modality.

> All calibrations are stored per-user in Supabase (when authenticated)
> and additionally cached in `localStorage` for offline / fast-boot use.

---

## 1. Heart rate, SpO2 — works out of the box

- HR is computed by HeartBeatProcessor and gated by SQI; no calibration
  needed for adults 30–200 bpm.
- SpO2 has a default device profile and publishes immediately. To improve
  per-device accuracy, see §2 below.

---

## 2. SpO2 user calibration (V3 multi-channel)

You need a fingertip pulse oximeter as a reference. Capture 3–5 readings
across different SpO2 levels (rest vs. brief breath-hold).

```ts
import { useVitalSignsProcessor } from '@/hooks/useVitalSignsProcessor';
const v = useVitalSignsProcessor();

// During a measurement, when the oximeter shows e.g. 98%:
v.processorRef.current?.addSpO2UserCalibrationPoint(
  98 /* reference SpO2 */,
  measuredR /* current R from rgbStats.ratioRG */,
  measuredRG, measuredRB
);
```

Once ≥3 points are added the V3 quadratic ridge is built and persisted.

---

## 3. Blood pressure (BP V3 ridge)

You need a validated cuff sphygmomanometer (e.g. Omron M3). Capture **5+
paired measurements** at varied SBP (resting → post-stair → arm-up).

```ts
v.processorRef.current?.startBPCalibrationWizard('omron', userId);
v.processorRef.current?.addBPCalibrationPoint(
  v2Features /* legacy V2 vector */,
  refSBP, refDBP,
  v3Features /* full 16-dim BPV3Features */
);
// repeat ≥5 times across different physiological states
const result = v.processorRef.current?.finishBPCalibrationWizard();
// result.rmseSBP / .rmseDBP — leave-one-out CV RMSE
```

Acceptance: LOO-RMSE-SBP < 12 mmHg → MEDIUM confidence; < 8 mmHg → HIGH.

---

## 4. Glucose (RESEARCH_ONLY)

You need a glucometer. Collect ≥20 samples spanning ≥30 mg/dL (e.g. fasting
+ post-prandial).

```ts
v.processorRef.current?.startGlucoseV3Training();
v.processorRef.current?.addGlucoseV3TrainingSample(features, refMgDl);
// ...
v.processorRef.current?.finishGlucoseV3Training();
```

Status remains RESEARCH_ONLY even after training — RGB cameras lack the NIR
window glucose absorbs strongest.

---

## 5. Lipids (RESEARCH_ONLY)

Lab panels (10+ paired) per session for total cholesterol, LDL, HDL,
triglycerides:

```ts
v.processorRef.current?.startLipidsV3Training();
v.processorRef.current?.addLipidsV3TrainingSample(features, {
  totalCholesterol, ldl, hdl, triglycerides,
});
v.processorRef.current?.finishLipidsV3Training();
```

---

## 6. Hemoglobin (screening / research)

Need a venous Hb measurement. ≥3 paired points unlock per-user ridge:

```ts
v.processorRef.current?.startHemoglobinCalibrationWizard();
v.processorRef.current?.addHemoglobinCalibrationPoint(features, refHbgDl);
v.processorRef.current?.finishHemoglobinCalibrationWizard();
```

Until calibrated, the app emits a sex-adjusted population prior with
RESEARCH_ONLY status. The anemia screening flag uses WHO thresholds
(M < 13, F < 12 g/dL).

---

## 7. HRV / Stress / Respiration

No calibration required — these are time-series math on the validated
RR series + PPG. Quality of estimates rises with measurement length:
- ≥30 s recording → SDNN/RMSSD reliable
- ≥60 s recording → LF/HF + DFA + SampEn reliable
- ≥45 s recording → respiratory rate reliable

---

## 8. Persistence

All calibrations persist automatically:
- Supabase row in `user_calibrations(user_id, modality)` when authenticated
- `localStorage['cppg.calibration.<modality>']` always

Reset:

```ts
import { deleteCalibration } from '@/services/calibrationStore';
await deleteCalibration('bp_v3');
```
