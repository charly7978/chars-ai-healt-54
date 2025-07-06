/**
 * Enhanced Signal Processor based on advanced biomedical signal processing techniques
 * Implementa algoritmos de detección ultra-sensibles para señales PPG
 */
export class SignalProcessor {
  // Ajuste: reducimos la ventana del SMA para mayor reactividad
  private readonly SMA_WINDOW = 2; 
  private ppgValues: number[] = [];
  private readonly WINDOW_SIZE = 200; // Reducido para más rápida adaptación (antes 250)
  
  // Coeficientes de filtrado avanzados basados en investigación de filtros Savitzky-Golay
  private readonly SG_COEFFS = [0.2, 0.3, 0.5, 0.7, 1.0, 0.7, 0.5, 0.3, 0.2];
  private readonly SG_NORM = 4.4; // Factor de normalización para coeficientes
  
  // Parámetros de eliminación de ruido tipo wavelet - VALORES DE SENSIBILIDAD AUMENTADOS
  private readonly WAVELET_THRESHOLD = 0.003; // Reducido para máxima sensibilidad (antes 0.005)
  private readonly BASELINE_FACTOR = 0.98; // Incrementado para mejor seguimiento (antes 0.97)
  private baselineValue: number = 0;
  
  // PARÁMETROS DE SENSIBILIDAD EXTREMA MEJORADOS
  private readonly PEAK_ENHANCEMENT = 5.0; // Factor de amplificación extremo para picos (antes 3.5)
  private readonly MIN_SIGNAL_BOOST = 12.0; // Amplificación máxima para señales débiles (antes 8.0)
  private readonly ADAPTIVE_GAIN_ENABLED = true; // Mantener activada ganancia adaptativa
  private readonly NOISE_SUPPRESSION = 0.7; // Supresión de ruido más agresiva pero no excesiva (antes 0.8)
  
  // Seguimiento de máximos y mínimos para normalización
  private recentMax: number = 0;
  private recentMin: number = 0;
  private readonly NORMALIZATION_FACTOR = 0.92; // Respuesta más rápida (antes 0.95)
  
  // NUEVO: Retroalimentación temporal para mejorar detección de picos
  private peakHistory: number[] = [];
  private readonly PEAK_HISTORY_SIZE = 10;
  private readonly PEAK_SIMILARITY_THRESHOLD = 0.4;
  
  // NUEVO: Estabilización de señal con compensación adaptativa
  private stabilizationBuffer: number[] = [];
  private readonly STAB_BUFFER_SIZE = 5;
  private readonly TREND_AMPLIFIER = 2.5;
  
  /**
   * Procesamiento principal - ahora con amplificación extrema para señales débiles
   * y mejor preservación de picos cardíacos
   */
  public applySMAFilter(value: number): number {
    // NUEVO: Amplificación inicial para garantizar señal mínima detectable
    value = value * 1.5 + 2;
    
    // Añadir valor al buffer
    this.ppgValues.push(value);
    if (this.ppgValues.length > this.WINDOW_SIZE) {
      this.ppgValues.shift();
    }
    
    // MEJORA: Actualizar línea base con respuesta adaptativa
    if (this.baselineValue === 0 && this.ppgValues.length > 0) {
      this.baselineValue = value;
    } else {
      // Adaptación dinámica ultra-rápida
      const adaptationSpeed = this.detectSignalChange() ? 0.3 : 0.08; // Más rápida (antes 0.2 y 0.05)
      this.baselineValue = this.baselineValue * (1 - adaptationSpeed) + value * adaptationSpeed;
    }
    
    // Usar SMA como filtro inicial - ahora con estabilización mejorada
    const smaValue = this.calculateStabilizedSMA(value);
    
    // MEJORA CRÍTICA: Amplificación ultra-potente para señales débiles
    let amplifiedValue = this.ultraAmplifySignal(smaValue);
    
    // Denoising con umbral adaptativo ultra-bajo
    const denoised = this.enhancedWaveletDenoise(amplifiedValue);
    
    // Aplicar Savitzky-Golay filtrado si hay suficientes puntos
    if (this.ppgValues.length >= this.SG_COEFFS.length) {
      // Filtrado SG mejorado con preservación extrema de picos
      const sgFiltered = this.applySavitzkyGolayFilter(denoised);
      
      // Análisis final con énfasis en picos y retroalimentación temporal
      const enhancedValue = this.enhanceCardiacSignalWithFeedback(sgFiltered);
      
      // Rastrear picos para análisis futuro
      this.trackPeak(enhancedValue);
      
      return enhancedValue;
    }
    
    // Seguir usando denoised si no hay suficientes puntos para SG
    // pero con amplificación adicional para garantizar detección
    const earlyEnhanced = denoised * 1.5;
    this.trackPeak(earlyEnhanced);
    
    return earlyEnhanced;
  }
  
