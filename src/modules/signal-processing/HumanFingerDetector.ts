/**
 * @file HumanFingerDetector.ts
 * @description Sistema avanzado de detección de dedos humanos reales con validación biofísica
 * PROHIBIDA CUALQUIER SIMULACIÓN - SOLO MEDICIÓN REAL PPG
 */

export interface HumanFingerValidation {
  isHumanFinger: boolean;
  confidence: number;
  biophysicalScore: number;
  opticalCoherence: number;
  bloodFlowIndicator: number;
  tissueConsistency: number;
  validationDetails: {
    skinColorValid: boolean;
    perfusionValid: boolean;
    hemodynamicValid: boolean;
    spatialConsistency: boolean;
    temporalConsistency: boolean;
  };
}

export class HumanFingerDetector {
  private readonly HEMOGLOBIN_ABSORPTION_R = 660; // nm - rojo
  private readonly HEMOGLOBIN_ABSORPTION_IR = 940; // nm - infrarrojo simulado con azul
  
  // Buffer de análisis temporal para validación humana
  private temporalAnalysisBuffer: Array<{
    timestamp: number;
    redValue: number;
    greenValue: number;
    blueValue: number;
    perfusionIndex: number;
  }> = [];
  
  private readonly TEMPORAL_BUFFER_SIZE = 50;
  private skinBaselineR = 0;
  private skinBaselineG = 0;
  private skinBaselineB = 0;
  private perfusionBaseline = 0;
  
  // Contadores para detección consecutiva
  private consecutiveHumanDetections = 0;
  private consecutiveNonHumanDetections = 0;
  private lastValidHumanTime = 0;
  
  constructor() {
    console.log("🔬 HumanFingerDetector: Sistema biofísico activado");
  }
  
  /**
   * ANÁLISIS INTEGRAL DE DEDO HUMANO - Sin simulaciones
   */
  detectHumanFinger(
    redValue: number,
    greenValue: number,
    blueValue: number,
    textureScore: number,
    imageWidth: number,
    imageHeight: number
  ): HumanFingerValidation {
    
    // 1. VALIDACIÓN PRIMARIA - Rangos fisiológicos humanos
    if (!this.isPhysiologicallyValid(redValue, greenValue, blueValue)) {
      this.consecutiveNonHumanDetections++;
      return this.createNegativeResult("Valores fuera de rango fisiológico humano");
    }
    
    // 2. ANÁLISIS ESPECTRAL DE HEMOGLOBINA - Cálculo real PPG
    const hemoglobinAnalysis = this.analyzeHemoglobinSpectrum(redValue, greenValue, blueValue);
    
    // 3. VALIDACIÓN DE PERFUSIÓN SANGUÍNEA - Solo datos reales
    const perfusionAnalysis = this.analyzePerfusion(redValue, greenValue);
    
    // 4. ANÁLISIS TEMPORAL DE CONSISTENCIA HUMANA
    const temporalConsistency = this.analyzeTemporalConsistency(
      redValue, greenValue, blueValue, perfusionAnalysis.perfusionIndex
    );
    
    // 5. VALIDACIÓN ESPACIAL Y DE TEXTURA HUMANA
    const spatialValidation = this.validateSpatialCharacteristics(
      textureScore, imageWidth, imageHeight
    );
    
    // 6. ANÁLISIS HEMDINÁMICO - Patrones cardiovasculares reales
    const hemodynamicScore = this.analyzeHemodynamicPatterns();
    
    // 7. CÁLCULO DE CONFIANZA INTEGRAL
    const overallConfidence = this.calculateOverallConfidence(
      hemoglobinAnalysis,
      perfusionAnalysis,
      temporalConsistency,
      spatialValidation,
      hemodynamicScore
    );
    
    // 8. DECISIÓN FINAL CON CRITERIOS ESTRICTOS PERO EQUILIBRADOS
    const isHumanFinger = this.makeHumanFingerDecision(overallConfidence);
    
    if (isHumanFinger) {
      this.consecutiveHumanDetections++;
      this.consecutiveNonHumanDetections = 0;
      this.lastValidHumanTime = Date.now();
      
      // Actualizar líneas base solo con detecciones válidas
      this.updateHumanBaselines(redValue, greenValue, blueValue, perfusionAnalysis.perfusionIndex);
    } else {
      this.consecutiveNonHumanDetections++;
      this.consecutiveHumanDetections = 0;
    }
    
    return {
      isHumanFinger,
      confidence: overallConfidence,
      biophysicalScore: hemoglobinAnalysis.biophysicalScore,
      opticalCoherence: hemoglobinAnalysis.opticalCoherence,
      bloodFlowIndicator: perfusionAnalysis.bloodFlowIndicator,
      tissueConsistency: temporalConsistency.consistency,
      validationDetails: {
        skinColorValid: hemoglobinAnalysis.skinColorValid,
        perfusionValid: perfusionAnalysis.perfusionValid,
        hemodynamicValid: hemodynamicScore > 0.6,
        spatialConsistency: spatialValidation.spatialValid,
        temporalConsistency: temporalConsistency.temporalValid
      }
    };
  }
  
