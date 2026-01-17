/**
 * EXTRACTOR DE CARACTERÍSTICAS PPG AVANZADO
 * 
 * NUEVAS CARACTERÍSTICAS (ETH Zurich, MIT 2024):
 * - Augmentation Index (AIx) desde 2da derivada
 * - Stiffness Index (SI) 
 * - Pulse Wave Velocity proxy
 * - Segunda derivada (APG) para análisis morfológico
 * 
 * Referencias:
 * - Satter et al. 2024 (MDPI) - Glucose estimation from PPG
 * - NiADA 2024 (PubMed) - Hemoglobin via smartphone
 * - Arguello-Prada et al. 2025 - Cholesterol from PPG
 * - Elgendi 2012 - On the analysis of PPG signal features
 */
export class PPGFeatureExtractor {
  
  /**
   * Extrae el ratio AC/DC de la señal PPG
   * AC = componente pulsátil (variación), DC = componente base
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
   * SEGUNDA DERIVADA (APG - Acceleration Plethysmogram)
   * Crítico para análisis morfológico y AIx
   */
  static calculateSecondDerivative(buffer: number[]): number[] {
    if (buffer.length < 5) return [];
    
    const apg: number[] = [];
    
    // Segunda derivada: f''(x) ≈ f(x+1) - 2f(x) + f(x-1)
    for (let i = 1; i < buffer.length - 1; i++) {
      const d2 = buffer[i + 1] - 2 * buffer[i] + buffer[i - 1];
      apg.push(d2);
    }
    
    return apg;
  }
  
  /**
   * AUGMENTATION INDEX (AIx)
   * Ratio entre pico reflejo y pico sistólico
   * Indicador de rigidez arterial y presión central
   * 
   * AIx = (P2 - Pd) / (P1 - Pd) * 100
   * Donde P1 = pico sistólico, P2 = pico reflejo, Pd = presión diastólica
   */
  static extractAugmentationIndex(buffer: number[]): number {
    if (buffer.length < 30) return 0;
    
    const recent = buffer.slice(-60);
    const apg = this.calculateSecondDerivative(recent);
    
    if (apg.length < 10) return 0;
    
    // Encontrar picos y valles en la segunda derivada
    const peaks: { idx: number; val: number }[] = [];
    const valleys: { idx: number; val: number }[] = [];
    
    for (let i = 2; i < apg.length - 2; i++) {
      if (apg[i] > apg[i-1] && apg[i] > apg[i+1] && 
          apg[i] > apg[i-2] && apg[i] > apg[i+2]) {
        peaks.push({ idx: i, val: apg[i] });
      }
      if (apg[i] < apg[i-1] && apg[i] < apg[i+1] &&
          apg[i] < apg[i-2] && apg[i] < apg[i+2]) {
        valleys.push({ idx: i, val: apg[i] });
      }
    }
    
    if (peaks.length < 2 || valleys.length < 1) return 0;
    
    // Ordenar picos por valor
    peaks.sort((a, b) => b.val - a.val);
    
    // P1 = primer pico (sistólico), P2 = segundo pico (reflejo)
    const p1 = peaks[0].val;
    const p2 = peaks.length > 1 ? peaks[1].val : p1 * 0.8;
    const minVal = Math.min(...recent);
    
    // AIx como ratio
    const aix = p1 !== minVal ? ((p2 - minVal) / (p1 - minVal)) * 100 : 0;
    
    return Math.max(-50, Math.min(100, aix)); // AIx puede ser negativo en jóvenes
  }
  
