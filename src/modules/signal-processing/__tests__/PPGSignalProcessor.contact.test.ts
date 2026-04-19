/**
 * Audit fix regression — verifies the FingerContactClassifier evidence
 * actually reaches ProcessedSignal.telemetry. Previously the classifier
 * was instantiated, called every frame, and its output was silently
 * discarded.
 */
import { describe, it, expect } from 'vitest';
import { PPGSignalProcessor } from '../PPGSignalProcessor';
import { generateSyntheticImageData } from '../../../__tests__/utils/golden-signals';
import type { ProcessedSignal } from '../../../types/signal';

const collect = (n: number, opts: Parameters<typeof generateSyntheticImageData>[2]) => {
  const out: ProcessedSignal[] = [];
  const proc = new PPGSignalProcessor((s) => out.push(s));
  proc.start();
  for (let i = 0; i < n; i++) {
    const img = generateSyntheticImageData(64, 48, { ...opts, frameIdx: i });
    proc.processFrame(img, 1000 + i * 33);
  }
  proc.stop();
  return out;
};

describe('PPGSignalProcessor — contact evidence wiring', () => {
  it('publishes contact classifier evidence on every frame', () => {
    const signals = collect(15, { redMean: 200, greenMean: 90, blueMean: 70, pulseDelta: 8 });
    expect(signals.length).toBeGreaterThan(10);
    for (const s of signals) {
      expect(s.telemetry).toBeDefined();
      // contactConfidence is always populated, even when NO_CONTACT.
      expect(s.telemetry?.contactConfidence).toBeTypeOf('number');
      expect(s.telemetry?.signalUsabilityScore).toBeTypeOf('number');
      expect(s.telemetry?.pressureIndex).toBeTypeOf('number');
      expect(Array.isArray(s.telemetry?.rejectionReasons)).toBe(true);
    }
  });

  it('rejects a uniform dark frame with explicit reasons', () => {
    const signals = collect(15, { redMean: 1, greenMean: 1, blueMean: 1 });
    const last = signals[signals.length - 1];
    expect(last.telemetry?.contactConfidence ?? 1).toBeLessThan(0.5);
    expect(last.fingerDetected).toBe(false);
    expect(last.contactState).toBe('NO_CONTACT');
    expect(last.telemetry?.rejectionReasons?.length ?? 0).toBeGreaterThan(0);
  });

  it('caps quality when usability is poor (no inflation possible)', () => {
    // Saturated frame: high clip → classifier saturationScore drops →
    // signalUsabilityScore should drop AND gatedQuality should be capped.
    const signals = collect(20, { redMean: 254, greenMean: 254, blueMean: 254 });
    for (const s of signals) {
      expect(s.quality).toBeLessThanOrEqual(35);
    }
  });
});