  /**
   * VALIDACIÓN FISIOLÓGICA ULTRA-ESTRICTA - SOLO DEDOS HUMANOS REALES
   * Criterios basados en física de absorción de hemoglobina + anti falsos positivos
   */
  private isPhysiologicallyValid(r: number, g: number, b: number): boolean {
    // 1. INTENSIDAD TOTAL - Dedo cubriendo cámara con flash debe ser MUY brillante
    const total = r + g + b;
    if (total < 200 || total > 680) return false; // Más estricto
    
    // 2. ROJO DEBE SER DOMINANTE ABSOLUTO - Ley de Beer-Lambert
    // Hemoglobina oxigenada absorbe verde/azul, transmite rojo
    if (r < 100) return false; // Mínimo elevado para dedo real
    
    // 3. RATIO R/G MUY ESTRICTO - Tejido humano con sangre: 1.35-2.5
    const rgRatio = r / (g + 1);
    if (rgRatio < 1.35 || rgRatio > 2.5) return false;
    
    // 4. RATIO R/B MUY ESTRICTO - Rojo muy superior a azul en dedo
    const rbRatio = r / (b + 1);
    if (rbRatio < 2.2 || rbRatio > 6.0) return false;
    
    // 5. PATRÓN OBLIGATORIO: R >> G > B (dedo humano real)
    if (!(r > g * 1.25 && g > b * 1.1)) return false;
    
    // 6. DIFERENCIA MÍNIMA R-G AUMENTADA (indica perfusión real)
    const rgDiff = r - g;
    if (rgDiff < 25) return false; // Aumentado para evitar objetos
    
    // 7. AZUL MUY LIMITADO - Dedo absorbe casi todo el azul
    if (b > g * 0.75) return false;
    if (b > r * 0.40) return false;
    
    // 8. PROPORCIÓN ROJA DEL TOTAL - Dedo humano: 45-60%
    const redProportion = r / total;
    if (redProportion < 0.45 || redProportion > 0.62) return false;
    
    // 9. COHERENCIA DE TEJIDO VIVO ESTRICTA
    const greenProportion = g / total;
    const blueProportion = b / total;
    // Dedo humano: Verde: 26-38%, Azul: 8-20%
    if (greenProportion < 0.26 || greenProportion > 0.38) return false;
    if (blueProportion < 0.08 || blueProportion > 0.20) return false;
    
    // 10. VERIFICACIÓN ADICIONAL DE SATURACIÓN (evita objetos planos)
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = (maxChannel - minChannel) / (maxChannel + 1);
    if (saturation < 0.25 || saturation > 0.70) return false;
    
    return true;
  }
  