  /**
   * STIFFNESS INDEX (SI)
   * SI = altura del sujeto / tiempo entre picos
   * Proxy para PWV sin altura: ratio temporal
   */
  static extractStiffnessIndex(buffer: number[]): number {
    if (buffer.length < 30) return 0;
    
    const recent = buffer.slice(-60);
    
    // Encontrar picos principales
    const peaks: { idx: number; val: number }[] = [];
    
    for (let i = 2; i < recent.length - 2; i++) {
      if (recent[i] > recent[i-1] && recent[i] > recent[i+1] &&
          recent[i] > recent[i-2] && recent[i] > recent[i+2]) {
        peaks.push({ idx: i, val: recent[i] });
      }
    }
    
    if (peaks.length < 2) return 0;
    
    // Ordenar por valor para encontrar pico sistólico y diastólico
    peaks.sort((a, b) => b.val - a.val);
    
    const systolicPeak = peaks[0];
    
    // Buscar pico diastólico (después del sistólico)
    const diastolicCandidates = peaks.filter(p => p.idx > systolicPeak.idx);
    
    if (diastolicCandidates.length === 0) return 0;
    
    const diastolicPeak = diastolicCandidates[0];
    
    // Tiempo entre picos (en samples, asumiendo 30fps → ms)
    const deltaT = (diastolicPeak.idx - systolicPeak.idx) * (1000 / 30);
    
    if (deltaT <= 0) return 0;
    
    // SI normalizado (sin altura, usamos inverso del tiempo)
    // Valores más altos = arterias más rígidas
    const si = 1000 / deltaT;
    
    return si;
  }
  
  /**
   * PULSE WAVE VELOCITY PROXY
   * Sin ECG, usamos características morfológicas del PPG
   */
  static extractPWVProxy(buffer: number[], rrIntervals: number[]): number {
    if (buffer.length < 30 || rrIntervals.length < 3) return 0;
    
    // PWV correlaciona con:
    // 1. Tiempo sistólico (más corto = mayor PWV)
    // 2. AIx (mayor = mayor PWV)
    // 3. HR (mayor = generalmente mayor PWV)
    
    const systolicTime = this.extractSystolicTime(buffer);
    const aix = this.extractAugmentationIndex(buffer);
    const avgRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const hr = 60000 / avgRR;
    
    if (systolicTime <= 0) return 0;
    
    // PWV proxy formula empírica
    // Normalizado a ~5-15 m/s (rango típico)
    const pwvProxy = 5 + (1 / systolicTime) * 2 + (aix / 50) + (hr - 60) * 0.03;
    
    return Math.max(3, Math.min(20, pwvProxy));
  }
  
  /**
   * Calcula el ancho del pulso sistólico
   */
  static extractPulseWidth(buffer: number[]): number {
    if (buffer.length < 20) return 0;
    
    const recent = buffer.slice(-30);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    let widthSum = 0;
    let pulseCount = 0;
    let inPulse = false;
    let currentWidth = 0;
    
    for (let i = 0; i < recent.length; i++) {
      if (recent[i] > mean) {
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
   */
  static extractDicroticNotchDepth(buffer: number[]): number {
    if (buffer.length < 20) return 0;
    
    const recent = buffer.slice(-30);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const amplitude = max - min;
    
    if (amplitude < 0.001) return 0;
    
    const peaks: number[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i] > recent[i-1] && recent[i] > recent[i+1]) {
        peaks.push(recent[i]);
      }
    }
    
    if (peaks.length < 2) return 0;
    
    peaks.sort((a, b) => b - a);
    const depth = (peaks[0] - peaks[1]) / amplitude;
    
    return Math.max(0, Math.min(1, depth));
  }
  
  /**
   * Calcula el tiempo sistólico (tiempo de subida del pulso)
   */
  static extractSystolicTime(buffer: number[]): number {
    if (buffer.length < 15) return 0;
    
    const recent = buffer.slice(-30);
    
    const valleys: { index: number; value: number }[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i] < recent[i-1] && recent[i] < recent[i+1]) {
        valleys.push({ index: i, value: recent[i] });
      }
    }
    
