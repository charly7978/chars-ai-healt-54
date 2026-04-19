/**
 * Vitest global setup. Polyfills required by browser APIs that some
 * processors touch indirectly (e.g. performance.now is already provided
 * by happy-dom; AudioContext / DeviceMotionEvent are stubbed when needed
 * inside individual tests).
 */
import { beforeEach, vi } from 'vitest';

// Stable monotonic clock for deterministic timing assertions.
let __now = 0;
beforeEach(() => {
  __now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => __now);
});

(globalThis as any).__advanceTime = (ms: number) => {
  __now += ms;
};
