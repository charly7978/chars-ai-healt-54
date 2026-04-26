/**
 * GATE 4 - PHYSIOLOGICAL LIVENESS VERIFIER
 * 
 * LIVENESS FISIOLÓGICO, NO MORFOLOGÍA DECORATIVA
 * 
 * Este módulo decide si hay vida óptica/pulso real, no solo un objeto rojo.
 * 
 * Requisitos:
 * - Confirmar microvariaciones temporales compatibles con sangre pulsátil
 * - Exigir periodicidad cardíaca
 * - Exigir forma de onda repetible
 * - Exigir cambios AC sobre DC
 * - Exigir coherencia de fase entre canales
 * - Detectar movimiento global vs pulso local
 * - Rechazar objetos estáticos con color piel/rojo
 * - Rechazar superficies textiles
 * - Rechazar fotos/videos sin señal óptica real
 * - Rechazar patrones periódicos artificiales
 * - Rechazar cambios por autoexposición
 * 
 * Compara:
 * A. Señal del ROI central
 * B. Señal de anillo periférico
 * C. Señal de fondo
 * D. Señal de sub-ROIs internos
 */

export interface RegionSignal {
  name: string;
  signal: number[];
  mean: number;
  variance: number;
  acComponent: number;
  dcComponent: number;
  perfusionIndex: number;
  dominantFrequency: number;
  spectralPeak: number;
  peaks: number[];
}

export interface LivenessEvidence {
  // Evidencia de pulso local
  hasLocalPulse: boolean;
  localPulseStrength: number;
  localPulseConsistency: number;
  
  // Evidencia de movimiento global
  hasGlobalMotion: boolean;
  globalMotionStrength: number;
  motionToPulseRatio: number;
  
  // Evidencia de autoexposición
  hasExposureArtifact: boolean;
  exposureArtifactStrength: number;
  
  // Evidencia de periodicidad fisiológica
  hasCardiacPeriodicity: boolean;
  cardiacFrequency: number;
  cardiacStability: number;
  
  // Evidencia de coherencia espacial
  spatialCoherence: number;
  gradientConsistency: number;
  
  // Evidencia de tejido vivo
  tissueOpticalResponse: number;
  bloodPulsatility: number;
  
  // Rechazos específicos
  isStaticObject: boolean;
  isTextilePattern: boolean;
  isPhotoVideo: boolean;
  isArtificialPeriodicity: boolean;
  isExposureInduced: boolean;
}

export interface PhysiologicalLivenessResult {
  isPhysiologicallyAlive: boolean;
  confidence: number;
  evidence: LivenessEvidence;
  rejectionReasons: string[];
  detailedAnalysis: {
    centralRegion: RegionSignal;
    peripheralRing: RegionSignal;
    background: RegionSignal;
    subROIs: RegionSignal[];
  };
}

export interface PhysiologicalLivenessConfig {
  // Umbrales de evidencia
  minLocalPulseStrength: number;
  maxGlobalMotionRatio: number;
  minCardiacStability: number;
  minSpatialCoherence: number;
  minTissueOpticalResponse: number;
  minBloodPulsatility: number;
  
  // Umbrales de rechazo
  maxStaticObjectVariance: number;
  maxExposureArtifactStrength: number;
  minArtificialPeriodicityRegularity: number;
  
  // Frecuencias fisiológicas
  minCardiacFreq: number; // BPM
  maxCardiacFreq: number; // BPM
  
  // Regiones
  centralROISize: number;
  peripheralRingWidth: number;
  backgroundMargin: number;
  subROICount: number;
}

const DEFAULT_CONFIG: PhysiologicalLivenessConfig = {
  minLocalPulseStrength: 0.3,
  maxGlobalMotionRatio: 0.4,
  minCardiacStability: 0.7,
  minSpatialCoherence: 0.6,
  minTissueOpticalResponse: 0.5,
  minBloodPulsatility: 0.4,
  
  maxStaticObjectVariance: 0.01,
  maxExposureArtifactStrength: 0.3,
  minArtificialPeriodicityRegularity: 0.9,
  
  minCardiacFreq: 40,
  maxCardiacFreq: 180,
  
  centralROISize: 60,
  peripheralRingWidth: 20,
  backgroundMargin: 30,
  subROICount: 4,
};