  /**
   * NUEVO: Cálculo de SMA estabilizado con compensación de tendencias
   */
  private calculateStabilizedSMA(value: number): number {
    // Añadir al buffer de estabilización
    this.stabilizationBuffer.push(value);
    if (this.stabilizationBuffer.length > this.STAB_BUFFER_SIZE) {
      this.stabilizationBuffer.shift();
    }
    
    if (this.stabilizationBuffer.length < 3) return value;
    
    // Calcular SMA estándar
    const standardSMA = this.stabilizationBuffer.reduce((a, b) => a + b, 0) / this.stabilizationBuffer.length;
    
    // Detectar tendencia 
    const oldest = this.stabilizationBuffer[0];
    const newest = this.stabilizationBuffer[this.stabilizationBuffer.length - 1];
    const trend = newest - oldest;
    
    // Amplificar tendencias para mejorar detección
    return standardSMA + (trend * this.TREND_AMPLIFIER / this.STAB_BUFFER_SIZE);
  }
  
  /**
   * NUEVO: Detección mejorada de cambios significativos en la señal para adaptar filtros
   */
  private detectSignalChange(): boolean {
    if (this.ppgValues.length < 8) return false; // Reducido para detección más temprana
    
    const current = this.ppgValues.slice(-4); // Segmento más corto para respuesta más rápida
    const previous = this.ppgValues.slice(-8, -4);
    
    const currentAvg = current.reduce((a, b) => a + b, 0) / current.length;
    const prevAvg = previous.reduce((a, b) => a + b, 0) / previous.length;
    
    // Umbral de detección reducido para mayor sensibilidad
    return Math.abs(currentAvg - prevAvg) > 1.5; // Umbral más bajo (antes 3.0)
  }
  
  /**
   * NUEVO: Ultra-amplificación para señales extremadamente débiles
   */
  private ultraAmplifySignal(value: number): number {
    // Primera fase: amplificación adaptativa estándar
    let amplifiedValue = this.amplifyWeakSignals(value);
    
    // Segunda fase: amplificación extrema para señales que siguen siendo débiles
    if (this.ppgValues.length >= 10) {
      const recentValues = this.ppgValues.slice(-10);
      const recentRange = Math.max(...recentValues) - Math.min(...recentValues);
      
      // Si el rango sigue siendo muy pequeño después de la primera amplificación
      if (recentRange < 5) {
        const normalizedValue = amplifiedValue - this.baselineValue;
        
        // Amplificación exponencial para señales extremadamente débiles
        const sign = Math.sign(normalizedValue);
        const magnitude = Math.pow(Math.abs(normalizedValue), 0.6); // Exponente reducido para amplificación extrema
        
        // Factor de ultra-amplificación
        const ultraFactor = 5.0;
        
        return this.baselineValue + (sign * magnitude * ultraFactor);
      }
    }
    
    return amplifiedValue;
  }
  
  /**
   * MEJORADO: Amplificación adaptativa para señales débiles
   */
  private amplifyWeakSignals(value: number): number {
    // Determinar si la señal es débil analizando el historial reciente
    const recentValues = this.ppgValues.slice(-15);
    if (recentValues.length < 3) return value * this.MIN_SIGNAL_BOOST;
    
    // Actualizar máximos y mínimos con memoria histórica
    const currentMax = Math.max(...recentValues);
    const currentMin = Math.min(...recentValues);
    
    // Actualizar con memoria
    if (this.recentMax === 0) this.recentMax = currentMax;
    if (this.recentMin === 0) this.recentMin = currentMin;
    
    this.recentMax = this.recentMax * this.NORMALIZATION_FACTOR + 
                     currentMax * (1 - this.NORMALIZATION_FACTOR);
    this.recentMin = this.recentMin * this.NORMALIZATION_FACTOR + 
                     currentMin * (1 - this.NORMALIZATION_FACTOR);
    
    // Calcular rango de la señal
    const range = this.recentMax - this.recentMin;
    const normalizedValue = value - this.baselineValue;
    
    // AMPLIFICACIÓN EXTREMA para señales débiles
    if (range < 5.0) { // Umbral elevado para capturar más señales como "débiles"
      // Amplificación extrema para señales muy débiles
      const amplificationFactor = Math.max(this.MIN_SIGNAL_BOOST, 
                                          30.0 / (range + 0.1)); // Factor más agresivo
      
      // Amplificación no lineal para preservar forma de onda
      const sign = Math.sign(normalizedValue);
      // Compresión logarítmica más agresiva
      const magnitude = Math.pow(Math.abs(normalizedValue), 0.5); // Exponente reducido
      const amplified = sign * magnitude * amplificationFactor;
      
      return this.baselineValue + amplified;
    }
    
    // Para señales normales, aplicar amplificación moderada
    return this.baselineValue + normalizedValue * this.MIN_SIGNAL_BOOST;
  }
  
