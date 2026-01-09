import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - EXTRACCIÓN PPG ULTRA-SIMPLE
 * 
 * SIN detección de dedo ni piel
 * Procesa TODO el ROI central sin filtros
 */
export class FrameProcessor {
  private redBuffer: Float32Array;
  private greenBuffer: Float32Array;
  private blueBuffer: Float32Array;
  private bufferIndex = 0;
  private bufferFilled = false;
  private readonly BUFFER_SIZE = 60;
  
  // Calibración interna
  private calibrationDC = 0;
  private calibrationComplete = false;
  private calibrationSamples = 0;
  private readonly CALIBRATION_FRAMES = 30;
  
  // Ganancia
  private gainFactor = 1.0;
  private readonly TARGET_DC = 120;
  
  // Suavizado
  private lastRed = 0;
  private lastGreen = 0;
  private lastBlue = 0;
  private readonly SMOOTHING = 0.15;
  
  private frameCount = 0;
  private isSaturatedState = false;
  
  constructor() {
    this.redBuffer = new Float32Array(this.BUFFER_SIZE);
    this.greenBuffer = new Float32Array(this.BUFFER_SIZE);
    this.blueBuffer = new Float32Array(this.BUFFER_SIZE);
  }
  
  /**
   * Extraer datos del frame - SIN DETECCIÓN DE DEDO
   * Procesa todo el ROI central
   */
  extractFrameData(imageData: ImageData): FrameData {
    const data = imageData.data;
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let pixelCount = 0;
    
    // ROI central circular
    const centerX = imageData.width / 2;
    const centerY = imageData.height / 2;
    const roiRadius = Math.min(imageData.width, imageData.height) * 0.40;
    
    // Procesar con step de 2 para más cobertura
    const step = 2;
    for (let y = 0; y < imageData.height; y += step) {
      for (let x = 0; x < imageData.width; x += step) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > roiRadius * roiRadius) continue;
        
        const i = (y * imageData.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // SIN filtro de piel - procesar TODO
        if (r + g + b > 20) { // Solo filtrar negro puro
          redSum += r;
          greenSum += g;
          blueSum += b;
          pixelCount++;
        }
      }
    }
    
    // Promedios crudos
    const rawRed = pixelCount > 0 ? redSum / pixelCount : 0;
    const rawGreen = pixelCount > 0 ? greenSum / pixelCount : 0;
    const rawBlue = pixelCount > 0 ? blueSum / pixelCount : 0;
    
    // Suavizado temporal
    let smoothedRed: number, smoothedGreen: number, smoothedBlue: number;
    
    if (this.lastRed === 0) {
      smoothedRed = rawRed;
      smoothedGreen = rawGreen;
      smoothedBlue = rawBlue;
    } else {
      smoothedRed = this.lastRed * this.SMOOTHING + rawRed * (1 - this.SMOOTHING);
      smoothedGreen = this.lastGreen * this.SMOOTHING + rawGreen * (1 - this.SMOOTHING);
      smoothedBlue = this.lastBlue * this.SMOOTHING + rawBlue * (1 - this.SMOOTHING);
    }
    
    this.lastRed = smoothedRed;
    this.lastGreen = smoothedGreen;
    this.lastBlue = smoothedBlue;
    
    // Calibración
    this.updateGainCalibration(smoothedRed, smoothedGreen, smoothedBlue);
    
    // Aplicar ganancia
    const avgRed = this.applyNormalization(smoothedRed);
    const avgGreen = this.applyNormalization(smoothedGreen);
    const avgBlue = this.applyNormalization(smoothedBlue);
    
    // Actualizar buffer
    this.updateBuffer(avgRed, avgGreen, avgBlue);
    
    // Calcular AC
    const acComponent = this.calculateAC();
    
    // Saturación
    this.frameCount++;
    this.isSaturatedState = this.isSaturated(smoothedRed, smoothedGreen);
    
    // Log reducido
    if (this.frameCount % 600 === 0) {
      console.log(`📷 R=${smoothedRed.toFixed(0)} G=${smoothedGreen.toFixed(0)} B=${smoothedBlue.toFixed(0)} AC=${(acComponent * 100).toFixed(1)}%`);
    }
    
