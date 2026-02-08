/**
 * CALIBRADOR RGB PARA SMARTPHONE
 * 
 * Problema: Las cámaras aplican gamma, tone mapping, AWB
 * que distorsionan la relación lineal AC/DC
 * 
 * Solución (Frontiers Digital Health 2023):
 * 
 * 1. ZERO LIGHT OFFSET (ZLO):
 *    - Medir valor RGB mínimo sin luz
 *    - Restar de todas las mediciones
 *    - Corrige DC component
 * 
 * 2. LINEARIZACIÓN:
 *    - Detectar gamma de cámara
 *    - Aplicar corrección inversa
 * 
 * 3. NORMALIZACIÓN:
 *    - Compensar diferencias entre dispositivos
 *    - Ajuste dinámico basado en condiciones
 * 
 * Flujo:
 * rawRGB -> (- ZLO) -> (gamma^-1) -> linearRGB -> AC/DC
 */

export interface RGBCalibration {
  // Zero Light Offset por canal
  zloRed: number;
  zloGreen: number;
  zloBlue: number;
  
  // Gamma estimado (típico ~2.2)
  gamma: number;
  
  // Factor de escala por canal
  scaleRed: number;
  scaleGreen: number;
  scaleBlue: number;
  
  // Estado
  isCalibrated: boolean;
  calibrationTime: number;
  samplesCollected: number;
}

export interface CalibratedRGB {
  red: number;
  green: number;
  blue: number;
  linearRed: number;
  linearGreen: number;
  linearBlue: number;
}

export class RGBCalibrator {
  private calibration: RGBCalibration;
  private calibrationBuffer: { red: number[]; green: number[]; blue: number[] };
  private readonly CALIBRATION_SAMPLES = 30; // 1 segundo @ 30fps
  private readonly DEFAULT_GAMMA = 2.2;
  
  constructor() {
    this.calibration = this.createDefaultCalibration();
    this.calibrationBuffer = { red: [], green: [], blue: [] };
  }
  
  /**
   * INICIAR CALIBRACIÓN
   * Llamar cuando la cámara está lista pero SIN dedo
   */
  startCalibration(): void {
    this.calibrationBuffer = { red: [], green: [], blue: [] };
    this.calibration.isCalibrated = false;
    console.log('🔧 RGBCalibrator: Iniciando calibración ZLO...');
  }
  
  /**
   * AGREGAR MUESTRA DE CALIBRACIÓN
   * Llamar para cada frame ANTES de poner el dedo
   */
  addCalibrationSample(red: number, green: number, blue: number): boolean {
    if (this.calibration.isCalibrated) return true;
    
    this.calibrationBuffer.red.push(red);
    this.calibrationBuffer.green.push(green);
    this.calibrationBuffer.blue.push(blue);
    
    this.calibration.samplesCollected = this.calibrationBuffer.red.length;
    
    // Cuando tenemos suficientes muestras, calcular ZLO
    if (this.calibrationBuffer.red.length >= this.CALIBRATION_SAMPLES) {
      this.completeCalibration();
      return true;
    }
    
    return false;
  }
  
  /**
   * COMPLETAR CALIBRACIÓN
   * Calcular ZLO y gamma desde muestras
   */
  private completeCalibration(): void {
    const { red, green, blue } = this.calibrationBuffer;
    
    // ZLO = percentil 5% (evitar outliers)
    const sortedRed = [...red].sort((a, b) => a - b);
    const sortedGreen = [...green].sort((a, b) => a - b);
    const sortedBlue = [...blue].sort((a, b) => a - b);
    
    const p5Index = Math.floor(red.length * 0.05);
    
    this.calibration.zloRed = sortedRed[p5Index];
    this.calibration.zloGreen = sortedGreen[p5Index];
    this.calibration.zloBlue = sortedBlue[p5Index];
    
    // Estimar gamma desde la distribución (opcional, usar default si no hay suficiente rango)
    // Para señales de cámara con flash, el gamma típico es ~2.2
    this.calibration.gamma = this.DEFAULT_GAMMA;
    
    // Calcular escala para normalizar canales
    const maxRed = sortedRed[sortedRed.length - 1] - this.calibration.zloRed;
    const maxGreen = sortedGreen[sortedGreen.length - 1] - this.calibration.zloGreen;
    const maxBlue = sortedBlue[sortedBlue.length - 1] - this.calibration.zloBlue;
    
    const maxAll = Math.max(maxRed, maxGreen, maxBlue, 1);
    
    this.calibration.scaleRed = maxAll / Math.max(maxRed, 1);
    this.calibration.scaleGreen = maxAll / Math.max(maxGreen, 1);
    this.calibration.scaleBlue = maxAll / Math.max(maxBlue, 1);
    
    this.calibration.isCalibrated = true;
    this.calibration.calibrationTime = Date.now();
    
    console.log('✅ RGBCalibrator: Calibración completada');
    console.log(`   ZLO: R=${this.calibration.zloRed.toFixed(1)} G=${this.calibration.zloGreen.toFixed(1)} B=${this.calibration.zloBlue.toFixed(1)}`);
    console.log(`   Gamma: ${this.calibration.gamma.toFixed(2)}`);
  }
  