  /**
   * MEJORADO: Denoising wavelet extremadamente sensible y adaptativo
   * Incorpora principios de umbralización adaptativa y atenuación no lineal
   */
  private enhancedWaveletDenoise(value: number): number {
    const normalizedValue = value - this.baselineValue;
    
    // Cálculo de umbral dinámico mejorado: más sensible a las variaciones del ruido
    const dynamicThreshold = this.calculateDynamicThreshold() * 0.5; // Ajuste para mayor impacto del umbral dinámico
    
    // Aplicación del denoising con atenuación no lineal para preservar picos
    if (Math.abs(normalizedValue) < dynamicThreshold) {
      // Si el valor está por debajo del umbral, atenuar agresivamente (pero no a cero) para eliminar ruido menor
      const attenuationFactor = Math.pow(Math.abs(normalizedValue) / dynamicThreshold, 0.5); // Atenuación más marcada
      return this.baselineValue + (normalizedValue * attenuationFactor * 0.5); // Reducir aún más el ruido residual
    }
    
    // Para picos significativos, aplicar una supresión más suave y adaptativa
    const sign = normalizedValue >= 0 ? 1 : -1;
    // Reducción del ruido proporcional al umbral, manteniendo la forma del pico
    const denoisedValue = sign * (Math.abs(normalizedValue) - dynamicThreshold * 0.1); // Solo un 10% del umbral de supresión
    
    return this.baselineValue + denoisedValue;
  }
  
  /**
   * MEJORADO: Umbral dinámico ultra-sensible y más reactivo a la señal real
   */
  private calculateDynamicThreshold(): number {
    if (this.ppgValues.length < 10) return this.WAVELET_THRESHOLD; // Usar umbral base hasta tener suficientes datos
    
    const recentValues = this.ppgValues.slice(-20); // Ventana más grande para una estimación de ruido más estable
    const mean = recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
    const variance = recentValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentValues.length;
    const stdDev = Math.sqrt(variance);
    
    // Umbral base: una combinación de un valor fijo y la desviación estándar para adaptabilidad
    const baseThreshold = this.WAVELET_THRESHOLD * 0.5 + stdDev * 0.1; // Se combina umbral fijo con adaptabilidad a la stdDev
    
    // Estimación de ruido más inteligente: el umbral es el mínimo entre un máximo razonable 
    // y la desviación estándar multiplicada por un factor de sensibilidad al ruido.
    const noiseEstimate = Math.min(stdDev * 0.2, this.WAVELET_THRESHOLD * 2); // Ajuste a 0.2 y 2 para mejor balance
    
    // El umbral final se adapta al ruido, pero nunca es menor a un valor muy bajo para evitar la sobre-denoización
    return Math.max(this.WAVELET_THRESHOLD * 0.1, Math.min(noiseEstimate, baseThreshold)); // Umbral mínimo 0.1 para evitar filtrado excesivo
  }
  
  /**
   * MEJORADO: Filtrado Savitzky-Golay con preservación extrema de picos
   */
  private applySavitzkyGolayFilter(value: number): number {
    const recentValues = this.ppgValues.slice(-this.SG_COEFFS.length);
    let filteredValue = 0;
    
    // Aplicar convolución SG
    for (let i = 0; i < this.SG_COEFFS.length; i++) {
      filteredValue += recentValues[i] * this.SG_COEFFS[i];
    }
    
    const normalizedFiltered = filteredValue / this.SG_NORM;
    
    // Detección ultra-mejorada de picos cardíacos
    const midPoint = Math.floor(recentValues.length / 2);
    let isPotentialPeak = true;
    
    // Lógica de detección de picos más sensible
    for (let i = Math.max(0, midPoint - 2); i < Math.min(recentValues.length, midPoint + 2); i++) {
      if (i !== midPoint && recentValues[i] > recentValues[midPoint]) {
        isPotentialPeak = false;
        break;
      }
    }
    
    // Preservación extrema de picos cardíacos
    if (isPotentialPeak && recentValues[midPoint] > this.baselineValue) {
      // Dar mucho más peso al valor original para preservar amplitud completamente
      const peakPreservationFactor = 0.95; // Extremadamente alto (antes 0.9)
      return peakPreservationFactor * recentValues[midPoint] + 
             (1 - peakPreservationFactor) * normalizedFiltered;
    }
    
    return normalizedFiltered;
  }
  
