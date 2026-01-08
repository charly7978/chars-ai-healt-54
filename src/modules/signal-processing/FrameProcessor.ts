import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - EXTRACCIÓN PPG ULTRA-LIGERA
 * 
 * PRINCIPIOS:
 * 1. Buffers PEQUEÑOS y fijos
 * 2. Sin dependencia de calibrador externo - datos puros para CameraController
 * 3. Logs mínimos
 * 4. Sin acumulación de memoria
 */
export class FrameProcessor {
  // Buffers PEQUEÑOS - 30 frames = 1s @ 30fps (suficiente para análisis)
  private redBuffer: Float32Array;
  private greenBuffer: Float32Array;
  private blueBuffer: Float32Array;
  private bufferIndex = 0;
  private bufferFilled = false;
  private readonly BUFFER_SIZE = 30;
  
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
  private readonly SMOOTHING = 0.2;
  
  // Contadores
  private frameCount = 0;
  private skinPixelRatio = 0;
  
  // Estado de saturación para reportar
  private isSaturatedState = false;
  
  constructor() {
    this.redBuffer = new Float32Array(this.BUFFER_SIZE);
    this.greenBuffer = new Float32Array(this.BUFFER_SIZE);
    this.blueBuffer = new Float32Array(this.BUFFER_SIZE);
  }
  
  /**
   * Extraer datos del frame
   */
  extractFrameData(imageData: ImageData): FrameData {
    const data = imageData.data;
    const totalPixels = imageData.width * imageData.height;
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let skinPixelCount = 0;
    
    // ROI central - el dedo cubre principalmente el centro
    const centerX = imageData.width / 2;
    const centerY = imageData.height / 2;
    const roiRadius = Math.min(imageData.width, imageData.height) * 0.35;
    
    // Procesar con step de 4 (cada 4to pixel) para velocidad pero más cobertura
    const step = 4;
    for (let y = 0; y < imageData.height; y += step) {
      for (let x = 0; x < imageData.width; x += step) {
        // Verificar si está en ROI central
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > roiRadius * roiRadius) continue;
        
        const i = (y * imageData.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        const total = r + g + b;
        if (total < 30) continue;
        
        const nr = r / total;
        const ng = g / total;
        const nrng = ng > 0.01 ? nr / ng : 0;
        
        // Detección de piel/dedo - canal rojo dominante
        if (nr > 0.32 && nrng > 0.9 && r > 40) {
          redSum += r;
          greenSum += g;
          blueSum += b;
          skinPixelCount++;
        }
      }
    }
    
    // Fallback: usar ROI central sin filtro de piel
    if (skinPixelCount < 50) {
      redSum = 0; greenSum = 0; blueSum = 0; skinPixelCount = 0;
      for (let y = 0; y < imageData.height; y += step) {
        for (let x = 0; x < imageData.width; x += step) {
          const dx = x - centerX;
          const dy = y - centerY;
          if (dx * dx + dy * dy > roiRadius * roiRadius) continue;
          
          const i = (y * imageData.width + x) * 4;
          redSum += data[i];
          greenSum += data[i + 1];
          blueSum += data[i + 2];
          skinPixelCount++;
        }
      }
    }
    
    this.skinPixelRatio = skinPixelCount / (totalPixels / 4);
    
    // Promedios crudos
    const rawRed = skinPixelCount > 0 ? redSum / skinPixelCount : 0;
    const rawGreen = skinPixelCount > 0 ? greenSum / skinPixelCount : 0;
    const rawBlue = skinPixelCount > 0 ? blueSum / skinPixelCount : 0;
    
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
    
    // Actualizar buffer circular
    this.updateBuffer(avgRed, avgGreen, avgBlue);
    
    // Calcular AC
    const acComponent = this.calculateAC();
    
    // DETECCIÓN DE SATURACIÓN - guardar estado para CameraController
    this.frameCount++;
    this.isSaturatedState = this.isSaturated(smoothedRed, smoothedGreen);
    
    // Log diagnóstico reducido - solo cada 15 segundos
    if (this.frameCount % 450 === 0) {
      console.log(`📷 R=${smoothedRed.toFixed(0)} G=${smoothedGreen.toFixed(0)} AC=${(acComponent * 100).toFixed(1)}%`);
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
    return this.skinPixelRatio;
  }
  
  isCalibrated(): boolean {
    return this.calibrationComplete;
  }
  
  getGainFactor(): number {
    return this.gainFactor;
  }
  
  /**
   * Obtener estado de saturación actual
   */
  getIsSaturated(): boolean {
    return this.isSaturatedState;
  }
  
  /**
   * Detectar saturación del sensor - científicamente validado
   * Saturación = R muy alto o luz blanca (R+G altos = flash sin dedo)
   */
  private isSaturated(r: number, g: number): boolean {
    const saturated = r > 248 || (r > 230 && g > 150);
    return saturated;
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
    this.skinPixelRatio = 0;
    this.isSaturatedState = false;
  }
}
