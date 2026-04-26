/**
 * EXTRACCIÓN PPG - FASE 1
 * 
 * Responsabilidades:
 * - Extraer señal cruda desde frames
 * - RGB/OD traces
 * - AC/DC provisional
 * - ContactScore
 * - MotionScore
 * - ROI box
 * - NO biomarcadores falsos
 * - NO ondas falsas
 */

import type { RadiometricCalibration } from '../radiometric/RadiometricCalibration';
import type { FingerState } from '../detection/FingerDetection';
import type { ROIBox } from '../roi/DynamicROI';

export interface PPGSample {
  timestamp: number;
  meanR: number;
  meanG: number;
  meanB: number;
  meanLinearR: number;
  meanLinearG: number;
  meanLinearB: number;
  meanODR: number;
  meanODG: number;
  meanODB: number;
  acR: number;
  acG: number;
  acB: number;
  dcR: number;
  dcG: number;
  dcB: number;
  acODR: number;
  acODG: number;
  acODB: number;
  dcODR: number;
  dcODG: number;
  dcODB: number;
  saturationRatioR: number;
  saturationRatioG: number;
  saturationRatioB: number;
  validPixelRatio: number;
  clipHighRatio: number;
  clipLowRatio: number;
  contactScore: number;
  motionScore: number;
  roiBox: ROIBox;
  fingerState: FingerState;
  signalQuality: number;
}

export interface PPGExtractionConfig {
  bufferSize: number;
  dcWindow: number;
  acWindow: number;
  minSignalQuality: number;
}

const DEFAULT_CONFIG: PPGExtractionConfig = {
  bufferSize: 360,
  dcWindow: 180,
  acWindow: 60,
  minSignalQuality: 30,
};

export class PPGExtraction {
  private config: PPGExtractionConfig;
  private radiometricCalibration: RadiometricCalibration;
  
  // Buffers para cálculo AC/DC
  private bufferR: number[] = [];
  private bufferG: number[] = [];
  private bufferB: number[] = [];
  private bufferODR: number[] = [];
  private bufferODG: number[] = [];
  private bufferODB: number[] = [];
  
  // Valores DC actuales
  private dcR: number = 0;
  private dcG: number = 0;
  private dcB: number = 0;
  private dcODR: number = 0;
  private dcODG: number = 0;
  private dcODB: number = 0;
  
  // Valores AC actuales
  private acR: number = 0;
  private acG: number = 0;
  private acB: number = 0;
  private acODR: number = 0;
  private acODG: number = 0;
  private acODB: number = 0;
  
  private frameCount: number = 0;
  private readonly SATURATION_THRESHOLD = 250;

  constructor(radiometricCalibration: RadiometricCalibration, config: Partial<PPGExtractionConfig> = {}) {
    this.radiometricCalibration = radiometricCalibration;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calcular media RGB del ROI con estadísticas completas
   */
  private calculateMeanRGB(imageData: ImageData, roi: ROIBox): { 
    r: number; g: number; b: number; 
    stdR: number; stdG: number; stdB: number;
    validPixelRatio: number;
    clipHighRatio: number;
    clipLowRatio: number;
  } {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    let sumR = 0, sumG = 0, sumB = 0;
    let sumSqR = 0, sumSqG = 0, sumSqB = 0;
    let count = 0;
    let validPixels = 0;
    let clipHighPixels = 0;
    let clipLowPixels = 0;
    
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        // Rechazar píxeles inválidos
        if (r >= 250 || g >= 250 || b >= 250 || r <= 3 || g <= 3 || b <= 3) {
          if (r >= 250 || g >= 250 || b >= 250) clipHighPixels++;
          if (r <= 3 && g <= 3 && b <= 3) clipLowPixels++;
          continue;
        }
        
        validPixels++;
        sumR += r;
        sumG += g;
        sumB += b;
        sumSqR += r * r;
        sumSqG += g * g;
        sumSqB += b * b;
        count++;
      }
    }
    
    const totalPixels = width * height;
    const meanR = count > 0 ? sumR / count : 0;
    const meanG = count > 0 ? sumG / count : 0;
    const meanB = count > 0 ? sumB / count : 0;
    
    // Calcular desviación estándar
    const varianceR = count > 0 ? (sumSqR / count) - (meanR * meanR) : 0;
    const varianceG = count > 0 ? (sumSqG / count) - (meanG * meanG) : 0;
    const varianceB = count > 0 ? (sumSqB / count) - (meanB * meanB) : 0;
    