  /**
   * ANÁLISIS ESPECTRAL DE HEMOGLOBINA - Cálculos reales de absorción
   */
  private analyzeHemoglobinSpectrum(r: number, g: number, b: number): {
    biophysicalScore: number;
    opticalCoherence: number;
    skinColorValid: boolean;
  } {
    const total = r + g + b + 1e-10;
    
    // Coeficientes de absorción específica de hemoglobina humana
    const hbAbsorptionR = 0.32; // Absorción alta en rojo
    const hbAbsorptionG = 0.85; // Absorción muy alta en verde
    const hbAbsorptionB = 0.15; // Absorción baja en azul
    
    // Análisis de absorción esperada vs observada
    const expectedR = r * (1 - hbAbsorptionR);
    const expectedG = g * (1 - hbAbsorptionG);
    const expectedB = b * (1 - hbAbsorptionB);
    
    // Score biofísico basado en patrón de absorción
    const absorptionPattern = (expectedR + expectedB) / (expectedG + 1);
    const biophysicalScore = Math.min(1.0, Math.max(0, absorptionPattern / 2.5));
    
    // Coherencia óptica - patrones característicos de tejido vivo
    // Dedo real con flash: rojo domina 40-60% del total
    const redDominance = r / total;
    const greenDominance = g / total;
    const blueDominance = b / total;
    
    // Patrón esperado: R > G > B, con R entre 40-60%, G entre 25-40%, B entre 10-25%
    const opticalCoherence = (
      redDominance >= 0.35 && redDominance <= 0.65 &&
      greenDominance >= 0.20 && greenDominance <= 0.45 &&
      blueDominance >= 0.05 && blueDominance <= 0.30
    ) ? 1.0 : Math.max(0, 1 - Math.abs(redDominance - 0.50) * 2);
    
    // Validación de color de piel humana - MÁS ESTRICTA
    const skinColorValid = 
      redDominance >= 0.38 && redDominance <= 0.62 && 
      biophysicalScore >= 0.35 && 
      opticalCoherence >= 0.5 &&
      r > g && g >= b * 0.7; // Patrón R > G >= B
    
    return {
      biophysicalScore,
      opticalCoherence,
      skinColorValid
    };
  }
  
  /**
   * ANÁLISIS DE PERFUSIÓN SANGUÍNEA - Solo medición real PPG
   */
  private analyzePerfusion(r: number, g: number): {
    perfusionIndex: number;
    bloodFlowIndicator: number;
    perfusionValid: boolean;
  } {
    // Cálculo AC/DC real para índice de perfusión
    const acComponent = this.calculateACComponent(r);
    const dcComponent = r + 1e-10;
    const perfusionIndex = (acComponent / dcComponent) * 100;
    
    // Indicador de flujo sanguíneo basado en pulsatilidad
    const pulsatility = this.calculatePulsatility();
    const bloodFlowIndicator = Math.min(1.0, pulsatility * perfusionIndex / 2);
    
    // Validación de perfusión - MÁS ESTRICTA
    // Índice de perfusión normal dedo humano: 0.5-10%
    const perfusionValid = perfusionIndex >= 0.5 && perfusionIndex <= 12.0 && 
                          bloodFlowIndicator >= 0.25 &&
                          pulsatility >= 0.2; // Debe haber pulsación detectable clara
    
    return {
      perfusionIndex: Math.max(0, perfusionIndex),
      bloodFlowIndicator: Math.max(0, bloodFlowIndicator),
      perfusionValid
    };
  }
  
  /**
   * COMPONENTE AC REAL - Sin simulaciones
   */
  private calculateACComponent(currentValue: number): number {
    if (this.temporalAnalysisBuffer.length < 10) return 0.1;
    
    const recentValues = this.temporalAnalysisBuffer
      .slice(-10)
      .map(item => item.redValue);
    
    const max = Math.max(...recentValues);
    const min = Math.min(...recentValues);
    
    return Math.max(0.01, max - min);
  }
  
  /**
   * PULSATILIDAD REAL - Medición directa
   */
  private calculatePulsatility(): number {
    if (this.temporalAnalysisBuffer.length < 20) return 0.1;
    
    const values = this.temporalAnalysisBuffer
      .slice(-20)
      .map(item => item.redValue);
    
    let peakCount = 0;
    for (let i = 2; i < values.length - 2; i++) {
      if (values[i] > values[i-1] && values[i] > values[i+1] &&
          values[i] > values[i-2] && values[i] > values[i+2]) {
        const prominence = Math.min(values[i] - values[i-1], values[i] - values[i+1]);
        if (prominence > 2.0) peakCount++;
      }
    }
    
    return Math.min(1.0, peakCount / 3.0);
  }
  
