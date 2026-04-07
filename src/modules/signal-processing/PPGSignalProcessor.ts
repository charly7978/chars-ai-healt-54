import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

interface ROIMetrics {
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  coverageRatio: number;
  fingerScore: number;
}

type PulseSourceLabel = 'R' | 'G' | 'RG';

export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing = false;

  private bandpassFilter: BandpassFilter;

  private readonly BUFFER_SIZE = 240;
  private readonly ACDC_WINDOW = 150;
  private readonly TILE_COLUMNS = 5;
  private readonly TILE_ROWS = 5;

  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private vpgBuffer: number[] = [];
  private apgBuffer: number[] = [];
  private tileConfidence: number[] = new Array(25).fill(0);
  private frameIntervalBuffer: number[] = [];

  private redDC = 0;
  private redAC = 0;
  private greenDC = 0;
  private greenAC = 0;

  private redBaseline = 0;
  private greenBaseline = 0;
  private blueBaseline = 0;
  private estimatedSampleRate = 30;
  private lastFrameTimestamp = 0;

  private frameCount = 0;
  private lastLogTime = 0;

  private fingerDetected = false;
  private signalQuality = 0;
  private fingerConfidenceCount = 0;
  private fingerLostCount = 0;
  private readonly FINGER_CONFIRM_FRAMES = 2;
  private readonly FINGER_LOST_FRAMES = 45;

  private smoothedRed = 0;
  private smoothedGreen = 0;
  private smoothedBlue = 0;
  private smoothedCoverage = 0;
  private smoothedFingerScore = 0;
  private readonly RGB_SMOOTH_ALPHA = 0.12;
  private readonly COVERAGE_SMOOTH_ALPHA = 0.14;

  private motionScore = 0;
  private motionListenerActive = false;
  private lastAcceleration = { x: 0, y: 0, z: 0 };
  private readonly MOTION_THRESHOLD = 0.55;

  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(this.estimatedSampleRate);
  }

  async initialize(): Promise<void> {
    this.reset();
    console.log('✅ PPGSignalProcessor inicializado - captura reforzada');
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
    this.updateSampleRate(timestamp);

    const { rawRed, rawGreen, rawBlue, coverageRatio, fingerScore } = this.extractROI(imageData);
    const previousFingerDetected = this.fingerDetected;
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue, coverageRatio, fingerScore);

    const contactLikely =
      coverageRatio > 0.14 &&
      rawRed > 28 &&
      rawRed > rawBlue * 0.92 &&
      rawRed > rawGreen * 0.78;

    if (this.fingerDetected && !previousFingerDetected) {
      this.resetSignalTrackingBuffers();
    }

    if (!this.fingerDetected && !contactLikely && this.fingerLostCount >= this.FINGER_LOST_FRAMES) {
      this.resetSignalTrackingBuffers();
      this.resetBaselines();
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

    this.updateChannelBaselines(rawRed, rawGreen, rawBlue, motionArtifact);

    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }

    if (this.redBuffer.length >= 36) {
      this.calculateACDCPrecise();
    }

    const pulseSource = this.extractPulseSignal(rawRed, rawGreen, motionArtifact);

    this.rawBuffer.push(pulseSource.value);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }

    const filtered = this.bandpassFilter.filter(pulseSource.value);
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }

    this.calculateDerivatives();
    this.signalQuality = this.calculateSignalQuality();

    const perfusionIndex = this.calculatePerfusionIndex();
    const adjustedQuality = motionArtifact
      ? Math.max(0, this.signalQuality * 0.78)
      : this.signalQuality;

    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      console.log(
        `📷 PPG [${pulseSource.label}] Pulse=${pulseSource.value.toFixed(2)} Filt=${filtered.toFixed(3)} ` +
          `Q=${adjustedQuality.toFixed(0)}% PI=${perfusionIndex.toFixed(2)} ` +
          `C=${(this.smoothedCoverage * 100).toFixed(0)}% FPS=${this.estimatedSampleRate.toFixed(0)} ` +
          `${this.fingerDetected ? '✅' : '❌'}`
      );
    }

    this.onSignalReady({
      timestamp,
      rawValue: pulseSource.value,
      filteredValue: filtered,
      quality: adjustedQuality,
      fingerDetected: this.fingerDetected,
      motionArtifact,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      diagnostics: {
        message:
          `${pulseSource.label}:${pulseSource.strength.toFixed(1)} ` +
          `PI:${perfusionIndex.toFixed(2)} C:${(this.smoothedCoverage * 100).toFixed(0)} ` +
          `FPS:${this.estimatedSampleRate.toFixed(0)}${motionArtifact ? ' MOV' : ''}`,
        hasPulsatility: perfusionIndex > 0.02 || pulseSource.strength > 4,
        pulsatilityValue: Math.max(perfusionIndex, pulseSource.strength * 0.02),
      },
    });
  }

  private updateSampleRate(timestamp: number): void {
    if (this.lastFrameTimestamp === 0) {
      this.lastFrameTimestamp = timestamp;
      return;
    }

    const delta = timestamp - this.lastFrameTimestamp;
    this.lastFrameTimestamp = timestamp;

    if (delta < 12 || delta > 80) return;

    this.frameIntervalBuffer.push(delta);
    if (this.frameIntervalBuffer.length > 24) {
      this.frameIntervalBuffer.shift();
    }

    if (this.frameIntervalBuffer.length < 8) return;

    const sorted = [...this.frameIntervalBuffer].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 33;
    const estimatedFps = this.clamp(1000 / median, 24, 36);

    if (Math.abs(estimatedFps - this.estimatedSampleRate) > 1.5) {
      this.estimatedSampleRate = estimatedFps;
      this.bandpassFilter.setSampleRate(this.estimatedSampleRate);
    }
  }

  private extractROI(imageData: ImageData): ROIMetrics {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    const roiSize = Math.min(width, height) * 0.76;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);

    const tiles = Array.from({ length: this.TILE_COLUMNS * this.TILE_ROWS }, () => ({
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
        const tileX = Math.min(this.TILE_COLUMNS - 1, Math.floor(((x - startX) / roiWidth) * this.TILE_COLUMNS));
        const tileY = Math.min(this.TILE_ROWS - 1, Math.floor(((y - startY) / roiHeight) * this.TILE_ROWS));
        const tile = tiles[tileY * this.TILE_COLUMNS + tileX];

        tile.red += data[i];
        tile.green += data[i + 1];
        tile.blue += data[i + 2];
        tile.count++;
      }
    }

    const averagedTiles = tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => tile.count > 0)
      .map(({ tile, index }) => {
        const red = tile.red / tile.count;
        const green = tile.green / tile.count;
        const blue = tile.blue / tile.count;
        const total = red + green + blue;
        const redDominance = red - (green + blue) / 2;
        const rednessRatio = red / Math.max(1, green);
        const gridX = index % this.TILE_COLUMNS;
        const gridY = Math.floor(index / this.TILE_COLUMNS);
        const normX = this.TILE_COLUMNS <= 1 ? 0 : gridX / (this.TILE_COLUMNS - 1);
        const normY = this.TILE_ROWS <= 1 ? 0 : gridY / (this.TILE_ROWS - 1);
        const distanceFromCenter = Math.sqrt((normX - 0.5) ** 2 + (normY - 0.5) ** 2);
        const centerBias = this.clamp(1 - distanceFromCenter * 1.25, 0.35, 1);

        const brightnessScore = this.clamp((total - 85) / 170, 0, 1);
        const redRatioScore = this.clamp((rednessRatio - 0.82) / 0.85, 0, 1);
        const dominanceScore = this.clamp((redDominance - 4) / 26, 0, 1);
        const frameScore = redRatioScore * 0.4 + dominanceScore * 0.4 + brightnessScore * 0.2;

        this.tileConfidence[index] = this.tileConfidence[index] * 0.72 + frameScore * centerBias * 0.28;
        const combinedScore = this.tileConfidence[index] * 0.7 + frameScore * 0.3;

        return {
          red,
          green,
          blue,
          total,
          redDominance,
          rednessRatio,
          centerBias,
          frameScore,
          combinedScore,
          temporalScore: this.tileConfidence[index],
        };
      });

    if (averagedTiles.length === 0) {
      return { rawRed: 0, rawGreen: 0, rawBlue: 0, coverageRatio: 0, fingerScore: 0 };
    }

    const fingerTiles = averagedTiles.filter((tile) =>
      tile.red > 24 &&
      tile.total > 70 &&
      tile.red > tile.blue * 0.92 &&
      tile.combinedScore > 0.36
    );

    const selectedTiles = fingerTiles.length >= 4
      ? fingerTiles
      : [...averagedTiles]
          .sort((a, b) => b.combinedScore - a.combinedScore)
          .slice(0, Math.max(7, Math.round(averagedTiles.length * 0.55)));

    const weightedAverage = (channel: 'red' | 'green' | 'blue') => {
      let weightedSum = 0;
      let totalWeight = 0;

      for (const tile of selectedTiles) {
        const weight = 0.35 + tile.combinedScore * 1.8 + tile.centerBias * 0.45;
        weightedSum += tile[channel] * weight;
        totalWeight += weight;
      }

      if (totalWeight > 0) {
        return weightedSum / totalWeight;
      }

      return averagedTiles.reduce((sum, tile) => sum + tile[channel], 0) / averagedTiles.length;
    };

    const confidentTiles = averagedTiles.filter((tile) => tile.temporalScore > 0.34).length;
    const coverageRatio = confidentTiles / averagedTiles.length;
    const averageFingerScore = selectedTiles.reduce((sum, tile) => sum + tile.combinedScore, 0) / Math.max(1, selectedTiles.length);

    return {
      rawRed: weightedAverage('red'),
      rawGreen: weightedAverage('green'),
      rawBlue: weightedAverage('blue'),
      coverageRatio,
      fingerScore: averageFingerScore,
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
    const notBlownOut = !(r > 253 && g > 252 && b > 252);

    let detectionScore = 0;
    if (r > 28) detectionScore += 1;
    if (rgRatio > 0.82 && rgRatio < 5.5) detectionScore += 1;
    if (rbRatio > 0.92) detectionScore += 1;
    if (totalIntensity > 70 && totalIntensity < 760) detectionScore += 1;
    if (colorDominance > 0.08) detectionScore += 1;
    if (redDominance > 6) detectionScore += 1;
    if (this.smoothedCoverage > 0.18) detectionScore += 2;
    if (this.smoothedFingerScore > 0.32) detectionScore += 2;
    if (this.motionScore < 1.2) detectionScore += 1;

    const contactLikely = r > 30 && rgRatio > 0.85 && redDominance > 7 && this.smoothedCoverage > 0.14;
    const requiredScore = this.fingerDetected ? 3 : 5;
    const instantDetected = notBlownOut && (contactLikely || detectionScore >= requiredScore);

    if (instantDetected) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1, this.FINGER_CONFIRM_FRAMES + 10);
      return this.fingerDetected ? true : this.fingerConfidenceCount >= this.FINGER_CONFIRM_FRAMES;
    }

    this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 1);
    this.fingerLostCount++;

    if (this.fingerDetected) {
      const softHold =
        this.smoothedCoverage > 0.1 &&
        redDominance > 4 &&
        this.smoothedFingerScore > 0.2;

      if (softHold) {
        return true;
      }

      return this.fingerLostCount < this.FINGER_LOST_FRAMES;
    }

    return false;
  }

  private updateChannelBaselines(rawRed: number, rawGreen: number, rawBlue: number, motionArtifact: boolean): void {
    if (this.redBaseline === 0 || this.greenBaseline === 0 || this.blueBaseline === 0) {
      this.redBaseline = rawRed;
      this.greenBaseline = rawGreen;
      this.blueBaseline = rawBlue;
      return;
    }

    const alpha = motionArtifact ? 0.012 : this.fingerDetected ? 0.028 : 0.05;

    this.redBaseline = this.redBaseline * (1 - alpha) + rawRed * alpha;
    this.greenBaseline = this.greenBaseline * (1 - alpha) + rawGreen * alpha;
    this.blueBaseline = this.blueBaseline * (1 - alpha) + rawBlue * alpha;
  }

  private extractPulseSignal(
    rawRed: number,
    rawGreen: number,
    motionArtifact: boolean
  ): { value: number; label: PulseSourceLabel; strength: number } {
    const redNorm = this.redBaseline > 0 ? (this.redBaseline - rawRed) / this.redBaseline : 0;
    const greenNorm = this.greenBaseline > 0 ? (this.greenBaseline - rawGreen) / this.greenBaseline : 0;

    const redPulse = this.clamp(redNorm, -0.03, 0.03);
    const greenPulse = this.clamp(greenNorm, -0.03, 0.03);

    let redWeight = 0.42;
    let greenWeight = 0.58;

    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;
    const piSum = redPI + greenPI;

    if (piSum > 0) {
      greenWeight = this.clamp(greenPI / piSum, 0.28, 0.78);
      redWeight = 1 - greenWeight;
    }

    if (rawGreen > 245) {
      greenWeight *= 0.45;
      redWeight = 1 - greenWeight;
    }

    if (rawRed < rawGreen * 0.72) {
      greenWeight = this.clamp(greenWeight + 0.08, 0.35, 0.82);
      redWeight = 1 - greenWeight;
    }

    if (motionArtifact) {
      greenWeight = this.clamp(greenWeight + 0.04, 0.35, 0.8);
      redWeight = 1 - greenWeight;
    }

    const blendedPulse = redPulse * redWeight + greenPulse * greenWeight;
    const scaledPulse = this.clamp(blendedPulse * 3200, -60, 60);
    const strength = Math.max(Math.abs(redPulse), Math.abs(greenPulse)) * 1000;
    const label: PulseSourceLabel = greenWeight > 0.72 ? 'G' : redWeight > 0.72 ? 'R' : 'RG';

    return {
      value: scaledPulse,
      label,
      strength,
    };
  }

  private calculateACDCPrecise(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 36) return;

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

    if (redPI < 0.0002 || greenPI < 0.0002) {
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
    const p12 = sorted[Math.floor((sorted.length - 1) * 0.12)] ?? 0;
    const p88 = sorted[Math.floor((sorted.length - 1) * 0.88)] ?? 0;
    const range = p88 - p12;

    if (range < 0.35) return 6;

    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    const snr = range / (stdDev + 0.18);

    const snrScore = Math.min(34, snr * 10.5);
    const perfusionScore = Math.min(26, this.calculatePerfusionIndex() * 12);
    const coverageScore = Math.min(18, this.smoothedCoverage * 32);
    const fingerScore = Math.min(18, this.smoothedFingerScore * 28);
    const motionPenalty = Math.min(24, this.motionScore * 20);

    return this.clamp(snrScore + perfusionScore + coverageScore + fingerScore - motionPenalty, 0, 100);
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

  private resetBaselines(): void {
    this.redBaseline = 0;
    this.greenBaseline = 0;
    this.blueBaseline = 0;
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
    this.tileConfidence = new Array(25).fill(0);
    this.frameIntervalBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.lastFrameTimestamp = 0;
    this.estimatedSampleRate = 30;
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
    this.resetBaselines();
    this.bandpassFilter.setSampleRate(this.estimatedSampleRate);
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
      ) / 120;
    }

    const rawScore = accelRMS * 0.55 + gyroRMS * 0.3;
    this.motionScore = this.motionScore * 0.82 + rawScore * 0.18;
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

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