export class PhysiologicalLivenessVerifier {
  private config: PhysiologicalLivenessConfig;

  constructor(config: Partial<PhysiologicalLivenessConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extraer señal de una región específica
   */
  private extractRegionSignal(
    imageData: ImageData,
    region: { x: number; y: number; width: number; height: number },
    signalBuffer: number[] = []
  ): RegionSignal {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = region;
    
    // Extraer media de la región
    let sumR = 0, sumG = 0, sumB = 0;
    let pixelCount = 0;
    
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        if (px >= 0 && px < w && py >= 0 && py < imageData.height) {
          const idx = (py * w + px) * 4;
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          pixelCount++;
        }
      }
    }
    
    const mean = pixelCount > 0 ? (sumR + sumG + sumB) / (3 * pixelCount) : 0;
    
    // Agregar al buffer de señal
    signalBuffer.push(mean);
    if (signalBuffer.length > 300) { // Mantener 10 segundos a 30 FPS
      signalBuffer.shift();
    }
    
    // Calcular estadísticas
    const variance = signalBuffer.length > 1 ? 
      signalBuffer.reduce((sum, x) => sum + (x - mean) ** 2, 0) / signalBuffer.length : 0;
    
    const dcComponent = mean;
    const acComponent = Math.sqrt(variance);
    const perfusionIndex = dcComponent > 0 ? acComponent / dcComponent : 0;
    
    // Análisis espectral simplificado
    const { dominantFrequency, spectralPeak, peaks } = this.analyzeSignal(signalBuffer);
    
