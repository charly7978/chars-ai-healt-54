/**
 * EXTRACTOR DE CARACTERÍSTICAS PPG
 * Basado en literatura científica:
 * - Satter et al. 2024 (MDPI) - Glucose estimation from PPG
 * - NiADA 2024 (PubMed) - Hemoglobin via smartphone
 * - Arguello-Prada et al. 2025 - Cholesterol from PPG
 */
export class PPGFeatureExtractor {
  
  /**
   * Extrae el ratio AC/DC de la señal PPG
   * AC = componente pulsátil (variación), DC = componente base
   * Usado para: SpO2, Glucosa
   */
  static extractACDCRatio(buffer: number[]): { ac: number; dc: number; ratio: number } {
    if (buffer.length < 10) {
      return { ac: 0, dc: 0, ratio: 0 };
    }
    
    const recent = buffer.slice(-30);
    
    // DC: valor medio (componente no pulsátil)
    const dc = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // AC: amplitud pico a pico (componente pulsátil)
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const ac = max - min;
    
    // Ratio AC/DC (perfusion index relacionado)
    const ratio = dc !== 0 ? ac / Math.abs(dc) : 0;
    
    return { ac, dc, ratio };
  }
  
  /**
   * Calcula el ancho del pulso sistólico
   * Usado para: Lípidos, Viscosidad sanguínea
   */
  static extractPulseWidth(buffer: number[]): number {
    if (buffer.length < 20) return 0;
    
    const recent = buffer.slice(-30);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Contar samples por encima del umbral (50% de amplitud)
    const threshold = mean;
    let widthSum = 0;
    let pulseCount = 0;
    let inPulse = false;
    let currentWidth = 0;
    
    for (let i = 0; i < recent.length; i++) {
      if (recent[i] > threshold) {
        if (!inPulse) {
          inPulse = true;
          currentWidth = 0;
        }
        currentWidth++;
      } else {
        if (inPulse) {
          widthSum += currentWidth;
          pulseCount++;
          inPulse = false;
        }
      }
    }
    
    return pulseCount > 0 ? widthSum / pulseCount : 0;
  }
  
  /**
   * Detecta la profundidad de la muesca dicrotica
   * Indica elasticidad arterial - relacionado con lípidos
   */
  static extractDicroticNotchDepth(buffer: number[]): number {
    if (buffer.length < 20) return 0;
    
    const recent = buffer.slice(-30);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const amplitude = max - min;
    
    if (amplitude < 0.001) return 0;
    
    // Buscar el segundo pico local (muesca dicrotica)
    const peaks: number[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i] > recent[i-1] && recent[i] > recent[i+1]) {
        peaks.push(recent[i]);
      }
    }
    
    if (peaks.length < 2) return 0;
    
    // Ordenar picos de mayor a menor
    peaks.sort((a, b) => b - a);
    
    // Profundidad relativa entre primer y segundo pico
    const depth = (peaks[0] - peaks[1]) / amplitude;
    
    return Math.max(0, Math.min(1, depth));
  }
  
  /**
   * Calcula el tiempo sistólico (tiempo de subida del pulso)
   * Relacionado con presión arterial y rigidez arterial
   */
  static extractSystolicTime(buffer: number[]): number {
    if (buffer.length < 15) return 0;
    
    const recent = buffer.slice(-30);
    
    // Encontrar valles (mínimos locales)
    const valleys: { index: number; value: number }[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i] < recent[i-1] && recent[i] < recent[i+1]) {
        valleys.push({ index: i, value: recent[i] });
      }
    }
    
    if (valleys.length < 1) return 0;
    
    // Encontrar picos entre valles
    let totalRiseTime = 0;
    let count = 0;
    
    for (let v = 0; v < valleys.length - 1; v++) {
      const startIdx = valleys[v].index;
      const endIdx = valleys[v + 1].index;
      
      let maxIdx = startIdx;
      let maxVal = recent[startIdx];
      
      for (let i = startIdx; i <= endIdx; i++) {
        if (recent[i] > maxVal) {
          maxVal = recent[i];
          maxIdx = i;
        }
      }
      
      // Tiempo de subida = índice del pico - índice del valle
      const riseTime = maxIdx - startIdx;
      if (riseTime > 0) {
        totalRiseTime += riseTime;
        count++;
      }
    }
    
    return count > 0 ? totalRiseTime / count : 0;
  }
  
  /**
   * Calcula la variabilidad de amplitud de los picos
   * Relacionada con glucosa y estado metabólico
   */
  static extractAmplitudeVariability(buffer: number[]): number {
    if (buffer.length < 20) return 0;
    
    const recent = buffer.slice(-45);
    
    // Encontrar picos
    const peaks: number[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i] > recent[i-1] && recent[i] > recent[i+1]) {
        peaks.push(recent[i]);
      }
    }
    
    if (peaks.length < 3) return 0;
    
    // Calcular desviación estándar de las amplitudes de picos
    const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const variance = peaks.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / peaks.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * Calcula la variabilidad de intervalos RR
   * Para HRV y detección de arritmias
   */
  static extractRRVariability(intervals: number[]): { sdnn: number; rmssd: number; cv: number } {
    if (intervals.length < 3) {
      return { sdnn: 0, rmssd: 0, cv: 0 };
    }
    
    const validIntervals = intervals.filter(i => i > 300 && i < 2000);
    if (validIntervals.length < 3) {
      return { sdnn: 0, rmssd: 0, cv: 0 };
    }
    
    const mean = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    
    // SDNN: desviación estándar de intervalos NN
    const sdnn = Math.sqrt(
      validIntervals.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / validIntervals.length
    );
    
    // RMSSD: raíz cuadrada de la media de diferencias sucesivas al cuadrado
    let sumSquaredDiff = 0;
    for (let i = 1; i < validIntervals.length; i++) {
      sumSquaredDiff += Math.pow(validIntervals[i] - validIntervals[i-1], 2);
    }
    const rmssd = Math.sqrt(sumSquaredDiff / (validIntervals.length - 1));
    
    // CV: coeficiente de variación
    const cv = mean !== 0 ? sdnn / mean : 0;
    
    return { sdnn, rmssd, cv };
  }
  
  /**
   * Extrae todas las características de un buffer PPG
   */
  static extractAllFeatures(buffer: number[], rrIntervals?: number[]) {
    const acdc = this.extractACDCRatio(buffer);
    const pulseWidth = this.extractPulseWidth(buffer);
    const dicroticDepth = this.extractDicroticNotchDepth(buffer);
    const systolicTime = this.extractSystolicTime(buffer);
    const amplitudeVar = this.extractAmplitudeVariability(buffer);
    const rrVar = rrIntervals ? this.extractRRVariability(rrIntervals) : { sdnn: 0, rmssd: 0, cv: 0 };
    
    return {
      ac: acdc.ac,
      dc: acdc.dc,
      acDcRatio: acdc.ratio,
      pulseWidth,
      dicroticDepth,
      systolicTime,
      amplitudeVariability: amplitudeVar,
      sdnn: rrVar.sdnn,
      rmssd: rrVar.rmssd,
      rrCV: rrVar.cv
    };
  }
}