    if (valleys.length < 1) return 0;
    
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
   */
  static extractAmplitudeVariability(buffer: number[]): number {
    if (buffer.length < 20) return 0;
    
    const recent = buffer.slice(-45);
    
    const peaks: number[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i] > recent[i-1] && recent[i] > recent[i+1]) {
        peaks.push(recent[i]);
      }
    }
    
    if (peaks.length < 3) return 0;
    
    const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const variance = peaks.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / peaks.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * PICOS DE SEGUNDA DERIVADA (APG Features: a, b, c, d, e)
   * Usados en literatura para edad vascular y rigidez arterial
   */
  static extractAPGFeatures(buffer: number[]): {
    a: number; b: number; c: number; d: number; e: number;
    bDivA: number; // b/a ratio - correlaciona con edad vascular
    cDivA: number;
    dDivA: number;
    eDivA: number;
    agi: number;   // Aging Index
  } {
    const defaults = { a: 0, b: 0, c: 0, d: 0, e: 0, bDivA: 0, cDivA: 0, dDivA: 0, eDivA: 0, agi: 0 };
    
    if (buffer.length < 30) return defaults;
    
    const apg = this.calculateSecondDerivative(buffer.slice(-60));
    
    if (apg.length < 15) return defaults;
    
    // Encontrar los 5 puntos característicos del APG
    const peaks: { idx: number; val: number }[] = [];
    const valleys: { idx: number; val: number }[] = [];
    
    for (let i = 2; i < apg.length - 2; i++) {
      if (apg[i] > apg[i-1] && apg[i] > apg[i+1]) {
        peaks.push({ idx: i, val: apg[i] });
      }
      if (apg[i] < apg[i-1] && apg[i] < apg[i+1]) {
        valleys.push({ idx: i, val: apg[i] });
      }
    }
    
    // Ordenar por posición temporal
    peaks.sort((a, b) => a.idx - b.idx);
    valleys.sort((a, b) => a.idx - b.idx);
    
    // APG típico: a (pico), b (valle), c (pico), d (valle), e (pico)
    const a = peaks.length > 0 ? peaks[0].val : 0;
    const b = valleys.length > 0 ? valleys[0].val : 0;
    const c = peaks.length > 1 ? peaks[1].val : 0;
    const d = valleys.length > 1 ? valleys[1].val : 0;
    const e = peaks.length > 2 ? peaks[2].val : 0;
    
    // Ratios normalizados
    const bDivA = a !== 0 ? b / a : 0;
    const cDivA = a !== 0 ? c / a : 0;
    const dDivA = a !== 0 ? d / a : 0;
    const eDivA = a !== 0 ? e / a : 0;
    
    // Aging Index: (b - c - d - e) / a
    const agi = a !== 0 ? (b - c - d - e) / a : 0;
    
    return { a, b, c, d, e, bDivA, cDivA, dDivA, eDivA, agi };
  }
  
  /**
   * Calcula la variabilidad de intervalos RR
   */
  static extractRRVariability(intervals: number[]): { sdnn: number; rmssd: number; cv: number } {
    if (intervals.length < 3) {
      return { sdnn: 0, rmssd: 0, cv: 0 };
    }
    
    const validIntervals = intervals.filter(i => i > 200 && i < 3000);
    if (validIntervals.length < 3) {
      return { sdnn: 0, rmssd: 0, cv: 0 };
    }
    
    const mean = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    
    // SDNN
    const sdnn = Math.sqrt(
      validIntervals.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / validIntervals.length
    );
    
    // RMSSD
    let sumSquaredDiff = 0;
    for (let i = 1; i < validIntervals.length; i++) {
      sumSquaredDiff += Math.pow(validIntervals[i] - validIntervals[i-1], 2);
    }
    const rmssd = Math.sqrt(sumSquaredDiff / (validIntervals.length - 1));
    
    // CV
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
    
    // NUEVAS características morfológicas
    const aix = this.extractAugmentationIndex(buffer);
    const si = this.extractStiffnessIndex(buffer);
    const pwvProxy = rrIntervals ? this.extractPWVProxy(buffer, rrIntervals) : 0;
    const apgFeatures = this.extractAPGFeatures(buffer);
    
    return {
      // Básicas
      ac: acdc.ac,
      dc: acdc.dc,
      acDcRatio: acdc.ratio,
      pulseWidth,
      dicroticDepth,
      systolicTime,
      amplitudeVariability: amplitudeVar,
      
      // HRV
      sdnn: rrVar.sdnn,
      rmssd: rrVar.rmssd,
      rrCV: rrVar.cv,
      
      // NUEVAS morfológicas
      augmentationIndex: aix,
      stiffnessIndex: si,
      pwvProxy,
      
      // APG features
      apg: apgFeatures
    };
  }
}
