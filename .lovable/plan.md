

# Plan: Overhaul PPG Pipeline for Real Signal Detection

## Problem Diagnosis

After thorough code review, I identified **5 critical failures** that cause the app to show "excellent signal" with no finger and fail to detect real heartbeats:

### 1. Finger Detection is Too Permissive (Root Cause #1)
The `detectFinger()` method in `PPGSignalProcessor.ts` uses 11 scoring criteria, but most pass trivially for ambient light (e.g., `totalIntensity > 55` passes for any lit room, `r > 20` is always true). The `FINGER_LOST_FRAMES = 50` means it holds "finger detected" for ~1.7s after losing signal. The enter threshold (`0.42`) is too low and the `torchThroughFinger` bonus (+2 points) triggers for bright ambient scenes.

**Fix**: Require strict red-channel dominance (R > 150, R/G ratio > 1.2, R/B ratio > 1.5) which is physically guaranteed when flash illuminates through finger tissue but impossible for ambient scenes. Reduce `FINGER_LOST_FRAMES` to 15 (~0.5s).

### 2. Signal Quality Never Reaches Zero (Root Cause #2)
`calculateSignalQuality()` gives a `fingerBonus = 15` when finger is "detected" (which is almost always, per above). Additionally, the formula gives points for any signal with variance (SNR, stability, etc.) — even pure noise from an uncovered camera. This is why the quality meter always shows a good reading.

**Fix**: Signal quality must be 0 when finger is not detected. No bonus for finger detection — instead, finger detection gates the entire quality calculation.

### 3. POS/CHROM Scaling Creates Noise Floor
`PulseSignalExtractor.ts` applies `PULSE_SCALE = 2500` to normalized values. When there's no pulsatile signal (no finger), the normalization divides by near-zero means, creating large spurious values that look like signal.

**Fix**: Add minimum DC level check (>80 per channel) before POS/CHROM computation. Return null if DC is too low.

### 4. HeartBeatProcessor Accepts Noise Peaks
The peak detector has no amplitude floor — any signal with `range > 0.05` passes. On noise from an uncovered camera, random fluctuations create false zero-crossings in the derivative that pass the detection criteria.

**Fix**: Require minimum absolute amplitude threshold tied to the envelope tracking. Require consecutive valid beats pattern (at least 3 beats with physiologically consistent intervals) before reporting BPM > 0.

### 5. VitalSigns Processor Generates Values from Noise
`calculateGlucoseRaw()`, `calculateHemoglobinRaw()`, `calculateLipidsRaw()` produce non-zero values from any non-zero features — they use additive formulas that always yield a positive number regardless of whether the input is real physiological signal.

**Fix**: Gate all vital sign calculations behind strict finger detection AND minimum signal quality (SQI > 40). Return 0 for all metrics when conditions aren't met.

---

## Implementation Plan

### Phase 1: Strict Finger Detection (`PPGSignalProcessor.ts`)
- Replace the permissive 11-point scoring with hard physiological thresholds:
  - Red channel mean > 140 (flash through finger is always bright red)
  - R/G ratio > 1.15 (blood absorbs green, passes red)
  - R/B ratio > 1.4
  - Total intensity > 200
  - Coverage score > 0.6 (most tiles must be "finger-colored")
- Reduce `FINGER_LOST_FRAMES` from 50 to 15
- Increase `FINGER_CONFIRM_FRAMES` from 3 to 5

### Phase 2: Signal Quality Gated by Finger (`PPGSignalProcessor.ts`)
- If `fingerDetected === false`, signal quality = 0 (hard gate)
- Remove the `fingerBonus` hack
- Require minimum perfusion index > 0.1 before quality can exceed 20

### Phase 3: POS/CHROM Guard (`PulseSignalExtractor.ts`)
- Add DC floor check: all channel means must be > 80 before computing normalized pulse
- Add AC/DC ratio minimum: if no channel has AC/DC > 0.05%, return null
- When returning null, the processor falls back to WTA which also won't produce meaningful signal without a finger

### Phase 4: HeartBeatProcessor Hardening (`HeartBeatProcessor.ts`)
- Require minimum 3 consecutive physiologically consistent beats (RR interval coefficient of variation < 30%) before reporting BPM
- Add minimum absolute amplitude threshold: peak amplitude must be > 1.0 (calibrated from the POS scale)
- When finger is lost (signal quality < 10 for > 1 second), immediately reset BPM to 0 and clear RR history

### Phase 5: Vital Signs Gating (`VitalSignsProcessor.ts`)
- Gate ALL metric calculations behind `signalQuality >= 40` AND `validPulseCount >= 5`
- When conditions aren't met, explicitly set all values to 0 and show "--" in the UI
- Remove the `minQualityForCalculation = 15` (too low — raise to 40)

### Phase 6: UI Honesty (`PPGSignalMeter.tsx`, `Index.tsx`)
- When `fingerDetected === false`, show clear "COLOCA TU DEDO" message with red indicator
- When `fingerDetected === true` but quality < 30, show "ESTABILIZANDO..." in yellow
- Only show "SEÑAL OK" when quality > 50
- Show "--" for all vital signs when quality is insufficient

---

## Files Modified (6 files)

| File | Changes |
|------|---------|
| `src/modules/signal-processing/PPGSignalProcessor.ts` | Strict finger detection, quality gating |
| `src/modules/signal-processing/PulseSignalExtractor.ts` | DC floor guard |
| `src/modules/HeartBeatProcessor.ts` | Amplitude threshold, consecutive beat validation |
| `src/modules/vital-signs/VitalSignsProcessor.ts` | Quality gate raised to 40, full metric gating |
| `src/pages/Index.tsx` | Pass finger detection state, zero metrics on no-finger |
| `src/components/PPGSignalMeter.tsx` | Honest status messaging |

## Expected Behavior After Fix
- **No finger**: Quality = 0, BPM = 0, all metrics "--", red "COLOCA TU DEDO" indicator
- **Finger placed, stabilizing**: Quality rises 0→50 over ~3-5 seconds, yellow "ESTABILIZANDO"
- **Finger stable**: Quality > 50, green "SEÑAL OK", real BPM appears after ~3 beats, vital signs calculate from real data
- **Finger removed mid-measurement**: Quality drops to 0 within 0.5s, metrics freeze then clear

