import { ImageData } from '../../types/image';

export interface SignalQualityMetrics {
  signalStrength: number;
  noiseLevel: number;
  perfusionIndex: number;
  overallQuality: number;
  timestamp: number;
}

export class PPGSignalProcessor {
  private readonly QUALITY_HISTORY_SIZE = 15;
  private readonly MIN_QUALITY_THRESHOLD = 30;
  private readonly MAX_CONSECUTIVE_DETECTIONS = 8;
  private readonly MAX_CONSECUTIVE_NO_DETECTIONS = 5;
  private readonly QUALITY_DEGRADATION_FACTOR = 0.75;
  private readonly MOVEMENT_THRESHOLD = 50;
  private readonly MOVEMENT_DEGRADATION = 0.5;
  private readonly MIN_RED_THRESHOLD = 50;
  private readonly MAX_RED_THRESHOLD = 200;
  private readonly STALE_SIGNAL_PENALTY = 15;
  private readonly STALE_DURATION_THRESHOLD = 3000;
  private readonly INITIAL_STALE_PENALTY = 5;
  private readonly CONSECUTIVE_STALE_FRAMES_THRESHOLD = 3;
  
  private consecutiveDetections: number = 0;
  private consecutiveNoDetections: number = 0;
  private lastFingerDetected: boolean = false;
  private lastRedValue: number = 0;
  private lastQualityScore: number = 0;
  private qualityBuffer: number[] = [];
  private lastMovement: number = 0;
  private lastFrameTime: number = 0;
  private consecutiveStaleFrames: number = 0;
  private initialStalePenaltyApplied: boolean = false;
  public onSignalReady: ((signal: any) => void) | null = null;
  public onError: ((error: any) => void) | null = null;
  public isProcessing: boolean = false;

  constructor(
    onSignalReady?: (signal: any) => void,
    onError?: (error: any) => void
  ) {
    this.onSignalReady = onSignalReady || null;
    this.onError = onError || null;
  }

  public start(): void {
    this.isProcessing = true;
  }

  public stop(): void {
    this.isProcessing = false;
  }

  public reset(): void {
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
    this.lastFingerDetected = false;
    this.lastRedValue = 0;
    this.lastQualityScore = 0;
    this.qualityBuffer = [];
    this.lastMovement = 0;
    this.lastFrameTime = 0;
    this.consecutiveStaleFrames = 0;
    this.initialStalePenaltyApplied = false;
  }

  public processFrame(imageData: ImageData): void {
    if (!this.isProcessing) return;
    
    const now = Date.now();
    const fingerDetected = this.isFingerDetected(imageData);
    let redValue = this.extractRedValue(imageData);
    
    // Apply a penalty if the signal is stale
    let stalePenalty = 0;
    if (fingerDetected) {
      if (now - this.lastFrameTime > this.STALE_DURATION_THRESHOLD) {
        this.consecutiveStaleFrames++;
        stalePenalty = this.STALE_SIGNAL_PENALTY;
        
        if (!this.initialStalePenaltyApplied) {
          stalePenalty += this.INITIAL_STALE_PENALTY;
          this.initialStalePenaltyApplied = true;
        }
        
        if (this.consecutiveStaleFrames > this.CONSECUTIVE_STALE_FRAMES_THRESHOLD) {
          stalePenalty *= 1.5;
        }
      } else {
        this.consecutiveStaleFrames = 0;
        this.initialStalePenaltyApplied = false;
      }
    }
    
    // Calculate signal quality
    let quality = this.calculateSignalQuality(redValue);
    quality = Math.max(0, quality - stalePenalty);
    
    // Apply movement degradation
    let movement = this.calculateMovement(redValue);
    if (movement > this.MOVEMENT_THRESHOLD) {
      quality *= this.MOVEMENT_DEGRADATION;
    }
    
    // Apply quality degradation factor
    if (quality < this.lastQualityScore) {
      quality = this.lastQualityScore * this.QUALITY_DEGRADATION_FACTOR;
    }
    
    // Ensure quality is within bounds
    quality = Math.min(100, Math.max(0, quality));
    
    // Prepare signal data
    const signal = {
      timestamp: now,
      fingerDetected,
      quality: Math.round(quality),
      rawValue: redValue,
      filteredValue: redValue,
    };
    
    // Update state
    this.lastFrameTime = now;
    this.lastFingerDetected = fingerDetected;
    this.lastRedValue = redValue;
    this.lastQualityScore = quality;
    this.lastMovement = movement;
    
    // Notify listeners
    if (this.onSignalReady) {
      this.onSignalReady(signal);
    }
  }