    return {
      r: meanR,
      g: meanG,
      b: meanB,
      stdR: Math.sqrt(Math.max(0, varianceR)),
      stdG: Math.sqrt(Math.max(0, varianceG)),
      stdB: Math.sqrt(Math.max(0, varianceB)),
      validPixelRatio: totalPixels > 0 ? validPixels / totalPixels : 0,
      clipHighRatio: totalPixels > 0 ? clipHighPixels / totalPixels : 0,
      clipLowRatio: totalPixels > 0 ? clipLowPixels / totalPixels : 0,
    };
  }

  /**
   * Calcular ratio de saturación por canal
   */
  private calculateSaturationRatio(imageData: ImageData, roi: ROIBox): { r: number; g: number; b: number } {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    let satR = 0, satG = 0, satB = 0;
    let count = 0;
    
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        if (r >= this.SATURATION_THRESHOLD) satR++;
        if (g >= this.SATURATION_THRESHOLD) satG++;
        if (b >= this.SATURATION_THRESHOLD) satB++;
        count++;
      }
    }
    
    return {
      r: count > 0 ? satR / count : 0,
      g: count > 0 ? satG / count : 0,
      b: count > 0 ? satB / count : 0,
    };
  }

  /**
   * Actualizar buffers
   */
  private updateBuffers(
    r: number, g: number, b: number,
    odR: number, odG: number, odB: number
  ): void {
    this.bufferR.push(r);
    this.bufferG.push(g);
    this.bufferB.push(b);
    this.bufferODR.push(odR);
    this.bufferODG.push(odG);
    this.bufferODB.push(odB);
    
    // Limitar tamaño
    const maxLen = this.config.bufferSize;
    if (this.bufferR.length > maxLen) {
      this.bufferR.shift();
      this.bufferG.shift();
      this.bufferB.shift();
      this.bufferODR.shift();
      this.bufferODG.shift();
      this.bufferODB.shift();
    }
  }

  /**
   * Calcular DC (componente continua)
   */
  private calculateDC(): void {
    const window = Math.min(this.config.dcWindow, this.bufferR.length);
    if (window < 10) return;
    
    const recentR = this.bufferR.slice(-window);
    const recentG = this.bufferG.slice(-window);
    const recentB = this.bufferB.slice(-window);
    const recentODR = this.bufferODR.slice(-window);
    const recentODG = this.bufferODG.slice(-window);
    const recentODB = this.bufferODB.slice(-window);
    
    this.dcR = recentR.reduce((a, b) => a + b, 0) / recentR.length;
    this.dcG = recentG.reduce((a, b) => a + b, 0) / recentG.length;
    this.dcB = recentB.reduce((a, b) => a + b, 0) / recentB.length;
    this.dcODR = recentODR.reduce((a, b) => a + b, 0) / recentODR.length;
    this.dcODG = recentODG.reduce((a, b) => a + b, 0) / recentODG.length;
    this.dcODB = recentODB.reduce((a, b) => a + b, 0) / recentODB.length;
  }

  /**
   * Calcular AC (componente alterna) usando p2p y RMS
   */
  private calculateAC(): void {
    const window = Math.min(this.config.acWindow, this.bufferR.length);
    if (window < 10) return;
    
    const recentR = this.bufferR.slice(-window);
    const recentG = this.bufferG.slice(-window);
    const recentB = this.bufferB.slice(-window);
    const recentODR = this.bufferODR.slice(-window);
    const recentODG = this.bufferODG.slice(-window);
    const recentODB = this.bufferODB.slice(-window);
    
    // Método: combinación de p2p y RMS
    const computeAC = (buf: number[], dc: number): number => {
      const sorted = [...buf].sort((a, b) => a - b);
      const p5 = sorted[Math.floor(sorted.length * 0.05)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p2p = p95 - p5;
      
      const variance = buf.reduce((sum, val) => sum + (val - dc) ** 2, 0) / buf.length;
      const rms = Math.sqrt(variance) * Math.sqrt(2);
      
      return (rms + p2p * 0.5) / 2;
    };
    
    this.acR = computeAC(recentR, this.dcR);
    this.acG = computeAC(recentG, this.dcG);
    this.acB = computeAC(recentB, this.dcB);
    this.acODR = computeAC(recentODR, this.dcODR);
    this.acODG = computeAC(recentODG, this.dcODG);
    this.acODB = computeAC(recentODB, this.dcODB);
  }

  /**
   * Calcular calidad de señal básica
   */
  private calculateSignalQuality(
    contactScore: number,
    motionScore: number,
    saturationRatio: { r: number; g: number; b: number }
  ): number {
    let quality = 100;
    
    // Penalizar por contacto bajo
    quality *= contactScore;
    
    // Penalizar por movimiento
    quality *= (1 - motionScore * 0.5);
    
    // Penalizar por saturación
    const maxSat = Math.max(saturationRatio.r, saturationRatio.g, saturationRatio.b);
    quality *= Math.max(0, 1 - maxSat * 5);
    
    // Verificar que haya señal AC suficiente
    const totalAC = this.acR + this.acG + this.acB;
    const totalDC = this.dcR + this.dcG + this.dcB;
    const perfusion = totalDC > 0 ? totalAC / totalDC : 0;
    
    if (perfusion < 0.005) {
      quality *= 0.3;
    }
    
    return Math.max(0, Math.min(100, quality));
  }

  /**
   * Procesar frame y extraer muestra PPG
   */
  process(
    imageData: ImageData,
    roi: ROIBox,
    contactScore: number,
    motionScore: number,
    fingerState: FingerState
  ): PPGSample {
    this.frameCount++;
    const timestamp = performance.now();
    
    // Calcular media RGB del ROI con estadísticas
    const meanRGB = this.calculateMeanRGB(imageData, roi);
    
    // Calcular saturación por canal
    const saturationRatio = this.calculateSaturationRatio(imageData, roi);
    
    // Procesar radiométricamente
    const radiometric = this.radiometricCalibration.processPixel(
      meanRGB.r,
      meanRGB.g,
      meanRGB.b
    );
    
    // Actualizar buffers
    this.updateBuffers(
      meanRGB.r,
      meanRGB.g,
      meanRGB.b,
      radiometric.odR,
      radiometric.odG,
      radiometric.odB
    );
    
    // Calcular DC y AC
    if (this.frameCount % 5 === 0) {
      this.calculateDC();
    }
    if (this.frameCount % 3 === 0) {
      this.calculateAC();
    }
    
    // Calcular calidad de señal
    const signalQuality = this.calculateSignalQuality(contactScore, motionScore, saturationRatio);
    
    return {
      timestamp,
      meanR: meanRGB.r,
      meanG: meanRGB.g,
      meanB: meanRGB.b,
      meanLinearR: radiometric.linearR,
      meanLinearG: radiometric.linearG,
      meanLinearB: radiometric.linearB,
      meanODR: radiometric.odR,
      meanODG: radiometric.odG,
      meanODB: radiometric.odB,
      acR: this.acR,
      acG: this.acG,
      acB: this.acB,
      dcR: this.dcR,
      dcG: this.dcG,
      dcB: this.dcB,
      acODR: this.acODR,
      acODG: this.acODG,
      acODB: this.acODB,
      dcODR: this.dcODR,
      dcODG: this.dcODG,
      dcODB: this.dcODB,
      saturationRatioR: saturationRatio.r,
      saturationRatioG: saturationRatio.g,
      saturationRatioB: saturationRatio.b,
      validPixelRatio: meanRGB.validPixelRatio,
      clipHighRatio: meanRGB.clipHighRatio,
      clipLowRatio: meanRGB.clipLowRatio,
      contactScore,
      motionScore,
      roiBox: roi,
      fingerState,
      signalQuality,
    };
  }

  /**
   * Obtener buffers actuales
   */
  getBuffers(): {
    r: number[];
    g: number[];
    b: number[];
    odR: number[];
    odG: number[];
    odB: number[];
  } {
    return {
      r: [...this.bufferR],
      g: [...this.bufferG],
      b: [...this.bufferB],
      odR: [...this.bufferODR],
      odG: [...this.bufferODG],
      odB: [...this.bufferODB],
    };
  }

  /**
   * Obtener estadísticas AC/DC actuales
   */
  getACDC(): {
    acR: number; acG: number; acB: number;
    dcR: number; dcG: number; dcB: number;
    acODR: number; acODG: number; acODB: number;
    dcODR: number; dcODG: number; dcODB: number;
  } {
    return {
      acR: this.acR,
      acG: this.acG,
      acB: this.acB,
      dcR: this.dcR,
      dcG: this.dcG,
      dcB: this.dcB,
      acODR: this.acODR,
      acODG: this.acODG,
      acODB: this.acODB,
      dcODR: this.dcODR,
      dcODG: this.dcODG,
      dcODB: this.dcODB,
    };
  }

  /**
   * Resetear extractor
   */
  reset(): void {
    this.bufferR = [];
    this.bufferG = [];
    this.bufferB = [];
    this.bufferODR = [];
    this.bufferODG = [];
    this.bufferODB = [];
    
    this.dcR = 0;
    this.dcG = 0;
    this.dcB = 0;
    this.dcODR = 0;
    this.dcODG = 0;
    this.dcODB = 0;
    
    this.acR = 0;
    this.acG = 0;
    this.acB = 0;
    this.acODR = 0;
    this.acODG = 0;
    this.acODB = 0;
    
    this.frameCount = 0;
  }

  /**
   * Actualizar configuración
   */
  updateConfig(config: Partial<PPGExtractionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): PPGExtractionConfig {
    return { ...this.config };
  }
}
