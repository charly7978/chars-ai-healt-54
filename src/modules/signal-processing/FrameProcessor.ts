import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';
import { globalCalibrator } from '../camera/CameraAutoCalibrator';

/**
 * FrameProcessor - EXTRACCIÓN PPG ROBUSTA
 * 
 * CORREGIDO:
 * 1. calculateAC() ahora devuelve valores normalizados (0-0.1 típico)
 * 2. Mejor detección de piel con umbrales apropiados
 * 3. Normalización consistente
 */
export class FrameProcessor {
  // Buffers PEQUEÑOS - 90 frames = 3s @ 30fps
  private redBuffer: Float32Array;
  private greenBuffer: Float32Array;
  private blueBuffer: Float32Array;
  private bufferIndex = 0;
  private bufferFilled = false;
  private readonly BUFFER_SIZE = 90;
  
  // Calibración de ganancia
  private calibrationDC = 0;
  private calibrationComplete = false;
  private calibrationSamples = 0;
  private readonly CALIBRATION_FRAMES = 45; // 1.5 segundos
  
  // Ganancia
  private gainFactor = 1.0;
  private readonly TARGET_DC = 180; // Target para mejor SNR
  
  // Suavizado exponencial
  private lastRed = 0;
  private lastGreen = 0;
  private lastBlue = 0;
  private readonly SMOOTHING = 0.15; // Más suavizado para estabilidad
  
  // Estadísticas
  private frameCount = 0;
  private skinPixelRatio = 0;
  
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
    
    // Procesar con step de 4 para velocidad (cada 4 píxeles en memoria = cada píxel real)
    // Saltamos de 16 en 16 para velocidad (cada 4 píxeles)
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      const total = r + g + b;
      if (total < 50) continue; // Muy oscuro
      
      // Normalización cromática para detección de piel/dedo
      const nr = r / total;
      const ng = g / total;
      const nrng = ng > 0.01 ? nr / ng : 0;
      
      // Criterios para piel/dedo con flash:
      // - Rojo dominante (nr > 0.35)
      // - Ratio R/G alto (nrng > 1.2)
      // - Rojo absoluto alto (r > 60)
      if (nr > 0.35 && nrng > 1.2 && r > 60) {
        redSum += r;
        greenSum += g;
        blueSum += b;
        skinPixelCount++;
      }
    }
    
    // Fallback: si no hay suficientes píxeles de piel, usar todos
    if (skinPixelCount < 50) {
      redSum = 0; greenSum = 0; blueSum = 0; skinPixelCount = 0;
      for (let i = 0; i < data.length; i += 16) {
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
        skinPixelCount++;
      }
    }
    
    this.skinPixelRatio = skinPixelCount / (totalPixels / 4);
    
    // Promedios crudos
    const rawRed = skinPixelCount > 0 ? redSum / skinPixelCount : 0;
    const rawGreen = skinPixelCount > 0 ? greenSum / skinPixelCount : 0;
    const rawBlue = skinPixelCount > 0 ? blueSum / skinPixelCount : 0;
    
    // Suavizado temporal exponencial
    let smoothedRed: number, smoothedGreen: number, smoothedBlue: number;
    
    if (this.lastRed === 0) {
      smoothedRed = rawRed;
      smoothedGreen = rawGreen;
      smoothedBlue = rawBlue;
    } else {
      // EMA: new = old * alpha + raw * (1-alpha)
      smoothedRed = this.lastRed * this.SMOOTHING + rawRed * (1 - this.SMOOTHING);
      smoothedGreen = this.lastGreen * this.SMOOTHING + rawGreen * (1 - this.SMOOTHING);
      smoothedBlue = this.lastBlue * this.SMOOTHING + rawBlue * (1 - this.SMOOTHING);
    }
    
    this.lastRed = smoothedRed;
    this.lastGreen = smoothedGreen;
    this.lastBlue = smoothedBlue;
    
    // Calibración de ganancia
    this.updateGainCalibration(smoothedRed, smoothedGreen, smoothedBlue);
    
    // Aplicar normalización
    const avgRed = this.applyNormalization(smoothedRed);
    const avgGreen = this.applyNormalization(smoothedGreen);
    const avgBlue = this.applyNormalization(smoothedBlue);
    
    // Actualizar buffer circular
    this.updateBuffer(avgRed, avgGreen, avgBlue);
    
    // Calcular AC (pulsatilidad)
    const acComponent = this.calculateAC();
    
    // Calibrador de cámara cada 20 frames (~667ms)
    this.frameCount++;
    if (this.frameCount % 20 === 0) {
      globalCalibrator.analyze(avgRed, avgGreen, avgBlue);
    }
    
    // Log cada 5 segundos
    if (this.frameCount % 150 === 0) {
      console.log(`📷 PPG: R=${avgRed.toFixed(0)} G=${avgGreen.toFixed(0)} B=${avgBlue.toFixed(0)} | AC=${(acComponent * 100).toFixed(2)}%`);
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
    if (currentDC < 10) return; // Ignorar frames muy oscuros
    
    this.calibrationSamples++;
    this.calibrationDC += currentDC;
    
    if (this.calibrationSamples >= this.CALIBRATION_FRAMES) {
      this.calibrationDC /= this.calibrationSamples;
      this.calibrationComplete = true;
      
      if (this.calibrationDC > 0) {
        this.gainFactor = this.TARGET_DC / this.calibrationDC;
        // Limitar ganancia para evitar saturación
        this.gainFactor = Math.max(0.5, Math.min(2.0, this.gainFactor));
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
  
  /**
   * Calcula componente AC (pulsatilidad) normalizada
   * CORREGIDO: Devuelve valor entre 0-0.1 típico para PPG real
   * AC = (max - min) / (2 * DC) -> valor fraccional
   */
  private calculateAC(): number {
    const count = this.bufferFilled ? this.BUFFER_SIZE : this.bufferIndex;
    if (count < 30) return 0;
    
    // Usar solo los últimos 30 frames (~1 segundo)
    const startIdx = count > 30 ? count - 30 : 0;
    
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    let validCount = 0;
    
    for (let i = startIdx; i < count; i++) {
      const idx = (this.bufferIndex - count + i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      const val = this.redBuffer[idx];
      
      if (val > 0) {
        sum += val;
        if (val < min) min = val;
        if (val > max) max = val;
        validCount++;
      }
    }
    
    if (validCount < 20 || max === min) return 0;
    
    const dc = sum / validCount;
    if (dc < 1) return 0;
    
    // Pulsatilidad = (pico-a-pico) / (2 * DC)
    // Típicamente 0.5%-5% para dedo con flash
    const ac = (max - min) / (2 * dc);
    
    // Limitar a rango razonable
    return Math.max(0, Math.min(0.15, ac));
  }
  
  getRedBuffer(): number[] {
    const count = this.bufferFilled ? this.BUFFER_SIZE : this.bufferIndex;
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.redBuffer[i]);
    }
    return result;
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
    
    // Ratio de amplitudes normalizadas (para SpO2)
    const redACnorm = redDC > 0 ? redAC / redDC : 0;
    const greenACnorm = greenDC > 0 ? greenAC / greenDC : 0;
    const rgRatio = greenACnorm > 0 ? redACnorm / greenACnorm : 0;
    
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
    globalCalibrator.reset();
  }
}
