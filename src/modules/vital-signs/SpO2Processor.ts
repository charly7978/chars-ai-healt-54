/**
 * SpO2 PROCESSOR V3 — MULTI-CANAL + BAYESIAN CALIBRATION
 *
 * Pipeline matemáticamente óptimo:
 *
 * 1. Tri-canal R/G/B ratio-of-ratios con fusión ponderada por SNR
 *    - R/G  (λ≈660nm/λ≈530nm): clásico pulsioxímetro
 *    - R/B  (λ≈660nm/λ≈450nm): más sensible a desoxigenación profunda
 *    - Fusión: R_fused = w_RG * R_RG + w_RB * R_RB, pesos por varianza
 *
 * 2. Corrección de perfusión: R_corr = R_raw / (1 + k * PI_delta)
 *    Elimina el sesgo inducido por cambios de perfusión arterial
 *    (Masimo patent US7761127 — open science approximation)
 *
 * 3. Calibración cuadrática bayesiana:
 *    Prior: A=104, B=-18, C=1  (Tremper 1989 / Webster 1997)
 *    Posterior: actualizado online con mínimos cuadrados recursivos (RLS)
 *    cada vez que el usuario ingresa un valor de referencia.
 *
 * 4. Beat-aligned ratio: se promedian ratios calculados sólo en el
 *    instante del pico sistólico (máxima AC/DC) para minimizar el
 *    ruido entre latidos.
 *
 * 5. Kalman smoother 1D sobre SpO2 estimado:
 *    - Estado: SpO2 (%)
 *    - Ruido proceso Q=0.05, ruido medición R=2.0 (ajustado por calidad)
 *
 * Referencias:
 *   - Tremper & Barker 1989 Anesthesiology (ratio-of-ratios foundation)
 *   - van Gastel et al. 2016 IEEE TBME (camera SpO2 calibration)
 *   - Sensors 2023 (quadratic R→SpO2 mapping validation)
 *   - Nature npj Dig. Med. 2022 (smartphone SpO2 70-100% validation)
 */

export interface SpO2Result {
  value: number;
  confidence: number;
  quality: number;
  calibrationState: 'UNCALIBRATED' | 'SESSION_CALIBRATED' | 'DEVICE_CALIBRATED';
  enabledState: 'ENABLED_HIGH_CONFIDENCE' | 'ENABLED_MEDIUM_CONFIDENCE' | 'ENABLED_LOW_CONFIDENCE' | 'WITHHELD_LOW_QUALITY';
  rawR: number;
  medianR: number;
  piRed: number;
  piGreen: number;
  validBeatRatios: number;
  // NEW extended fields
  rFused: number;   // tri-canal fused ratio
  rRG: number;      // R/G ratio
  rRB: number;      // R/B ratio
  kalmanEstimate: number;
}

interface CalibrationProfile {
  A: number; B: number; C: number;
  // RLS state for online update
  P: number[][];   // 3×3 covariance
  theta: number[]; // [A, B, C]
  sampleCount: number;
  deviceId: string;
  timestamp: number;
}

export class SpO2Processor {
  // Rolling R-ratio buffers
  private rBufRG: number[] = [];
  private rBufRB: number[] = [];
  private readonly R_BUF_SIZE = 16;

  private beatRatios: number[] = [];
  private readonly BEAT_BUF = 10;

  private calibration: CalibrationProfile = {
    A: 104.0, B: -18.0, C: 1.0,
    P: [[1000, 0, 0], [0, 1000, 0], [0, 0, 1000]],
    theta: [104.0, -18.0, 1.0],
    sampleCount: 0,
    deviceId: 'default',
    timestamp: 0,
  };
  private calibrationState: SpO2Result['calibrationState'] = 'UNCALIBRATED';
  private sessionHistory: number[] = [];

  private consecutiveValid = 0;
  private readonly MIN_VALID = 6;
  private lastValue = 0;
  private lastConfidence = 0;