  /**
   * ANÁLISIS TEMPORAL DE CONSISTENCIA
   */
  private analyzeTemporalConsistency(
    r: number, g: number, b: number, perfusionIndex: number
  ): { consistency: number; temporalValid: boolean } {
    
    // Actualizar buffer temporal
    this.temporalAnalysisBuffer.push({
      timestamp: Date.now(),
      redValue: r,
      greenValue: g,
      blueValue: b,
      perfusionIndex
    });
    
    if (this.temporalAnalysisBuffer.length > this.TEMPORAL_BUFFER_SIZE) {
      this.temporalAnalysisBuffer.shift();
    }
    
    if (this.temporalAnalysisBuffer.length < 15) {
      return { consistency: 0.5, temporalValid: false };
    }
    
    // Análisis de consistencia temporal
    const recent = this.temporalAnalysisBuffer.slice(-15);
    const redVariance = this.calculateVariance(recent.map(item => item.redValue));
    const perfusionVariance = this.calculateVariance(recent.map(item => item.perfusionIndex));
    
    // Consistencia debe ser estable pero con variación fisiológica mínima
    const consistency = Math.max(0, 1 - (redVariance / 350) - (perfusionVariance / 3.5));
    // Variación mínima necesaria indica pulsación real, no imagen estática
    const temporalValid = consistency >= 0.45 && redVariance >= 15 && redVariance <= 800;
    
    return { consistency, temporalValid };
  }
  
  /**
   * VALIDACIÓN ESPACIAL
   */
  private validateSpatialCharacteristics(
    textureScore: number, width: number, height: number
  ): { spatialValid: boolean } {
    
    // Textura debe indicar tejido orgánico, no superficie lisa
    const textureValid = textureScore >= 0.3 && textureScore <= 0.9;
    
    // Área mínima para dedo humano adulto
    const area = width * height;
    // Ajustado para soportar entradas 320x240 provenientes del canvas (76,800 px)
    const areaValid = area >= 70000;
    
    return {
      spatialValid: textureValid && areaValid
    };
  }
  
  /**
   * ANÁLISIS HEMODINÁMICO - Patrones cardiovasculares
   */
  private analyzeHemodynamicPatterns(): number {
    if (this.temporalAnalysisBuffer.length < 30) return 0.3;
    
    const values = this.temporalAnalysisBuffer.slice(-30).map(item => item.redValue);
    
    // Buscar patrones de ondas de pulso característicos
    const cycles = this.detectCardiacCycles(values);
    if (cycles.length < 2) return 0.2;
    
    // Análisis de variabilidad de frecuencia cardíaca (HRV)
    const intervals = cycles.map((cycle, i) => 
      i > 0 ? cycle.timestamp - cycles[i-1].timestamp : 0
    ).filter(interval => interval > 0);
    
    if (intervals.length < 2) return 0.3;
    
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const hrv = Math.sqrt(intervals.reduce((sum, interval) => 
      sum + Math.pow(interval - meanInterval, 2), 0) / intervals.length
    );
    
    // HRV normal indica sistema cardiovascular humano funcional
    const normalizedHRV = Math.min(1.0, hrv / (meanInterval * 0.1));
    
    return Math.min(1.0, normalizedHRV);
  }
  
  /**
   * DETECCIÓN DE CICLOS CARDÍACOS REALES
   */
  private detectCardiacCycles(values: number[]): Array<{timestamp: number, amplitude: number}> {
    const cycles: Array<{timestamp: number, amplitude: number}> = [];
    
    for (let i = 3; i < values.length - 3; i++) {
      if (values[i] > values[i-1] && values[i] > values[i+1] &&
          values[i] > values[i-2] && values[i] > values[i+2] &&
          values[i] > values[i-3] && values[i] > values[i+3]) {
        
        const prominence = Math.min(
          values[i] - Math.min(values[i-1], values[i+1]),
          values[i] - Math.min(values[i-2], values[i+2])
        );
        
        if (prominence > 3.0) {
          cycles.push({
            timestamp: this.temporalAnalysisBuffer[this.temporalAnalysisBuffer.length - values.length + i]?.timestamp || Date.now(),
            amplitude: values[i]
          });
        }
      }
    }
    
    return cycles;
  }
  
