import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

interface ROIMetrics {
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  coverageRatio: number;
  fingerScore: number;
}

export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing = false;

  private bandpassFilter: BandpassFilter;

  private readonly BUFFER_SIZE = 180;
  private readonly ACDC_WINDOW = 120;
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private vpgBuffer: number[] = [];
  private apgBuffer: number[] = [];

  private redDC = 0;
  private redAC = 0;
  private greenDC = 0;
  private greenAC = 0;

  private frameCount = 0;
  private lastLogTime = 0;

  private fingerDetected = false;
  private signalQuality = 0;
  private fingerConfidenceCount = 0;
  private fingerLostCount = 0;
  private readonly FINGER_CONFIRM_FRAMES = 3;
  private readonly FINGER_LOST_FRAMES = 32;
  private smoothedRed = 0;
  private smoothedGreen = 0;
  private smoothedBlue = 0;
  private smoothedCoverage = 0;
  private smoothedFingerScore = 0;
  private readonly RGB_SMOOTH_ALPHA = 0.16;
  private readonly COVERAGE_SMOOTH_ALPHA = 0.2;

  private motionScore = 0;
  private motionListenerActive = false;
  private lastAcceleration = { x: 0, y: 0, z: 0 };
  private readonly MOTION_THRESHOLD = 0.35;

  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(30);
  }

  async initialize(): Promise<void> {
    this.reset();
    console.log('✅ PPGSignalProcessor inicializado - Captura robusta');
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    this.startMotionListener();
    console.log('🚀 PPGSignalProcessor iniciado');
  }

  stop(): void {
    this.isProcessing = false;
    this.stopMotionListener();
    console.log('🛑 PPGSignalProcessor detenido');
  }

  async calibrate(): Promise<boolean> {
    return true;
  }

  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    const { rawRed, rawGreen, rawBlue, coverageRatio, fingerScore } = this.extractROI(imageData);

    const previousFingerDetected = this.fingerDetected;
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue, coverageRatio, fingerScore);
    const contactLikely = coverageRatio > 0.28 && rawRed > 38 && rawRed > rawBlue;

    if (this.fingerDetected !== previousFingerDetected) {
      this.resetSignalTrackingBuffers();
    }

    const motionArtifact = this.motionScore > this.MOTION_THRESHOLD;

    if (!this.fingerDetected && !contactLikely) {
      this.signalQuality = 0;
      this.onSignalReady({
        timestamp,
        rawValue: 0,
        filteredValue: 0,
        quality: 0,
        fingerDetected: false,
        motionArtifact,
        roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
        perfusionIndex: 0,
        rawRed,
        rawGreen,
        diagnostics: {
          message: `BUSCANDO DEDO C:${(coverageRatio * 100).toFixed(0)}%`,
          hasPulsatility: false,
          pulsatilityValue: 0,
        },
      });
      return;
    }

    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }

    if (this.redBuffer.length >= 45) {
      this.calculateACDCPrecise();
    }

    const { value: signalSource, label: sourceLabel } = this.selectSignalSource(rawRed, rawGreen);
    const inverted = 255 - signalSource;

    this.rawBuffer.push(inverted);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }

    const filtered = this.bandpassFilter.filter(inverted);
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }

    this.calculateDerivatives();
    this.signalQuality = this.calculateSignalQuality();

    const perfusionIndex = this.calculatePerfusionIndex();
    const adjustedQuality = motionArtifact ? Math.max(0, this.signalQuality * 0.55) : this.signalQuality;

    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      console.log(
        `📷 PPG [${sourceLabel}] Raw=${signalSource.toFixed(0)} Filt=${filtered.toFixed(3)} ` +
        `Q=${adjustedQuality.toFixed(0)}% PI=${perfusionIndex.toFixed(2)} C=${(this.smoothedCoverage * 100).toFixed(0)}% ${this.fingerDetected ? '✅' : '❌'}`
      );
    }

    this.onSignalReady({
      timestamp,
      rawValue: inverted,
      filteredValue: filtered,
      quality: adjustedQuality,
      fingerDetected: this.fingerDetected,
      motionArtifact,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      diagnostics: {
        message: `${sourceLabel}:${signalSource.toFixed(0)} PI:${perfusionIndex.toFixed(2)} C:${(this.smoothedCoverage * 100).toFixed(0)}${motionArtifact ? ' MOV' : ''}`,
        hasPulsatility: perfusionIndex > 0.035,
        pulsatilityValue: perfusionIndex,
      },
    });
  }

  private extractROI(imageData: ImageData): ROIMetrics {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    const roiSize = Math.min(width, height) * 0.72;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);

    const tileColumns = 5;
    const tileRows = 5;
    const tiles = Array.from({ length: tileColumns * tileRows }, () => ({
      red: 0,
      green: 0,
      blue: 0,
      count: 0,
    }));

    const roiWidth = Math.max(1, endX - startX);
    const roiHeight = Math.max(1, endY - startY);

    for (let y = startY; y < endY; y += 3) {
      for (let x = startX; x < endX; x += 3) {
        const i = (y * width + x) * 4;
        const tileX = Math.min(tileColumns - 1, Math.floor(((x - startX) / roiWidth) * tileColumns));
        const tileY = Math.min(tileRows - 1, Math.floor(((y - startY) / roiHeight) * tileRows));
        const tile = tiles[tileY * tileColumns + tileX];

        tile.red += data[i];
        tile.green += data[i + 1];
        tile.blue += data[i + 2];
        tile.count++;
      }
    }

    const averagedTiles = tiles
      .filter((tile) => tile.count > 0)
      .map((tile) => {
        const red = tile.red / tile.count;
        const green = tile.green / tile.count;
        const blue = tile.blue / tile.count;
        const total = red + green + blue;
        const redDominance = red - (green + blue) / 2;
        const rednessRatio = red / Math.max(1, green);
        const fingerScore = Math.max(0, redDominance) * 0.45 + rednessRatio * 18 + Math.min(total, 600) * 0.02;

        return { red, green, blue, total, redDominance, fingerScore };
      });

    if (averagedTiles.length === 0) {
      return { rawRed: 0, rawGreen: 0, rawBlue: 0, coverageRatio: 0, fingerScore: 0 };
    }

    const fingerTiles = averagedTiles.filter((tile) =>
      tile.red > 38 &&
      tile.total > 100 &&
      tile.red > tile.green * 0.92 &&
      tile.red > tile.blue * 1.02 &&
      tile.redDominance > 6
    );

    const selectedTiles = fingerTiles.length >= Math.max(5, Math.round(averagedTiles.length * 0.32))
      ? fingerTiles
      : [...averagedTiles]
          .sort((a, b) => b.fingerScore - a.fingerScore)
          .slice(0, Math.max(6, Math.round(averagedTiles.length * 0.6)));

    const weightedAverage = (channel: 'red' | 'green' | 'blue') => {
      let weightedSum = 0;
      let totalWeight = 0;

      for (const tile of selectedTiles) {
        const weight = Math.max(0.2, tile.redDominance + 18);
        weightedSum += tile[channel] * weight;
        totalWeight += weight;
      }

      return totalWeight > 0
        ? weightedSum / totalWeight
        : averagedTiles.reduce((sum, tile) => sum + tile[channel], 0) / averagedTiles.length;
    };

    const coverageRatio = fingerTiles.length / averagedTiles.length;
    const averageFingerScore = selectedTiles.reduce((sum, tile) => sum + tile.fingerScore, 0) / Math.max(1, selectedTiles.length);

    return {
      rawRed: weightedAverage('red'),
      rawGreen: weightedAverage('green'),
      rawBlue: weightedAverage('blue'),
      coverageRatio,
      fingerScore: averageFingerScore / 100,
    };
  }

  private detectFinger(
    rawRed: number,
    rawGreen: number,
    rawBlue: number,
    coverageRatio: number,
    fingerScore: number
  ): boolean {
    if (this.smoothedRed === 0) {
      this.smoothedRed = rawRed;
      this.smoothedGreen = rawGreen;
      this.smoothedBlue = rawBlue;
      this.smoothedCoverage = coverageRatio;
      this.smoothedFingerScore = fingerScore;
    } else {
      this.smoothedRed = this.smoothedRed * (1 - this.RGB_SMOOTH_ALPHA) + rawRed * this.RGB_SMOOTH_ALPHA;
      this.smoothedGreen = this.smoothedGreen * (1 - this.RGB_SMOOTH_ALPHA) + rawGreen * this.RGB_SMOOTH_ALPHA;
      this.smoothedBlue = this.smoothedBlue * (1 - this.RGB_SMOOTH_ALPHA) + rawBlue * this.RGB_SMOOTH_ALPHA;
      this.smoothedCoverage = this.smoothedCoverage * (1 - this.COVERAGE_SMOOTH_ALPHA) + coverageRatio * this.COVERAGE_SMOOTH_ALPHA;
      this.smoothedFingerScore = this.smoothedFingerScore * (1 - this.COVERAGE_SMOOTH_ALPHA) + fingerScore * this.COVERAGE_SMOOTH_ALPHA;
    }

    const r = this.smoothedRed;
    const g = this.smoothedGreen;
    const b = this.smoothedBlue;
    const totalIntensity = r + g + b;
    const redDominance = r - (g + b) / 2;
    const rgRatio = r / Math.max(1, g);
    const rbRatio = r / Math.max(1, b);
    const colorDominance = totalIntensity > 0 ? redDominance / totalIntensity : 0;
    const notBlownOut = !(r > 254.8 && g > 254.8 && b > 254.8);

    let detectionScore = 0;
    if (r > 36) detectionScore += 1;
    if (rgRatio > 0.88 && rgRatio < 4.8) detectionScore += 1;
    if (rbRatio > 1.0) detectionScore += 1;
    if (totalIntensity > 95 && totalIntensity < 745) detectionScore += 1;
    if (colorDominance > 0.12) detectionScore += 1;
    if (redDominance > 10) detectionScore += 1;
    if (this.smoothedCoverage > 0.32) detectionScore += 2;
    if (this.smoothedFingerScore > 0.38) detectionScore += 1;

    const contactLikely = r > 44 && rgRatio > 0.95 && redDominance > 12 && this.smoothedCoverage > 0.24;
    const requiredScore = this.fingerDetected ? 4 : 6;
    const instantDetected = notBlownOut && (contactLikely || detectionScore >= requiredScore);

    if (instantDetected) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1, this.FINGER_CONFIRM_FRAMES + 8);
      return this.fingerDetected ? true : this.fingerConfidenceCount >= this.FINGER_CONFIRM_FRAMES;
    }

    this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 1);
    this.fingerLostCount++;

    if (this.fingerDetected) {
      const softHold = this.smoothedCoverage > 0.18 && redDominance > 6;
      if (softHold) {
        return true;
      }
      return this.fingerLostCount < this.FINGER_LOST_FRAMES;
    }

    return false;
  }

  private selectSignalSource(rawRed: number, rawGreen: number): { value: number; label: 'R' | 'G' | 'RG' } {
    let redWeight = 0.35;
    let greenWeight = 0.65;

    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;
    const piSum = redPI + greenPI;

    if (piSum > 0) {
      greenWeight = Math.min(0.82, Math.max(0.18, greenPI / piSum));
      redWeight = 1 - greenWeight;
    }

    if (rawGreen > 245) {
      greenWeight *= 0.25;
      redWeight = 1 - greenWeight;
    }

    if (rawRed > 252 && rawGreen < 245) {
      redWeight *= 0.35;
      greenWeight = 1 - redWeight;
    }

    const value = rawRed * redWeight + rawGreen * greenWeight;
    const label: 'R' | 'G' | 'RG' = greenWeight > 0.72 ? 'G' : redWeight > 0.72 ? 'R' : 'RG';

    return { value, label };
  }

  private calculateACDCPrecise(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 45) return;

    const redWindow = this.redBuffer.slice(-windowSize);
    const greenWindow = this.greenBuffer.slice(-windowSize);

    this.redDC = redWindow.reduce((a, b) => a + b, 0) / redWindow.length;
    this.greenDC = greenWindow.reduce((a, b) => a + b, 0) / greenWindow.length;

    if (this.redDC < 5 || this.greenDC < 5) return;

    let redSumSq = 0;
    let greenSumSq = 0;

    for (let i = 0; i < windowSize; i++) {
      redSumSq += Math.pow(redWindow[i] - this.redDC, 2);
      greenSumSq += Math.pow(greenWindow[i] - this.greenDC, 2);
    }

    const redRMS = Math.sqrt(redSumSq / windowSize);
    const greenRMS = Math.sqrt(greenSumSq / windowSize);

    const sortedRed = [...redWindow].sort((a, b) => a - b);
    const sortedGreen = [...greenWindow].sort((a, b) => a - b);
    const p5 = Math.floor(windowSize * 0.05);
    const p95 = Math.floor(windowSize * 0.95);

    const redP2P = sortedRed[p95] - sortedRed[p5];
    const greenP2P = sortedGreen[p95] - sortedGreen[p5];

    const redACFromRMS = redRMS * Math.sqrt(2);
    const greenACFromRMS = greenRMS * Math.sqrt(2);

    this.redAC = (redACFromRMS + redP2P * 0.5) / 2;
    this.greenAC = (greenACFromRMS + greenP2P * 0.5) / 2;

    const redPI = this.redAC / this.redDC;
    const greenPI = this.greenAC / this.greenDC;

    if (redPI < 0.00035 || greenPI < 0.00035) {
      this.redAC = 0;
      this.greenAC = 0;
    }
  }

  private calculateDerivatives(): void {
    const n = this.filteredBuffer.length;

    if (n >= 3) {
      const vpg = (this.filteredBuffer[n - 1] - this.filteredBuffer[n - 3]) / 2;
      this.vpgBuffer.push(vpg);
      if (this.vpgBuffer.length > this.BUFFER_SIZE) {
        this.vpgBuffer.shift();
      }
    }

    if (this.vpgBuffer.length >= 3) {
      const vn = this.vpgBuffer.length;
      const apg = (this.vpgBuffer[vn - 1] - this.vpgBuffer[vn - 3]) / 2;
      this.apgBuffer.push(apg);
      if (this.apgBuffer.length > this.BUFFER_SIZE) {
        this.apgBuffer.shift();
      }
    }
  }

  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 24) return 0;
    if (!this.fingerDetected) return 0;

    const recent = this.filteredBuffer.slice(-90);
    const sorted = [...recent].sort((a, b) => a - b);
    const p10 = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? 0;
    const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
    const range = p90 - p10;

    if (range < 0.04) return 5;

    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    const snr = range / (stdDev + 0.005);

    const snrScore = Math.min(40, snr * 10);
    const perfusionScore = Math.min(25, this.calculatePerfusionIndex() * 10);
    const coverageScore = Math.min(20, this.smoothedCoverage * 35);
    const motionPenalty = Math.min(30, this.motionScore * 40);

    return Math.min(100, Math.max(0, snrScore + perfusionScore + coverageScore - motionPenalty));
  }

  private calculatePerfusionIndex(): number {
    if (this.greenDC > 0) {
      return (this.greenAC / this.greenDC) * 100;
    }
    if (this.redDC > 0) {
      return (this.redAC / this.redDC) * 100;
    }
    return 0;
  }

  private resetSignalTrackingBuffers(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
    this.redDC = 0;
    this.redAC = 0;
    this.greenDC = 0;
    this.greenAC = 0;
    this.bandpassFilter.reset();
  }

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.fingerDetected = false;
    this.signalQuality = 0;
    this.fingerConfidenceCount = 0;
    this.fingerLostCount = 0;
    this.smoothedRed = 0;
    this.smoothedGreen = 0;
    this.smoothedBlue = 0;
    this.smoothedCoverage = 0;
    this.smoothedFingerScore = 0;
    this.redDC = 0;
    this.redAC = 0;
    this.greenDC = 0;
    this.greenAC = 0;
    this.motionScore = 0;
    this.lastAcceleration = { x: 0, y: 0, z: 0 };
    this.bandpassFilter.reset();
  }

  private handleMotionEvent = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

    const dx = (acc.x ?? 0) - this.lastAcceleration.x;
    const dy = (acc.y ?? 0) - this.lastAcceleration.y;
    const dz = (acc.z ?? 0) - this.lastAcceleration.z;

    this.lastAcceleration = { x: acc.x ?? 0, y: acc.y ?? 0, z: acc.z ?? 0 };

    const accelRMS = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rot = event.rotationRate;
    let gyroRMS = 0;

    if (rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null) {
      gyroRMS = Math.sqrt(
        (rot.alpha ?? 0) ** 2 +
        (rot.beta ?? 0) ** 2 +
        (rot.gamma ?? 0) ** 2
      ) / 100;
    }

    const rawScore = accelRMS * 0.6 + gyroRMS * 0.4;
    this.motionScore = this.motionScore * 0.7 + rawScore * 0.3;
  };

  private startMotionListener(): void {
    if (this.motionListenerActive) return;

    try {
      if (typeof DeviceMotionEvent !== 'undefined') {
        if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
          (DeviceMotionEvent as any).requestPermission()
            .then((state: string) => {
              if (state === 'granted') {
                window.addEventListener('devicemotion', this.handleMotionEvent, { passive: true });
                this.motionListenerActive = true;
              }
            })
            .catch(() => {});
        } else {
          window.addEventListener('devicemotion', this.handleMotionEvent, { passive: true });
          this.motionListenerActive = true;
        }
      }
    } catch (error) {
      console.warn('⚠️ IMU no disponible:', error);
    }
  }

  private stopMotionListener(): void {
    if (!this.motionListenerActive) return;
    window.removeEventListener('devicemotion', this.handleMotionEvent);
    this.motionListenerActive = false;
    this.motionScore = 0;
  }

  getRGBStats() {
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      ratioOfRatios: this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0
        ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC)
        : 0,
    };
  }
}
