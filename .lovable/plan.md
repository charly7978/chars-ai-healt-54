

# Plan: Fix PPG Pipeline — 4 Critical Bugs Preventing Signal Detection

## Root Cause Analysis

After tracing the entire data flow (Camera → Worker → PPGSignalProcessor → Index.tsx → HeartBeatProcessor → VitalSigns), I found **4 critical bugs** that together prevent any heartbeat detection:

### Bug 1: PulseSignalExtractor DC Floor Guard Kills Finger-PPG (MOST CRITICAL)
In `PulseSignalExtractor.ts` line 49: `if (mr < 80 || mg < 80 || mb < 80) return null;`

When flash illuminates through a finger, typical channel values are:
- Red: 180-250 (transmitted well)
- Green: 60-120 (partially absorbed)
- **Blue: 20-60 (strongly absorbed by blood)**

Blue is almost always below 80 through tissue. This means **POS/CHROM always returns null**, and the system falls back to WTA which is much weaker without POS/CHROM's illumination-noise cancellation. The primary algorithm never runs.

**Fix**: Only require Red > 50 and Green > 30 (the channels actually used in POS). Blue can be very low for contact PPG.

### Bug 2: HeartBeatProcessor Never Receives Signal Quality
In `useHeartBeatProcessor.ts` line 74: `processorRef.current.processSignal(value, timestamp)` — the third parameter `signalQuality` is never passed. The auto-reset logic at HeartBeatProcessor line 117 (`if (signalQuality !== undefined && signalQuality < 10)`) never triggers because it's always `undefined`.

**Fix**: Pass `opts?.ppgQuality` as the third argument to `processSignal`.

### Bug 3: Input EMA Too Aggressive (α=0.06)
The HeartBeatProcessor applies an EMA with α=0.06 before peak detection. At 30fps this creates a time constant of ~0.55s, which significantly attenuates the sharp systolic peaks that are only ~0.1-0.15s wide. This merges and flattens peaks, making detection harder.

**Fix**: Increase α to 0.15 (lighter smoothing, preserves peak shape).

### Bug 4: Signal Quality Shows Misleading Values
The `PPGSignalMeter` displays quality metrics from multiple sources with different scales, creating confusion. The coaching bar and debug panel show conflicting information.

**Fix**: Simplify to use only the worker's `signalQuality` (which is properly gated by finger detection). Remove duplicate quality indicators.

---

## Implementation (4 files)

### File 1: `src/modules/signal-processing/PulseSignalExtractor.ts`
- Change DC floor guard from `mr < 80 || mg < 80 || mb < 80` to `mr < 50 || mg < 30` (drop blue requirement entirely — blue is irrelevant for POS/CHROM which uses R, G, B normalized ratios, and blue is always low through tissue)
- Adjust AC/DC check to only require R or G to show pulsatility (not max of all three)

### File 2: `src/hooks/useHeartBeatProcessor.ts`
- Pass `opts?.ppgQuality` as the third argument to `processorRef.current.processSignal(value, timestamp, opts?.ppgQuality)`

### File 3: `src/modules/HeartBeatProcessor.ts`
- Increase `INPUT_EMA_ALPHA` from 0.06 to 0.15 (preserve peak morphology)
- Reduce `rangeS < 0.5` threshold to `rangeS < 0.3` (allow weaker but real signals)

### File 4: `src/components/PPGSignalMeter.tsx`
- Clean up duplicate quality displays — keep only the coaching bar status (COLOCA TU DEDO / ESTABILIZANDO / SEÑAL OK)
- Remove redundant debug metrics that confuse the pipeline state

## Expected Outcome
- **POS/CHROM actually runs** on finger-PPG (currently never runs due to blue channel guard)
- **Peaks are detected** with lighter EMA smoothing
- **Auto-reset works** when finger is removed (signalQuality properly passed)
- **UI shows honest state** without conflicting quality indicators

