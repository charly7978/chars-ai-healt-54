// Biquad IIR (direct form I) implementado para pasabanda simple.
// Coeficientes calculados con bilinear transform aprox.
export class Biquad {
  a0 = 1; a1 = 0; a2 = 0;
  b0 = 1; b1 = 0; b2 = 0;
  z1 = 0; z2 = 0;

  constructor() {}

  // Diseño pasabanda banda centrada en f0 (Hz), Q, fs
  setBandpass(f0: number, Q: number, fs: number) {
    const w0 = 2 * Math.PI * f0 / fs;
    const alpha = Math.sin(w0)/(2*Q);
    const cosw0 = Math.cos(w0);

    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    this.a0 = 1;
    this.z1 = 0; this.z2 = 0;
  }

  processSample(x: number) {
    const y = this.b0 * x + this.b1 * this.z1 + this.b2 * this.z2 - this.a1 * this.z1 - this.a2 * this.z2;
    // update states - using Direct Form I-like simplified
    this.z2 = this.z1;
    this.z1 = x;
    return y;
  }

  processArray(xs: number[]) {
    const out: number[] = [];
    for (const x of xs) out.push(this.processSample(x));
    return out;
  }
}