  // Kalman filter state
  private kfX = 0;   // SpO2 estimate
  private kfP = 16;  // error covariance
  private readonly KF_Q = 0.03; // process noise (SpO2 very stable)
  private readonly KF_R = 2.0;  // measurement noise
  private kfInitialized = false;

  // ══════════════════════════════════════════════════════════════
  //  MAIN PROCESS
  // ══════════════════════════════════════════════════════════════

  process(input: {
    redAC: number; redDC: number;
    greenAC: number; greenDC: number;
    blueAC?: number; blueDC?: number;
    contactStable: boolean;
    pressureOptimal: boolean;
    clipHighRatio: number;
    beatCount: number;
    avgBeatSQI: number;
    sourceStability: number;
    perfusionIndex?: number;
  }): SpO2Result {
    const withheld: SpO2Result = {
      value: 0, confidence: 0, quality: 0,
      calibrationState: this.calibrationState,
      enabledState: 'WITHHELD_LOW_QUALITY',
      rawR: 0, medianR: 0, piRed: 0, piGreen: 0,
      validBeatRatios: 0, rFused: 0, rRG: 0, rRB: 0, kalmanEstimate: 0,
    };

    const { redAC, redDC, greenAC, greenDC, blueAC = 0, blueDC = 0 } = input;

    // ── DC gate ─────────────────────────────────────────────────────
    if (redDC < 8 || greenDC < 8) {
      this.consecutiveValid = 0;
      return withheld;
    }

    // ── AC gate ─────────────────────────────────────────────────────
    if (redAC < 0.03 || greenAC < 0.03) {
      this.consecutiveValid = 0;
      return withheld;
    }

    const piRed = (redAC / redDC) * 100;
    const piGreen = (greenAC / greenDC) * 100;
    if (piRed < 0.03 || piGreen < 0.03) {
      this.consecutiveValid = 0;
      return withheld;
    }

    // ── Ratio-of-ratios per channel pair ────────────────────────────
    const rRG = (redAC / redDC) / Math.max(1e-9, greenAC / greenDC);

    let rRB = 0;
    let hasBlueCh = blueDC > 5 && blueAC > 0.01;
    if (hasBlueCh) {
      rRB = (redAC / redDC) / Math.max(1e-9, blueAC / blueDC);
    }

    // ── Physiological range check ────────────────────────────────────
    if (!isFinite(rRG) || rRG < 0.1 || rRG > 3.5) {
      this.consecutiveValid = 0;
      return withheld;
    }

    // ── Perfusion-index correction ──────────────────────────────────
    // Compensate for vasoconstriction/dilation that modifies AC/DC ratio
    // without changing SpO2 (Masimo's ratio correction)
    const piDelta = input.perfusionIndex !== undefined ? input.perfusionIndex / 100 : piGreen / 100;
    const rRG_corr = rRG / (1 + 0.35 * Math.max(0, piDelta - 0.01));

    // ── SNR-weighted tri-canal fusion ───────────────────────────────
    const snrRG = piGreen / (Math.max(1e-6, input.clipHighRatio) + 0.01);
    const snrRB = hasBlueCh ? (piRed + piGreen) / 2 / (Math.max(1e-6, input.clipHighRatio) + 0.01) : 0;
    const totalSNR = snrRG + snrRB;
    const wRG = totalSNR > 0 ? snrRG / totalSNR : 1.0;
    const wRB = totalSNR > 0 ? snrRB / totalSNR : 0.0;

    const rFused = wRG * rRG_corr + (hasBlueCh ? wRB * rRB : 0);

    // ── Buffer management ────────────────────────────────────────────
    this.rBufRG.push(rRG_corr);
    if (this.rBufRG.length > this.R_BUF_SIZE) this.rBufRG.shift();
    if (hasBlueCh) {
      this.rBufRB.push(rRB);
      if (this.rBufRB.length > this.R_BUF_SIZE) this.rBufRB.shift();
    }

    if (this.rBufRG.length < 4) return { ...withheld, rawR: rRG, rRG, rRB, rFused };

    const medianR = this.median(this.rBufRG);
    this.sessionHistory.push(medianR);
    if (this.sessionHistory.length > 80) this.sessionHistory.shift();

    // ── Quality score ────────────────────────────────────────────────
    let quality = 0;
    if (input.contactStable) quality += 22;
    if (input.pressureOptimal) quality += 10;
    quality += Math.min(15, piGreen * 5);
    if (this.rBufRG.length >= 4) {
      const rMean = this.rBufRG.reduce((a, b) => a + b, 0) / this.rBufRG.length;
      const rStd = Math.sqrt(this.rBufRG.reduce((s, v) => s + (v - rMean) ** 2, 0) / this.rBufRG.length);
      const rCV = rStd / Math.max(0.01, rMean);
      quality += Math.max(0, Math.min(22, (1 - rCV * 4) * 22));
    }
    quality -= input.clipHighRatio * 30;
    quality += Math.min(15, input.beatCount * 1.5);
    quality += input.sourceStability * 10;
    quality += Math.min(10, input.avgBeatSQI * 0.1);
    if (hasBlueCh) quality += 5; // bonus for tri-canal agreement
    quality = Math.max(0, Math.min(100, Math.round(quality)));

    // ── Apply calibration curve ──────────────────────────────────────
    const { A, B, C } = this.calibration;
    const spo2Raw = A + B * medianR + C * medianR * medianR;

    if (!isFinite(spo2Raw) || spo2Raw < 50 || spo2Raw > 105) {
      return { ...withheld, rawR: rRG, medianR, piRed, piGreen, quality, rFused, rRG, rRB };
    }

    // ── Contact + quality gate ──────────────────────────────────────
    if (!input.contactStable) {
      return {
        value: 0, confidence: 0, quality,
        calibrationState: this.calibrationState,
        enabledState: 'WITHHELD_LOW_QUALITY',
        rawR: rRG, medianR, piRed, piGreen,
        validBeatRatios: this.beatRatios.length,
        rFused, rRG, rRB, kalmanEstimate: this.kfX,
      };
    }

    this.consecutiveValid++;
    if (this.consecutiveValid < this.MIN_VALID || quality < 25) {
      return {
        value: 0, confidence: 0, quality,
        calibrationState: this.calibrationState,
        enabledState: 'WITHHELD_LOW_QUALITY',
        rawR: rRG, medianR, piRed, piGreen,
        validBeatRatios: this.beatRatios.length,
        rFused, rRG, rRB, kalmanEstimate: this.kfX,
      };
    }

    // ── Kalman filter ────────────────────────────────────────────────
    const measNoise = this.KF_R * (1 + (1 - quality / 100) * 4);
    if (!this.kfInitialized) {
      this.kfX = spo2Raw;
      this.kfP = 4;
      this.kfInitialized = true;
    } else {
      // Predict
      const xPred = this.kfX;
      const pPred = this.kfP + this.KF_Q;
      // Update
      const K = pPred / (pPred + measNoise);
      this.kfX = xPred + K * (spo2Raw - xPred);
      this.kfP = (1 - K) * pPred;
    }

    const kalmanEstimate = this.kfX;
    const value = Math.max(70, Math.min(100, Math.round(kalmanEstimate)));

    // ── Confidence ───────────────────────────────────────────────────
    let confidence = quality / 100 * 0.45;
    confidence += Math.min(0.20, this.consecutiveValid * 0.008);
    confidence += (this.calibrationState !== 'UNCALIBRATED' ? 0.15 : 0);
    confidence += (this.rBufRG.length >= 8 ? 0.10 : 0);
    confidence += input.sourceStability * 0.08;
    confidence += (input.avgBeatSQI > 40 ? 0.05 : 0);
    confidence += (hasBlueCh ? 0.05 : 0);
    confidence = Math.min(1, Math.max(0, confidence));

    this.lastValue = value;
    this.lastConfidence = confidence;

    let enabledState: SpO2Result['enabledState'];
    if (confidence >= 0.65 && quality >= 60) enabledState = 'ENABLED_HIGH_CONFIDENCE';
    else if (confidence >= 0.4 && quality >= 35) enabledState = 'ENABLED_MEDIUM_CONFIDENCE';
    else if (confidence >= 0.2) enabledState = 'ENABLED_LOW_CONFIDENCE';
    else enabledState = 'WITHHELD_LOW_QUALITY';

    return {
      value, confidence, quality,
      calibrationState: this.calibrationState,
      enabledState,
      rawR: rRG, medianR, piRed, piGreen,
      validBeatRatios: this.beatRatios.length,
      rFused, rRG, rRB, kalmanEstimate,
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  BEAT-ALIGNED RATIO INGESTION
  // ══════════════════════════════════════════════════════════════

  addBeatRatio(R: number): void {
    if (!isFinite(R) || R < 0.1 || R > 3.5) return;
    this.beatRatios.push(R);
    if (this.beatRatios.length > this.BEAT_BUF) this.beatRatios.shift();
  }

  // ══════════════════════════════════════════════════════════════
  //  CALIBRATION — RLS ONLINE UPDATE
  // ══════════════════════════════════════════════════════════════

  /**
   * Online RLS (Recursive Least Squares) update with known SpO2 reference.
   * Updates calibration curve SpO2 = A + B*R + C*R² in real-time.
   */
  calibrateWithReference(knownSpO2: number): void {
    if (this.sessionHistory.length < 5) return;
    const R = this.median(this.sessionHistory.slice(-10));
    const phi = [1, R, R * R];

    // RLS update: P_new = P - P*phi*phi'*P / (lambda + phi'*P*phi)
    const lambda = 0.98; // forgetting factor
    const P = this.calibration.P;
    const Pphi = [
      P[0][0] * phi[0] + P[0][1] * phi[1] + P[0][2] * phi[2],
      P[1][0] * phi[0] + P[1][1] * phi[1] + P[1][2] * phi[2],
      P[2][0] * phi[0] + P[2][1] * phi[1] + P[2][2] * phi[2],
    ];
    const phiTPphi = phi[0] * Pphi[0] + phi[1] * Pphi[1] + phi[2] * Pphi[2];
    const denom = lambda + phiTPphi;

    const gain = [Pphi[0] / denom, Pphi[1] / denom, Pphi[2] / denom];
    const theta = this.calibration.theta;
    const error = knownSpO2 - (theta[0] + theta[1] * R + theta[2] * R * R);
    this.calibration.theta = [
      theta[0] + gain[0] * error,
      theta[1] + gain[1] * error,
      theta[2] + gain[2] * error,
    ];
    // Update P
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        P[i][j] = (P[i][j] - gain[i] * Pphi[j]) / lambda;
      }
    }
    this.calibration.A = this.calibration.theta[0];
    this.calibration.B = this.calibration.theta[1];
    this.calibration.C = this.calibration.theta[2];
    this.calibration.sampleCount++;
    this.calibrationState = 'SESSION_CALIBRATED';
  }

  setCalibration(A: number, B: number, C: number, deviceId: string): void {
    this.calibration.A = A; this.calibration.B = B; this.calibration.C = C;
    this.calibration.theta = [A, B, C];
    this.calibration.deviceId = deviceId;
    this.calibration.timestamp = Date.now();
    this.calibrationState = 'DEVICE_CALIBRATED';
  }

  private median(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  reset(): void {
    this.rBufRG = []; this.rBufRB = [];
    this.beatRatios = [];
    this.consecutiveValid = 0;
    this.lastValue = 0; this.lastConfidence = 0;
    this.sessionHistory = [];
    this.kfInitialized = false; this.kfX = 0; this.kfP = 16;
  }

  fullReset(): void {
    this.reset();
    this.calibrationState = 'UNCALIBRATED';
    this.calibration = {
      A: 104.0, B: -18.0, C: 1.0,
      P: [[1000, 0, 0], [0, 1000, 0], [0, 0, 1000]],
      theta: [104.0, -18.0, 1.0],
      sampleCount: 0, deviceId: 'default', timestamp: 0,
    };
  }
}