    return {
      name: `Region_${x}_${y}`,
      signal: [...signalBuffer],
      mean,
      variance,
      acComponent,
      dcComponent,
      perfusionIndex,
      dominantFrequency,
      spectralPeak,
      peaks,
    };
  }

  /**
   * Analizar señal (frecuencia dominante, pico espectral, picos)
   */
  private analyzeSignal(signal: number[]): { dominantFrequency: number; spectralPeak: number; peaks: number[] } {
    if (signal.length < 10) {
      return { dominantFrequency: 0, spectralPeak: 0, peaks: [] };
    }
    
    // FFT simplificada
    const n = signal.length;
    const frequencies: number[] = [];
    const magnitudes: number[] = [];
    
    for (let k = 0; k < n / 2; k++) {
      let real = 0;
      let imag = 0;
      
      for (let i = 0; i < n; i++) {
        const angle = -2 * Math.PI * k * i / n;
        real += signal[i] * Math.cos(angle);
        imag += signal[i] * Math.sin(angle);
      }
      
      frequencies.push(k * 1800 / n); // Convertir a BPM (asumiendo 30 FPS)
      magnitudes.push(Math.sqrt(real * real + imag * imag) / n);
    }
    
    // Encontrar frecuencia dominante
    const maxMagnitude = Math.max(...magnitudes);
    const dominantIndex = magnitudes.indexOf(maxMagnitude);
    const dominantFrequency = frequencies[dominantIndex];
    
    // Detectar picos en tiempo
    const peaks: number[] = [];
    const minPeakDistance = 10; // muestras
    
    for (let i = minPeakDistance; i < signal.length - minPeakDistance; i++) {
      const current = signal[i];
      const isPeak = signal.slice(i - minPeakDistance, i + minPeakDistance + 1)
        .every(x => x <= current);
      
      if (isPeak && current > signal[i - 1] * 1.1) { // Mínimo 10% sobre vecino
        peaks.push(i);
        i += minPeakDistance; // Evitar detecciones múltiples
      }
    }
    
    return { dominantFrequency, spectralPeak: maxMagnitude, peaks };
  }

  /**
   * Definir regiones de análisis
   */
  private defineRegions(imageData: ImageData, centralROI: { x: number; y: number; width: number; height: number }) {
    const { x, y, width, height } = centralROI;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    
    // Región central (más pequeña para análisis de pulso)
    const centralRegion = {
      x: centerX - this.config.centralROISize / 2,
      y: centerY - this.config.centralROISize / 2,
      width: this.config.centralROISize,
      height: this.config.centralROISize,
    };
    
    // Anillo periférico
    const peripheralRing = {
      x: centerX - (this.config.centralROISize / 2 + this.config.peripheralRingWidth),
      y: centerY - (this.config.centralROISize / 2 + this.config.peripheralRingWidth),
      width: this.config.centralROISize + 2 * this.config.peripheralRingWidth,
      height: this.config.centralROISize + 2 * this.config.peripheralRingWidth,
    };
    
    // Fondo
    const background = {
      x: Math.max(0, x - this.config.backgroundMargin),
      y: Math.max(0, y - this.config.backgroundMargin),
      width: width + 2 * this.config.backgroundMargin,
      height: height + 2 * this.config.backgroundMargin,
    };
    
    // Sub-ROIs internos
    const subROIs: Array<{ x: number; y: number; width: number; height: number }> = [];
    const subROISize = this.config.centralROISize / 3;
    
    for (let i = 0; i < this.config.subROICount; i++) {
      const angle = (i * 2 * Math.PI) / this.config.subROICount;
      const radius = this.config.centralROISize / 4;
      
      subROIs.push({
        x: centerX + radius * Math.cos(angle) - subROISize / 2,
        y: centerY + radius * Math.sin(angle) - subROISize / 2,
        width: subROISize,
        height: subROISize,
      });
    }
    
    return { centralRegion, peripheralRing, background, subROIs };
  }

  /**
   * Verificar movimiento global vs pulso local
   */
  private verifyMotionVsPulse(
    central: RegionSignal,
    peripheral: RegionSignal,
    background: RegionSignal
  ): {
    hasGlobalMotion: boolean;
    globalMotionStrength: number;
    hasLocalPulse: boolean;
    localPulseStrength: number;
    motionToPulseRatio: number;
  } {
    // Si todas las regiones tienen la misma frecuencia -> movimiento global
    const freqDiffCentralPeripheral = Math.abs(central.dominantFrequency - peripheral.dominantFrequency);
    const freqDiffCentralBackground = Math.abs(central.dominantFrequency - background.dominantFrequency);
    const freqDiffPeripheralBackground = Math.abs(peripheral.dominantFrequency - background.dominantFrequency);
    
    const avgFreqDiff = (freqDiffCentralPeripheral + freqDiffCentralBackground + freqDiffPeripheralBackground) / 3;
    
    // Movimiento global detectado si frecuencias son muy similares
    const hasGlobalMotion = avgFreqDiff < 5; // Diferencia menor a 5 BPM
    const globalMotionStrength = hasGlobalMotion ? 1 - (avgFreqDiff / 5) : 0;
    
    // Pulso local si central tiene frecuencia cardíaca y es diferente del fondo
    const centralFreqInRange = central.dominantFrequency >= this.config.minCardiacFreq && 
                              central.dominantFrequency <= this.config.maxCardiacFreq;
    const centralDifferentFromBackground = freqDiffCentralBackground > 10;
    
    const hasLocalPulse = centralFreqInRange && centralDifferentFromBackground && central.perfusionIndex > 0.01;
    const localPulseStrength = hasLocalPulse ? 
      Math.min(1, central.perfusionIndex * 50) * (freqDiffCentralBackground / 50) : 0;
    
    const motionToPulseRatio = globalMotionStrength > 0 ? localPulseStrength / globalMotionStrength : 
      (localPulseStrength > 0 ? 10 : 0);
    
    return {
      hasGlobalMotion,
      globalMotionStrength,
      hasLocalPulse,
      localPulseStrength,
      motionToPulseRatio,
    };
  }

  /**
   * Verificar artefactos de autoexposición
   */
  private verifyExposureArtifacts(
    central: RegionSignal,
    peripheral: RegionSignal,
    background: RegionSignal
  ): {
    hasExposureArtifact: boolean;
    exposureArtifactStrength: number;
  } {
    // Autoexposición afecta toda la imagen de manera similar
    // pero con cambios lentos y sin pulsatilidad
    
    const centralVariance = central.variance;
    const peripheralVariance = peripheral.variance;
    const backgroundVariance = background.variance;
    
    // Si todas las regiones tienen baja varianza pero cambios lentos -> autoexposición
    const allLowVariance = centralVariance < 0.1 && peripheralVariance < 0.1 && backgroundVariance < 0.1;
    const allLowPerfusion = central.perfusionIndex < 0.005 && 
                           peripheral.perfusionIndex < 0.005 && 
                           background.perfusionIndex < 0.005;
    
    // Correlación entre regiones
    const correlation = this.calculateCorrelation(central.signal, peripheral.signal);
    
    const hasExposureArtifact = allLowVariance && allLowPerfusion && correlation > 0.8;
    const exposureArtifactStrength = hasExposureArtifact ? correlation : 0;
    
    return { hasExposureArtifact, exposureArtifactStrength };
  }

  /**
   * Verificar periodicidad cardíaca
   */
  private verifyCardiacPeriodicity(central: RegionSignal): {
    hasCardiacPeriodicity: boolean;
    cardiacFrequency: number;
    cardiacStability: number;
  } {
    const freq = central.dominantFrequency;
    const hasCardiacPeriodicity = freq >= this.config.minCardiacFreq && 
                                freq <= this.config.maxCardiacFreq &&
                                central.spectralPeak > 0.01;
    
    // Estabilidad basada en consistencia de picos
    let cardiacStability = 0;
    if (central.peaks.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < central.peaks.length; i++) {
        intervals.push(central.peaks[i] - central.peaks[i - 1]);
      }
      
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, interval) => sum + (interval - meanInterval) ** 2, 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      cardiacStability = Math.max(0, 1 - (stdDev / meanInterval));
    }
    
    return {
      hasCardiacPeriodicity,
      cardiacFrequency: freq,
      cardiacStability,
    };
  }

  /**
   * Verificar coherencia espacial
   */
  private verifySpatialCoherence(
    central: RegionSignal,
    subROIs: RegionSignal[]
  ): {
    spatialCoherence: number;
    gradientConsistency: number;
  } {
    if (subROIs.length === 0) {
      return { spatialCoherence: 0, gradientConsistency: 0 };
    }
    
    // Coherencia entre centro y sub-ROIs
    let totalCoherence = 0;
    let validSubROIs = 0;
    
    for (const subROI of subROIs) {
      if (subROI.perfusionIndex > 0.001) {
        const coherence = this.calculateCorrelation(central.signal, subROI.signal);
        totalCoherence += coherence;
        validSubROIs++;
      }
    }
    
    const spatialCoherence = validSubROIs > 0 ? totalCoherence / validSubROIs : 0;
    
    // Consistencia de gradiente (el pulso debe ser más fuerte en el centro)
    const centralPerfusion = central.perfusionIndex;
    const avgSubROIPerfusion = subROIs.reduce((sum, roi) => sum + roi.perfusionIndex, 0) / subROIs.length;
    
    const gradientConsistency = centralPerfusion > avgSubROIPerfusion ? 
      Math.min(1, (centralPerfusion - avgSubROIPerfusion) / centralPerfusion) : 0;
    
    return { spatialCoherence, gradientConsistency };
  }

  /**
   * Verificar respuesta óptica de tejido
   */
  private verifyTissueOpticalResponse(central: RegionSignal): {
    tissueOpticalResponse: number;
    bloodPulsatility: number;
  } {
    // Tejido vivo debe tener respuesta óptica característica
    const perfusionIndex = central.perfusionIndex;
    const acComponent = central.acComponent;
    const dcComponent = central.dcComponent;
    
    // Respuesta de tejido: perfusión moderada con componente AC claro
    const tissueOpticalResponse = Math.min(1, perfusionIndex * 100) * Math.min(1, acComponent * 10);
    
    // Pulsatilidad sanguínea: relación AC/DC en rango fisiológico
    const bloodPulsatility = perfusionIndex >= 0.001 && perfusionIndex <= 0.1 ? 
      Math.min(1, perfusionIndex * 20) : 0;
    
    return { tissueOpticalResponse, bloodPulsatility };
  }

  /**
   * Calcular correlación entre dos señales
   */
  private calculateCorrelation(signal1: number[], signal2: number[]): number {
    if (signal1.length !== signal2.length || signal1.length === 0) return 0;
    
    const n = signal1.length;
    const mean1 = signal1.reduce((a, b) => a + b, 0) / n;
    const mean2 = signal2.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let var1 = 0;
    let var2 = 0;
    
    for (let i = 0; i < n; i++) {
      const diff1 = signal1[i] - mean1;
      const diff2 = signal2[i] - mean2;
      numerator += diff1 * diff2;
      var1 += diff1 * diff1;
      var2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(var1 * var2);
    return denominator > 0 ? Math.abs(numerator / denominator) : 0;
  }

  /**
   * Verificar si es objeto estático
   */
  private verifyStaticObject(central: RegionSignal): boolean {
    return central.variance < this.config.maxStaticObjectVariance && 
           central.perfusionIndex < 0.001;
  }

  /**
   * Verificar patrón textil
   */
  private verifyTextilePattern(
    central: RegionSignal,
    subROIs: RegionSignal[]
  ): boolean {
    // Patrón textil: alta periodicidad artificial pero sin fisiología
    if (central.peaks.length < 3) return false;
    
    // Intervalos muy regulares (demasiado perfectos)
    const intervals: number[] = [];
    for (let i = 1; i < central.peaks.length; i++) {
      intervals.push(central.peaks[i] - central.peaks[i - 1]);
    }
    
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + (interval - meanInterval) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = meanInterval > 0 ? stdDev / meanInterval : 1;
    
    // Patrones textiles son muy regulares
    const isTooRegular = coefficientOfVariation < 0.05;
    
    // Sin perfusión sanguínea real
    const noBloodPerfusion = central.perfusionIndex < 0.002;
    
    return isTooRegular && noBloodPerfusion;
  }

  /**
   * Verificar si es foto/video
   */
  private verifyPhotoVideo(
    central: RegionSignal,
    background: RegionSignal
  ): boolean {
    // Foto/video: señal idéntica o muy similar entre región de interés y fondo
    const correlation = this.calculateCorrelation(central.signal, background.signal);
    
    // Sin diferencias espaciales
    const noSpatialDifferences = correlation > 0.95;
    
    // Sin componente AC real
    const noACComponent = central.perfusionIndex < 0.001;
    
    return noSpatialDifferences && noACComponent;
  }

  /**
   * Verificar periodicidad artificial
   */
  private verifyArtificialPeriodicity(central: RegionSignal): boolean {
    if (central.peaks.length < 5) return false;
    
    // Periodicidad perfecta sin variabilidad fisiológica
    const intervals: number[] = [];
    for (let i = 1; i < central.peaks.length; i++) {
      intervals.push(central.peaks[i] - central.peaks[i - 1]);
    }
    
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + (interval - meanInterval) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = meanInterval > 0 ? stdDev / meanInterval : 1;
    
    return coefficientOfVariation < (1 - this.config.minArtificialPeriodicityRegularity);
  }

  /**
   * Evaluar liveness fisiológico completo
   */
  evaluate(
    imageData: ImageData,
    centralROI: { x: number; y: number; width: number; height: number },
    regionBuffers: {
      central: number[];
      peripheral: number[];
      background: number[];
      subROIs: number[][];
    }
  ): PhysiologicalLivenessResult {
    // Definir regiones
    const { centralRegion, peripheralRing, background, subROIs } = this.defineRegions(imageData, centralROI);
    
    // Extraer señales
    const centralSignal = this.extractRegionSignal(imageData, centralRegion, regionBuffers.central);
    const peripheralSignal = this.extractRegionSignal(imageData, peripheralRing, regionBuffers.peripheral);
    const backgroundSignal = this.extractRegionSignal(imageData, background, regionBuffers.background);
    
    const subROISignals = subROIs.map((roi, index) => 
      this.extractRegionSignal(imageData, roi, regionBuffers.subROIs[index] || [])
    );
    
    // Verificaciones principales
    const motionVsPulse = this.verifyMotionVsPulse(centralSignal, peripheralSignal, backgroundSignal);
    const exposureArtifacts = this.verifyExposureArtifacts(centralSignal, peripheralSignal, backgroundSignal);
    const cardiacPeriodicity = this.verifyCardiacPeriodicity(centralSignal);
    const spatialCoherence = this.verifySpatialCoherence(centralSignal, subROISignals);
    const tissueResponse = this.verifyTissueOpticalResponse(centralSignal);
    
    // Verificaciones de rechazo
    const isStaticObject = this.verifyStaticObject(centralSignal);
    const isTextilePattern = this.verifyTextilePattern(centralSignal, subROISignals);
    const isPhotoVideo = this.verifyPhotoVideo(centralSignal, backgroundSignal);
    const isArtificialPeriodicity = this.verifyArtificialPeriodicity(centralSignal);
    const isExposureInduced = exposureArtifacts.hasExposureArtifact;
    
    // Compilar evidencia
    const evidence: LivenessEvidence = {
      hasLocalPulse: motionVsPulse.hasLocalPulse,
      localPulseStrength: motionVsPulse.localPulseStrength,
      localPulseConsistency: cardiacPeriodicity.cardiacStability,
      
      hasGlobalMotion: motionVsPulse.hasGlobalMotion,
      globalMotionStrength: motionVsPulse.globalMotionStrength,
      motionToPulseRatio: motionVsPulse.motionToPulseRatio,
      
      hasExposureArtifact: exposureArtifacts.hasExposureArtifact,
      exposureArtifactStrength: exposureArtifacts.exposureArtifactStrength,
      
      hasCardiacPeriodicity: cardiacPeriodicity.hasCardiacPeriodicity,
      cardiacFrequency: cardiacPeriodicity.cardiacFrequency,
      cardiacStability: cardiacPeriodicity.cardiacStability,
      
      spatialCoherence: spatialCoherence.spatialCoherence,
      gradientConsistency: spatialCoherence.gradientConsistency,
      
      tissueOpticalResponse: tissueResponse.tissueOpticalResponse,
      bloodPulsatility: tissueResponse.bloodPulsatility,
      
      isStaticObject,
      isTextilePattern,
      isPhotoVideo,
      isArtificialPeriodicity,
      isExposureInduced,
    };
    
    // Calcular confianza general
    let confidence = 1;
    const rejectionReasons: string[] = [];
    
    // Factores positivos
    confidence *= (0.3 + evidence.localPulseStrength * 0.7);
    confidence *= (0.4 + evidence.cardiacStability * 0.6);
    confidence *= (0.3 + evidence.spatialCoherence * 0.7);
    confidence *= (0.4 + evidence.tissueOpticalResponse * 0.6);
    confidence *= (0.5 + evidence.bloodPulsatility * 0.5);
    
    // Factores negativos (rechazo)
    if (evidence.hasGlobalMotion && evidence.motionToPulseRatio < 1) {
      confidence *= 0.3;
      rejectionReasons.push('Movimiento global domina sobre pulso local');
    }
    
    if (evidence.hasExposureArtifact) {
      confidence *= 0.2;
      rejectionReasons.push('Artefactos de autoexposición detectados');
    }
    
    if (isStaticObject) {
      confidence = 0;
      rejectionReasons.push('Objeto estático sin variación temporal');
    }
    
    if (isTextilePattern) {
      confidence = 0;
      rejectionReasons.push('Patrón textil detectado');
    }
    
    if (isPhotoVideo) {
      confidence = 0;
      rejectionReasons.push('Señal compatible con foto/video');
    }
    
    if (isArtificialPeriodicity) {
      confidence = 0;
      rejectionReasons.push('Periodicidad artificial detectada');
    }
    
    if (!evidence.hasCardiacPeriodicity) {
      confidence *= 0.1;
      rejectionReasons.push('Sin periodicidad cardíaca detectada');
    }
    
    if (evidence.spatialCoherence < this.config.minSpatialCoherence) {
      confidence *= 0.5;
      rejectionReasons.push('Baja coherencia espacial');
    }
    
    if (evidence.tissueOpticalResponse < this.config.minTissueOpticalResponse) {
      confidence *= 0.5;
      rejectionReasons.push('Respuesta óptica no compatible con tejido');
    }
    
    // Decisión final
    const isPhysiologicallyAlive = confidence >= 0.7 && 
                                  evidence.hasLocalPulse && 
                                  evidence.hasCardiacPeriodicity &&
                                  !isStaticObject &&
                                  !isTextilePattern &&
                                  !isPhotoVideo &&
                                  !isArtificialPeriodicity &&
                                  !isExposureInduced;
    
    return {
      isPhysiologicallyAlive,
      confidence: Math.max(0, Math.min(1, confidence)),
      evidence,
      rejectionReasons,
      detailedAnalysis: {
        centralRegion: centralSignal,
        peripheralRing: peripheralSignal,
        background: backgroundSignal,
        subROIs: subROISignals,
      },
    };
  }

  /**
   * Resetear verificador
   */
  reset(): void {
    // No hay estado persistente que resetear
  }

  /**
   * Actualizar configuración
   */
  updateConfig(config: Partial<PhysiologicalLivenessConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): PhysiologicalLivenessConfig {
    return { ...this.config };
  }
}