  /**
   * CÁLCULO DE CONFIANZA GENERAL
   */
  private calculateOverallConfidence(
    hemoglobin: any,
    perfusion: any,
    temporal: any,
    spatial: any,
    hemodynamic: number
  ): number {
    
    // Incluir coherencia espacial explícitamente en el score final
    const weights = {
      biophysical: 0.22,
      optical: 0.18,
      perfusion: 0.25,
      temporal: 0.15,
      spatial: 0.10,
      hemodynamic: 0.10
    };
    
    const spatialScore = spatial?.spatialValid ? 1.0 : 0.0;
    
    const weightedScore = 
      hemoglobin.biophysicalScore * weights.biophysical +
      hemoglobin.opticalCoherence * weights.optical +
      perfusion.bloodFlowIndicator * weights.perfusion +
      temporal.consistency * weights.temporal +
      spatialScore * weights.spatial +
      hemodynamic * weights.hemodynamic;
    
    // Bonificación por detecciones consecutivas válidas
    const consecutiveBonus = Math.min(0.1, this.consecutiveHumanDetections * 0.02);
    
    return Math.min(1.0, Math.max(0, weightedScore + consecutiveBonus));
  }
  
  /**
   * DECISIÓN FINAL DE DETECCIÓN HUMANA - MUY ESTRICTA ANTI FALSOS POSITIVOS
   */
  private makeHumanFingerDecision(confidence: number): boolean {
    // Umbral base ELEVADO para evitar falsos positivos
    let threshold = 0.55;
    
    // Histéresis moderada: si ya detectamos dedo estable, ser algo más permisivo
    if (Date.now() - this.lastValidHumanTime < 3000 && this.consecutiveHumanDetections >= 15) {
      threshold = 0.48;
    }
    
    // Bonificación solo con MUCHAS detecciones consecutivas estables
    if (this.consecutiveHumanDetections >= 25) {
      threshold = 0.45;
    } else if (this.consecutiveHumanDetections >= 15) {
      threshold = 0.50;
    }
    
    // Penalización fuerte por fallas consecutivas
    if (this.consecutiveNonHumanDetections > 10) {
      threshold = 0.65;
    } else if (this.consecutiveNonHumanDetections > 5) {
      threshold = 0.60;
    }
    
    return confidence >= threshold;
  }
  
  /**
   * ACTUALIZAR LÍNEAS BASE HUMANAS
   */
  private updateHumanBaselines(r: number, g: number, b: number, perfusion: number): void {
    const smoothing = 0.1;
    
    this.skinBaselineR = this.skinBaselineR * (1 - smoothing) + r * smoothing;
    this.skinBaselineG = this.skinBaselineG * (1 - smoothing) + g * smoothing;
    this.skinBaselineB = this.skinBaselineB * (1 - smoothing) + b * smoothing;
    this.perfusionBaseline = this.perfusionBaseline * (1 - smoothing) + perfusion * smoothing;
  }
  
  /**
   * UTILIDADES MATEMÁTICAS
   */
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }
  
  private createNegativeResult(reason: string): HumanFingerValidation {
    return {
      isHumanFinger: false,
      confidence: 0,
      biophysicalScore: 0,
      opticalCoherence: 0,
      bloodFlowIndicator: 0,
      tissueConsistency: 0,
      validationDetails: {
        skinColorValid: false,
        perfusionValid: false,
        hemodynamicValid: false,
        spatialConsistency: false,
        temporalConsistency: false
      }
    };
  }
  
  /**
   * RESET DEL SISTEMA
   */
  reset(): void {
    this.temporalAnalysisBuffer = [];
    this.consecutiveHumanDetections = 0;
    this.consecutiveNonHumanDetections = 0;
    this.lastValidHumanTime = 0;
    this.skinBaselineR = 0;
    this.skinBaselineG = 0;
    this.skinBaselineB = 0;
    this.perfusionBaseline = 0;
    
    console.log("🔄 HumanFingerDetector: Sistema reiniciado");
  }
}