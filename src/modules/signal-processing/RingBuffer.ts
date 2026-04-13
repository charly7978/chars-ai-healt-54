/**
 * HIGH-PERFORMANCE RING BUFFER - Float64Array backed
 * Zero allocation in hot path. No push/shift overhead.
 */
export class RingBuffer {
  private buffer: Float64Array;
  private head = 0;
  private count = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Float64Array(capacity);
  }

  push(value: number): void {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get length(): number {
    return this.count;
  }

  /** Get value at logical index (0 = oldest) */
  get(index: number): number {
    if (index < 0 || index >= this.count) return 0;
    const realIndex = (this.head - this.count + index + this.capacity) % this.capacity;
    return this.buffer[realIndex];
  }

  /** Get last N values as a new array (allocates — use sparingly) */
  last(n: number): Float64Array {
    const len = Math.min(n, this.count);
    const out = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = this.get(this.count - len + i);
    }
    return out;
  }

  /** Get the most recent value */
  latest(): number {
    if (this.count === 0) return 0;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  /** Compute mean of last N values without allocation */
  mean(n?: number): number {
    const len = Math.min(n ?? this.count, this.count);
    if (len === 0) return 0;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += this.get(this.count - len + i);
    }
    return sum / len;
  }

  /** Compute variance of last N values without allocation */
  variance(n?: number): number {
    const len = Math.min(n ?? this.count, this.count);
    if (len < 2) return 0;
    const m = this.mean(len);
    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      const d = this.get(this.count - len + i) - m;
      sumSq += d * d;
    }
    return sumSq / len;
  }

  /** Find min/max of last N values */
  minMax(n?: number): { min: number; max: number } {
    const len = Math.min(n ?? this.count, this.count);
    if (len === 0) return { min: 0, max: 0 };
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < len; i++) {
      const v = this.get(this.count - len + i);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }

  /** Percentile without full sort — partial selection */
  percentile(p: number, n?: number): number {
    const len = Math.min(n ?? this.count, this.count);
    if (len === 0) return 0;
    // For small buffers, just sort
    const arr = new Float64Array(len);
    for (let i = 0; i < len; i++) arr[i] = this.get(this.count - len + i);
    arr.sort();
    const idx = Math.floor(p * (len - 1));
    return arr[idx];
  }

  /** Autocorrelation at given lag over last N samples */
  autocorrelation(lag: number, n?: number): number {
    const len = Math.min(n ?? this.count, this.count);
    if (lag >= len || len < 10) return 0;
    const m = this.mean(len);
    let cross = 0, eA = 0, eB = 0;
    const start = this.count - len;
    for (let i = lag; i < len; i++) {
      const a = this.get(start + i) - m;
      const b = this.get(start + i - lag) - m;
      cross += a * b;
      eA += a * a;
      eB += b * b;
    }
    const denom = Math.sqrt(eA * eB);
    return denom > 0 ? cross / denom : 0;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