  /**
   * NUEVO: Rastrear picos para análisis temporal
   */
  private trackPeak(value: number): void {
    this.peakHistory.push(value);
    if (this.peakHistory.length > this.PEAK_HISTORY_SIZE) {
      this.peakHistory.shift();
    }
  }

  /**
   * MEJORADO: Potenciación final de componentes cardíacos con feedback adaptativo
   * Utiliza una puntuación de patrón de pico más robusta para una amplificación precisa.
   */
  private enhanceCardiacSignalWithFeedback(value: number): number {
    if (this.ppgValues.length < 15 || this.peakHistory.length < 5) return value;

    const normalizedValue = value - this.baselineValue;

    // Análisis de patrones temporales en el historial de picos
    const peakPattern = this.detectPatternInPeaks();

    // Factor de amplificación base
    let enhancementFactor = this.PEAK_ENHANCEMENT;

    // Amplificación adaptativa basada en la fuerza del patrón de pico detectado
    // Un peakPattern más alto indica una señal cardíaca más clara, por lo tanto, se amplifica más.
    if (peakPattern > this.PEAK_SIMILARITY_THRESHOLD) {
      // Escalado no lineal: A mayor peakPattern, mayor amplificación
      enhancementFactor *= (1 + (peakPattern - this.PEAK_SIMILARITY_THRESHOLD) * 2); // Factor de amplificación más dinámico

      // Asegurar que el factor de amplificación no se dispare excesivamente
      enhancementFactor = Math.min(enhancementFactor, this.PEAK_ENHANCEMENT * 2.5); // Límite para evitar sobre-amplificación

      // Amplificar solo los componentes positivos (picos) de la señal normalizada
      if (normalizedValue > 0) {
        return this.baselineValue + normalizedValue * enhancementFactor;
      }
    }

    return value; // Si no hay un patrón cardíaco fuerte, no amplificar adicionalmente
  }
  
  /**
   * MEJORADO: Detectar patrones regulares en los picos históricos de forma más robusta
   * Retorna un valor entre 0 y 1 indicando la fuerza y regularidad del patrón
   * Incorpora consistencia de amplitud y patrón de alternancia.
   */
  private detectPatternInPeaks(): number {
    if (this.peakHistory.length < this.PEAK_HISTORY_SIZE) return 0;

    const values = this.peakHistory; // Estos son los valores (amplitudes) de los picos

    // 1. Consistencia de la amplitud: calcular la desviación estándar de los valores de los picos
    const meanValue = values.reduce((sum, val) => sum + val, 0) / values.length;
    const varianceValue = values.reduce((sum, val) => sum + Math.pow(val - meanValue, 2), 0) / values.length;
    const stdDevValue = Math.sqrt(varianceValue);

    // Mapear stdDevValue a una puntuación de consistencia (0 a 1).
    // Un stdDevValue más pequeño (más consistente) debe dar una puntuación más alta.
    // Usamos una función exponencial decreciente para este mapeo.
    const amplitudeConsistencyScore = Math.exp(-0.2 * stdDevValue); // El factor 0.2 ajusta la sensibilidad

    // 2. Patrón de alternancia de subida/bajada
    const deltas = [];
    for (let i = 1; i < values.length; i++) {
      deltas.push(values[i] - values[i-1]);
    }

    let alternatingPatternCount = 0;
    for (let i = 1; i < deltas.length; i++) {
      // Un patrón se detecta si la dirección de la señal cambia (de subida a bajada o viceversa)
      if ((deltas[i] > 0 && deltas[i-1] < 0) || (deltas[i] < 0 && deltas[i-1] > 0)) {
        alternatingPatternCount++;
      }
    }
    const alternatingPatternScore = alternatingPatternCount / (deltas.length - 1);

    // 3. Combinar las dos puntuaciones con una ponderación
    // Se da más peso al patrón de alternancia (0.7) y menos a la consistencia de amplitud (0.3).
    return (alternatingPatternScore * 0.7) + (amplitudeConsistencyScore * 0.3);
  }

  /**
   * Reset del procesador de señales
   */
  public reset(): void {
    this.ppgValues = [];
    this.baselineValue = 0;
    this.recentMax = 0;
    this.recentMin = 0;
    this.peakHistory = [];
    this.stabilizationBuffer = [];
  }

  /**
   * Obtener buffer de valores PPG
   */
  public getPPGValues(): number[] {
    return [...this.ppgValues];
  }
}