    return {
      redValue: avgRed,
      avgRed,
      avgGreen,
      avgBlue,
      rawRed: smoothedRed,
      rawGreen: smoothedGreen,
      rawBlue: smoothedBlue,
      textureScore: acComponent,
      rToGRatio: avgGreen > 0 ? avgRed / avgGreen : 1,
      rToBRatio: avgBlue > 0 ? avgRed / avgBlue : 1
    };
  }
  
  private updateGainCalibration(r: number, g: number, b: number): void {
    if (this.calibrationComplete) return;
    
    const currentDC = (r + g + b) / 3;
    this.calibrationSamples++;
    this.calibrationDC += currentDC;
    
    if (this.calibrationSamples >= this.CALIBRATION_FRAMES) {
      this.calibrationDC /= this.calibrationSamples;
      this.calibrationComplete = true;
      
      if (this.calibrationDC > 0) {
        this.gainFactor = this.TARGET_DC / this.calibrationDC;
        this.gainFactor = Math.max(0.3, Math.min(1.5, this.gainFactor));
      }
    }
  }
  
  private applyNormalization(rawValue: number): number {
    if (!this.calibrationComplete) return rawValue;
    return Math.max(0, Math.min(255, rawValue * this.gainFactor));
  }
  
  private updateBuffer(red: number, green: number, blue: number): void {
    this.redBuffer[this.bufferIndex] = red;
    this.greenBuffer[this.bufferIndex] = green;
    this.blueBuffer[this.bufferIndex] = blue;
    
    this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
    if (this.bufferIndex === 0) this.bufferFilled = true;
  }
  
  private calculateAC(): number {
    const count = this.bufferFilled ? this.BUFFER_SIZE : this.bufferIndex;
    if (count < 30) return 0;
    
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    
    for (let i = 0; i < count; i++) {
      const val = this.redBuffer[i];
      sum += val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    
    const mean = sum / count;
    if (mean === 0) return 0;
    
    return (max - min) / mean;
  }
  
  getRedBuffer(): number[] {
    const count = this.bufferFilled ? this.BUFFER_SIZE : this.bufferIndex;
    return Array.from(this.redBuffer.slice(0, count));
  }
  
  getAllChannelBuffers(): { red: number[], green: number[], blue: number[] } {
    const count = this.bufferFilled ? this.BUFFER_SIZE : this.bufferIndex;
    return {
      red: Array.from(this.redBuffer.slice(0, count)),
      green: Array.from(this.greenBuffer.slice(0, count)),
      blue: Array.from(this.blueBuffer.slice(0, count))
    };
  }
  
  getRGBStats(): { redAC: number; redDC: number; greenAC: number; greenDC: number; rgRatio: number } {
    const count = this.bufferFilled ? this.BUFFER_SIZE : this.bufferIndex;
    if (count < 30) {
      return { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
    }
    
    let redSum = 0, greenSum = 0;
    let redMin = Infinity, redMax = -Infinity;
    let greenMin = Infinity, greenMax = -Infinity;
    
    for (let i = 0; i < count; i++) {
      const r = this.redBuffer[i];
      const g = this.greenBuffer[i];
      redSum += r;
      greenSum += g;
      if (r < redMin) redMin = r;
      if (r > redMax) redMax = r;
      if (g < greenMin) greenMin = g;
      if (g > greenMax) greenMax = g;
    }
    
    const redDC = redSum / count;
    const greenDC = greenSum / count;
    const redAC = redMax - redMin;
    const greenAC = greenMax - greenMin;
    
    const rgRatio = (redDC > 0 && greenDC > 0) ? (redAC / redDC) / (greenAC / greenDC) : 0;
    
    return { redAC, redDC, greenAC, greenDC, rgRatio };
  }
  
  detectROI(redValue: number, imageData: ImageData): ProcessedSignal['roi'] {
    return { x: 0, y: 0, width: imageData.width, height: imageData.height };
  }
  
  getSkinPixelRatio(): number {
    return 1; // Sin detección de piel
  }
  
  isCalibrated(): boolean {
    return this.calibrationComplete;
  }
  
  getGainFactor(): number {
    return this.gainFactor;
  }
  
  getIsSaturated(): boolean {
    return this.isSaturatedState;
  }
  
  private isSaturated(r: number, g: number): boolean {
    return r > 248 || (r > 230 && g > 150);
  }
  
  reset(): void {
    this.redBuffer.fill(0);
    this.greenBuffer.fill(0);
    this.blueBuffer.fill(0);
    this.bufferIndex = 0;
    this.bufferFilled = false;
    this.frameCount = 0;
    this.calibrationComplete = false;
    this.calibrationSamples = 0;
    this.calibrationDC = 0;
    this.gainFactor = 1.0;
    this.lastRed = 0;
    this.lastGreen = 0;
    this.lastBlue = 0;
    this.isSaturatedState = false;
  }
}