  // MEJORADO: Detección de dedo más sólida y real, sin simulación
  private isFingerDetected(imageData: ImageData): boolean {
    const { data, width, height } = imageData;
    
    // ROI más amplio para capturar mejor el dedo
    const roiSize = Math.min(width, height) * 0.8; // Aumentado de 0.7
    const roiX = Math.floor((width - roiSize) / 2);
    const roiY = Math.floor((height - roiSize) / 2);
    
    let validPixelCount = 0;
    let totalPixelCount = 0;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    
    // MEJORADO: Análisis más completo de la región
    for (let y = roiY; y < roiY + roiSize && y < height; y++) {
      for (let x = roiX; x < roiX + roiSize && x < width; x++) {
        const pixelIndex = (y * width + x) * 4;
        const red = data[pixelIndex];
        const green = data[pixelIndex + 1];
        const blue = data[pixelIndex + 2];
        
        totalPixelCount++;
        redSum += red;
        greenSum += green;
        blueSum += blue;
        
        // Criterios más permisivos pero realistas para piel humana
        const isRedDominant = red > green && red > blue;
        const hasMinRedIntensity = red > 80; // Reducido de 120
        const isNotOverexposed = red < 240 && green < 240 && blue < 240;
        const hasGoodSaturation = (red - Math.min(green, blue)) > 25; // Reducido de 40
        
        if (isRedDominant && hasMinRedIntensity && isNotOverexposed && hasGoodSaturation) {
          validPixelCount++;
        }
      }
    }
    
    if (totalPixelCount === 0) return false;
    
    // Calcular promedios
    const avgRed = redSum / totalPixelCount;
    const avgGreen = greenSum / totalPixelCount;
    const avgBlue = blueSum / totalPixelCount;
    
    // Porcentaje de píxeles válidos más permisivo
    const validPixelRatio = validPixelCount / totalPixelCount;
    
    // NUEVO: Validación adicional de características de piel humana
    const skinToneValid = this.validateSkinTone(avgRed, avgGreen, avgBlue);
    const textureValid = this.validateSkinTexture(imageData, roiX, roiY, roiSize);
    
    // Criterios combinados más realistas
    const baseDetection = validPixelRatio > 0.25; // Reducido de 0.35
    const skinDetection = skinToneValid && avgRed > 90; // Reducido de 110
    const qualityDetection = textureValid && (avgRed - avgGreen) > 15; // Reducido de 25
    
    const isDetected = baseDetection && (skinDetection || qualityDetection);
    
    // Actualizar contador con histéresis mejorada
    if (isDetected) {
      this.consecutiveDetections = Math.min(this.consecutiveDetections + 1, this.MAX_CONSECUTIVE_DETECTIONS);
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections = Math.min(this.consecutiveNoDetections + 1, this.MAX_CONSECUTIVE_NO_DETECTIONS);
      if (this.consecutiveNoDetections >= 3) { // Más permisivo
        this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
      }
    }
    
    // Decisión final con histéresis
    return this.consecutiveDetections >= 4; // Reducido de 6
  }

  // NUEVO: Validación mejorada de tono de piel humana
  private validateSkinTone(red: number, green: number, blue: number): boolean {
    // Rangos más amplios para diferentes tonos de piel
    const redGreenRatio = red / (green + 1);
    const redBlueRatio = red / (blue + 1);
    
    // Criterios más inclusivos para tonos de piel diversos
    const validRedGreen = redGreenRatio > 1.05 && redGreenRatio < 2.5; // Más amplio
    const validRedBlue = redBlueRatio > 1.15 && redBlueRatio < 3.0; // Más amplio
    const notTooGreen = green < red * 0.9; // Menos restrictivo
    
    return validRedGreen && validRedBlue && notTooGreen;
  }

  // MEJORADO: Validación de textura de piel más precisa
  private validateSkinTexture(imageData: ImageData, roiX: number, roiY: number, roiSize: number): boolean {
    const { data, width } = imageData;
    const gridSize = 12; // Aumentado para mejor análisis
    const stepX = Math.floor(roiSize / gridSize);
    const stepY = Math.floor(roiSize / gridSize);
    
    let variationSum = 0;
    let sampleCount = 0;
    
    for (let gy = 0; gy < gridSize - 1; gy++) {
      for (let gx = 0; gx < gridSize - 1; gx++) {
        const x1 = roiX + gx * stepX;
        const y1 = roiY + gy * stepY;
        const x2 = roiX + (gx + 1) * stepX;
        const y2 = roiY + (gy + 1) * stepY;
        
        if (x2 < width && y2 < imageData.height) {
          const pixel1 = (y1 * width + x1) * 4;
          const pixel2 = (y2 * width + x2) * 4;
          
          const red1 = data[pixel1];
          const red2 = data[pixel2];
          
          const variation = Math.abs(red1 - red2);
          variationSum += variation;
          sampleCount++;
        }
      }
    }
    
    if (sampleCount === 0) return false;
    
    const avgVariation = variationSum / sampleCount;
    
    // Textura de piel humana: ni muy uniforme ni muy caótica
    return avgVariation > 3 && avgVariation < 45; // Rango más realista
  }