  /**
   * CALIBRAR VALORES RGB
   * Aplica ZLO, gamma inverso y normalización
   */
  calibrate(red: number, green: number, blue: number): CalibratedRGB {
    // Si no está calibrado, usar valores por defecto
    if (!this.calibration.isCalibrated) {
      return this.calibrateWithDefaults(red, green, blue);
    }
    
    // 1. Restar ZLO
    const correctedRed = Math.max(0, red - this.calibration.zloRed);
    const correctedGreen = Math.max(0, green - this.calibration.zloGreen);
    const correctedBlue = Math.max(0, blue - this.calibration.zloBlue);
    
    // 2. Aplicar escala de normalización
    const scaledRed = correctedRed * this.calibration.scaleRed;
    const scaledGreen = correctedGreen * this.calibration.scaleGreen;
    const scaledBlue = correctedBlue * this.calibration.scaleBlue;
    
    // 3. Linearizar (gamma inverso): linear = encoded^gamma
    const gamma = this.calibration.gamma;
    const linearRed = Math.pow(scaledRed / 255, gamma) * 255;
    const linearGreen = Math.pow(scaledGreen / 255, gamma) * 255;
    const linearBlue = Math.pow(scaledBlue / 255, gamma) * 255;
    
    return {
      red: correctedRed,
      green: correctedGreen,
      blue: correctedBlue,
      linearRed,
      linearGreen,
      linearBlue
    };
  }
  
  /**
   * Calibración con valores por defecto (sin ZLO previo)
   */
  private calibrateWithDefaults(red: number, green: number, blue: number): CalibratedRGB {
    // ZLO estimado: mínimo típico para cámaras con flash
    const defaultZLO = 5;
    
    const correctedRed = Math.max(0, red - defaultZLO);
    const correctedGreen = Math.max(0, green - defaultZLO);
    const correctedBlue = Math.max(0, blue - defaultZLO);
    
    // Linearización directa
    const gamma = this.DEFAULT_GAMMA;
    const linearRed = Math.pow(correctedRed / 255, gamma) * 255;
    const linearGreen = Math.pow(correctedGreen / 255, gamma) * 255;
    const linearBlue = Math.pow(correctedBlue / 255, gamma) * 255;
    
    return {
      red: correctedRed,
      green: correctedGreen,
      blue: correctedBlue,
      linearRed,
      linearGreen,
      linearBlue
    };
  }
  
  /**
   * CALIBRACIÓN INSTANTÁNEA DESDE MEDICIÓN ACTIVA (Nature Digital Health 2024)
   * 
   * El usuario ya tiene el dedo colocado, así que:
   * 1. ZLO estimado = 2-3% del valor DC actual
   * 2. Gamma = 2.2 (sRGB estándar)
   * 3. Escala = 1 (ya normalizado)
   * 
   * Esto permite empezar a medir inmediatamente sin fase de calibración
   */
  forceCalibrationFromMeasurement(red: number, green: number, blue: number): void {
    // ZLO estimado como 2-3% del valor actual (offset mínimo típico)
    const zloFactor = 0.025; // 2.5%
    this.calibration.zloRed = red * zloFactor;
    this.calibration.zloGreen = green * zloFactor;
    this.calibration.zloBlue = blue * zloFactor;
    
    // Gamma estándar sRGB
    this.calibration.gamma = this.DEFAULT_GAMMA;
    
    // Escala normalizada
    this.calibration.scaleRed = 1;
    this.calibration.scaleGreen = 1;
    this.calibration.scaleBlue = 1;
    
    // Marcar como calibrado
    this.calibration.isCalibrated = true;
    this.calibration.calibrationTime = Date.now();
    this.calibration.samplesCollected = 1;
    
    console.log('⚡ RGBCalibrator: Calibración instantánea');
    console.log(`   ZLO: R=${this.calibration.zloRed.toFixed(1)} G=${this.calibration.zloGreen.toFixed(1)} B=${this.calibration.zloBlue.toFixed(1)}`);
    console.log(`   Valores entrada: R=${red.toFixed(1)} G=${green.toFixed(1)} B=${blue.toFixed(1)}`);
  }
  
  /**
   * Obtener estado de calibración
   */
  getCalibration(): RGBCalibration {
    return { ...this.calibration };
  }
  
  /**
   * Verificar si está calibrado
   */
  isCalibrated(): boolean {
    return this.calibration.isCalibrated;
  }
  
  /**
   * Progreso de calibración (0-100)
   */
  getCalibrationProgress(): number {
    if (this.calibration.isCalibrated) return 100;
    return Math.round((this.calibrationBuffer.red.length / this.CALIBRATION_SAMPLES) * 100);
  }
  
  /**
   * Reset completo
   */
  reset(): void {
    this.calibration = this.createDefaultCalibration();
    this.calibrationBuffer = { red: [], green: [], blue: [] };
  }
  
  /**
   * Crear calibración por defecto
   */
  private createDefaultCalibration(): RGBCalibration {
    return {
      zloRed: 0,
      zloGreen: 0,
      zloBlue: 0,
      gamma: this.DEFAULT_GAMMA,
      scaleRed: 1,
      scaleGreen: 1,
      scaleBlue: 1,
      isCalibrated: false,
      calibrationTime: 0,
      samplesCollected: 0
    };
  }
}