  private extractRedValue(imageData: ImageData): number {
    const { data, width, height } = imageData;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const pixelIndex = (centerY * width + centerX) * 4;
    
    let red = data[pixelIndex];
    
    if (red < this.MIN_RED_THRESHOLD || red > this.MAX_RED_THRESHOLD) {
      red = this.lastRedValue;
    }
    
    return red;
  }

  private calculateMovement(currentRedValue: number): number {
    let movement = Math.abs(currentRedValue - this.lastRedValue);
    return movement;
  }

  // CORREGIDO: Cálculo de calidad 100% real basado en señal PPG
  private calculateSignalQuality(redValue: number): number {
    // Agregar valor al buffer de calidad
    this.qualityBuffer.push(redValue);
    if (this.qualityBuffer.length > this.QUALITY_HISTORY_SIZE) {
      this.qualityBuffer.shift();
    }
    
    // Necesitamos al menos 5 muestras para calcular calidad real
    if (this.qualityBuffer.length < 5) {
      return 0; // Sin calidad hasta tener suficientes datos
    }
    
    // 1. FUERZA DE SEÑAL PPG (Rango de variación)
    const maxRed = Math.max(...this.qualityBuffer);
    const minRed = Math.min(...this.qualityBuffer);
    const signalRange = maxRed - minRed;
    
    // Para PPG humano real, necesitamos al menos 8-10 de variación
    const strengthScore = Math.min(100, Math.max(0, (signalRange - 5) * 12)); // Ajustado para realidad
    
    // 2. ESTABILIDAD DE LA SEÑAL (Baja varianza = buena calidad)
    const mean = this.qualityBuffer.reduce((sum, val) => sum + val, 0) / this.qualityBuffer.length;
    const variance = this.qualityBuffer.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / this.qualityBuffer.length;
    const stdDev = Math.sqrt(variance);
    
    // Coeficiente de variación normalizado
    const cv = mean > 0 ? stdDev / mean : 1;
    const stabilityScore = Math.min(100, Math.max(0, (1 - cv) * 100));
    
    // 3. DETECCIÓN DE PULSATILIDAD REAL
    let pulsatilityScore = 0;
    if (this.qualityBuffer.length >= 8) {
      // Buscar picos y valles reales
      let peaks = 0;
      let valleys = 0;
      
      for (let i = 1; i < this.qualityBuffer.length - 1; i++) {
        const current = this.qualityBuffer[i];
        const prev = this.qualityBuffer[i - 1];
        const next = this.qualityBuffer[i + 1];
        
        if (current > prev && current > next && current > mean) {
          peaks++;
        } else if (current < prev && current < next && current < mean) {
          valleys++;
        }
      }
      
      // PPG real debe tener alternancia de picos y valles
      const expectedPatterns = Math.floor(this.qualityBuffer.length / 4); // ~1-2 latidos por buffer
      const actualPatterns = Math.min(peaks, valleys);
      
      if (actualPatterns > 0) {
        pulsatilityScore = Math.min(100, (actualPatterns / expectedPatterns) * 80);
      }
    }
    
    // 4. RELACIÓN SEÑAL-RUIDO REAL
    const acComponent = stdDev; // Componente AC (variación)
    const dcComponent = mean;   // Componente DC (nivel base)
    
    let snrScore = 0;
    if (dcComponent > 0) {
      const snrRatio = acComponent / dcComponent;
      // Para PPG humano real: ratio típico 0.02-0.08
      if (snrRatio >= 0.015 && snrRatio <= 0.12) {
        const normalizedSNR = (snrRatio - 0.015) / (0.12 - 0.015);
        snrScore = normalizedSNR * 100;
      }
    }
    
    // COMBINACIÓN FINAL - Sin bonus artificiales
    const finalQuality = (
      strengthScore * 0.35 +    // 35% - Fuerza es crítica
      stabilityScore * 0.25 +   // 25% - Estabilidad
      pulsatilityScore * 0.25 + // 25% - Pulsatilidad real
      snrScore * 0.15          // 15% - SNR
    );
    
    // Sin suavizado artificial - devolver la calidad real calculada
    return Math.round(Math.min(100, Math.max(0, finalQuality)));
  }
}
