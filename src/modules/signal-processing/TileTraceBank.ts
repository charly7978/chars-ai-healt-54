/**
 * TILE TRACE BANK — Buffer de trazas por tile con pool de memoria
 *
 * Almacena trazas de señal por tile con:
 * - Pool de buffers reutilizables para minimizar allocations
 * - Cálculo de métricas de calidad por tile
 * - Extracción de señal ponderada de top tiles
 */

/**
 * TILE TRACE BANK - Banco de trazas por tile con absorbancia
 * 
 * Mantiene buffers temporales por tile para los mejores tiles de la máscara fina:
 * - R, G, B crudos
 * - R/DC, G/DC, B/DC normalizados
 * - Absorbancia A = -log((I + eps) / DC) por canal
 * - Señal detrended por tile
 * - SQI por tile
 * - Coherencia con frecuencia dominante
 * 
 * Reutiliza buffers para minimizar allocations en hot path.
 */

export interface TileTrace {
  tileId: string;
  x: number;
  y: number;
  weight: number;
  
  // Buffers temporales (reutilizables)
  rawR: Float64Array;
  rawG: Float64Array;
  rawB: Float64Array;
  timestamps: Float64Array;
  
  // Señales procesadas
  normR: Float64Array;  // R/DC
  normG: Float64Array;  // G/DC
  normB: Float64Array;  // B/DC
  absorbR: Float64Array;  // -log(R/DC)
  absorbG: Float64Array;  // -log(G/DC)
  absorbB: Float64Array;  // -log(B/DC)
  
  // Métricas de calidad
  sqi: number;
  coherence: number;
  amplitudeAC: number;
  amplitudeDC: number;
  clippingRatio: number;
  lastUpdate: number;
  
  // Estado
  active: boolean;
  bufferSize: number;
  writeIndex: number;
  count: number;
}

export interface TileTraceBankConfig {
  maxTiles: number;
  bufferSize: number;
  minSamplesForQuality: number;
  eps: number;
}

export class TileTraceBank {
  private traces: Map<string, TileTrace> = new Map();
  private config: TileTraceBankConfig;
  private bufferPool: Float64Array[] = []; // Pool de buffers reutilizables
  private activeTileIds: string[] = [];
  private lastCleanupTime: number = 0;
  
  constructor(config: Partial<TileTraceBankConfig> = {}) {
    this.config = {
      maxTiles: 16,
      bufferSize: 300,  // ~10 segundos a 30Hz
      minSamplesForQuality: 60,  // 2 segundos
      eps: 1e-6,
      ...config
    };
  }

  /**
   * Obtener o crear buffer del pool para minimizar allocations
   */
  private getBuffer(size: number): Float64Array {
    const buffer = this.bufferPool.find(b => b.length === size);
    if (buffer) {
      this.bufferPool.splice(this.bufferPool.indexOf(buffer), 1);
      return buffer;
    }
    return new Float64Array(size);
  }

  /**
   * Devolver buffer al pool
   */
  private returnBuffer(buffer: Float64Array): void {
    if (buffer.length === this.config.bufferSize) {
      this.bufferPool.push(buffer);
    }
  }

  /**
   * Crear nueva traza para tile
   */
  private createTileTrace(tileId: string, x: number, y: number, weight: number): TileTrace {
    const bufferSize = this.config.bufferSize;
    
    return {
      tileId,
      x,
      y,
      weight,
      
      // Buffers del pool
      rawR: this.getBuffer(bufferSize),
      rawG: this.getBuffer(bufferSize),
      rawB: this.getBuffer(bufferSize),
      timestamps: this.getBuffer(bufferSize),
      
      // Señales procesadas
      normR: this.getBuffer(bufferSize),
      normG: this.getBuffer(bufferSize),
      normB: this.getBuffer(bufferSize),
      absorbR: this.getBuffer(bufferSize),
      absorbG: this.getBuffer(bufferSize),
      absorbB: this.getBuffer(bufferSize),
      
      // Métricas
      sqi: 0,
      coherence: 0,
      amplitudeAC: 0,
      amplitudeDC: 0,
      clippingRatio: 0,
      lastUpdate: performance.now(),
      
      // Estado
      active: true,
      bufferSize,
      writeIndex: 0,
      count: 0
    };
  }

  /**
   * Actualizar traza de tile con nuevo frame
   */
  public updateTile(
    tileId: string, 
    x: number, 
    y: number, 
    weight: number,
    r: number, 
    g: number, 
    b: number, 
    timestamp: number
  ): void {
    let trace = this.traces.get(tileId);
    
    if (!trace) {
      // Crear nueva traza si no existe
      trace = this.createTileTrace(tileId, x, y, weight);
      this.traces.set(tileId, trace);
      this.activeTileIds.push(tileId);
    }
    
    // Actualizar posición y peso
    trace.x = x;
    trace.y = y;
    trace.weight = weight;
    trace.lastUpdate = timestamp;
    
    // Agregar muestra a buffers circulares
    const idx = trace.writeIndex;
    trace.rawR[idx] = r;
    trace.rawG[idx] = g;
    trace.rawB[idx] = b;
    trace.timestamps[idx] = timestamp;
    
    // Actualizar índices
    trace.writeIndex = (trace.writeIndex + 1) % trace.bufferSize;
    trace.count = Math.min(trace.count + 1, trace.bufferSize);
    
    // Procesar señales si hay suficientes muestras
    if (trace.count >= this.config.minSamplesForQuality) {
      this.processTileTrace(trace);
    }
  }

  /**
   * Procesar traza de tile: calcular normalización, absorbancia y métricas
   */
  private processTileTrace(trace: TileTrace): void {
    const count = trace.count;
    if (count < 10) return;
    
    // Calcular DC (promedio móvil robusto)
    let dcR = 0, dcG = 0, dcB = 0;
    let clipHigh = 0, clipLow = 0;
    
    for (let i = 0; i < count; i++) {
      dcR += trace.rawR[i];
      dcG += trace.rawG[i];
      dcB += trace.rawB[i];
      
      if (trace.rawR[i] > 0.97 || trace.rawG[i] > 0.97 || trace.rawB[i] > 0.97) clipHigh++;
      if (trace.rawR[i] < 0.02 && trace.rawG[i] < 0.02 && trace.rawB[i] < 0.02) clipLow++;
    }
    
    dcR /= count;
    dcG /= count;
    dcB /= count;
    trace.amplitudeDC = (dcR + dcG + dcB) / 3;
    trace.clippingRatio = (clipHigh + clipLow) / count;
    
    // Procesar señales normalizadas y absorbancia
    const eps = this.config.eps;
    let acR = 0, acG = 0, acB = 0;
    
    for (let i = 0; i < count; i++) {
      // Normalización AC/DC
      trace.normR[i] = dcR > eps ? trace.rawR[i] / dcR : 0;
      trace.normG[i] = dcG > eps ? trace.rawG[i] / dcG : 0;
      trace.normB[i] = dcB > eps ? trace.rawB[i] / dcB : 0;
      
      // Absorbancia: A = -log(I/DC)
      trace.absorbR[i] = trace.normR[i] > eps ? -Math.log(trace.normR[i]) : 0;
      trace.absorbG[i] = trace.normG[i] > eps ? -Math.log(trace.normG[i]) : 0;
      trace.absorbB[i] = trace.normB[i] > eps ? -Math.log(trace.normB[i]) : 0;
      
      // AC para amplitud
      acR += Math.abs(trace.normR[i] - 1);
      acG += Math.abs(trace.normG[i] - 1);
      acB += Math.abs(trace.normB[i] - 1);
    }
    
    trace.amplitudeAC = (acR + acG + acB) / (3 * count);
    
    // Calcular SQI (Signal Quality Index)
    trace.sqi = this.calculateSQI(trace);
    
    // Calcular coherencia espectral
    trace.coherence = this.calculateCoherence(trace);
  }

  /**
   * Calcular SQI para tile basado en características espectrales
   */
  private calculateSQI(trace: TileTrace): number {
    const count = trace.count;
    if (count < 20) return 0;
    
    // Usar señal verde absorbancia como referencia
    const signal = trace.absorbG;
    
    // Calcular PSD simple via FFT
    const psd = this.simplePSD(signal, count);
    if (!psd) return 0;
    
    // Encontrar pico en banda cardíaca (0.8-3 Hz)
    const cardiacBandStart = Math.floor(0.8 * count / 30);  // Asumiendo 30Hz
    const cardiacBandEnd = Math.floor(3.0 * count / 30);
    
    let maxPower = 0;
    let maxFreq = 0;
    let totalPower = 0;
    
    for (let i = 1; i < psd.length / 2; i++) {
      totalPower += psd[i];
      if (i >= cardiacBandStart && i <= cardiacBandEnd && psd[i] > maxPower) {
        maxPower = psd[i];
        maxFreq = i;
      }
    }
    
    if (totalPower === 0) return 0;
    
    // SQI basado en potencia en banda cardíaca
    const bandPower = psd.slice(cardiacBandStart, cardiacBandEnd + 1).reduce((sum, p) => sum + p, 0);
    const bandPowerRatio = bandPower / totalPower;
    
    // Factor de forma del pico
    const peakSharpness = maxPower / (bandPower / (cardiacBandEnd - cardiacBandStart + 1) + this.config.eps);
    
    return Math.min(1, bandPowerRatio * 0.7 + Math.min(1, peakSharpness / 3) * 0.3);
  }

  /**
   * Calcular coherencia con frecuencia dominante
   */
  private calculateCoherence(trace: TileTrace): number {
    const count = trace.count;
    if (count < 30) return 0;
    
    // Encontrar frecuencia dominante
    const signal = trace.absorbG;
    const psd = this.simplePSD(signal, count);
    if (!psd) return 0;
    
    // Encontrar pico dominante
    let maxPower = 0;
    let dominantFreq = 0;
    
    for (let i = 1; i < psd.length / 2; i++) {
      if (psd[i] > maxPower) {
        maxPower = psd[i];
        dominantFreq = i;
      }
    }
    
    if (maxPower === 0) return 0;
    
    // Calcular coherencia como correlación con sinusoidal en frecuencia dominante
    const omega = 2 * Math.PI * dominantFreq / count;
    let coherence = 0;
    
    for (let i = 0; i < count; i++) {
      const expected = Math.sin(omega * i);
      coherence += signal[i] * expected;
    }
    
    coherence = Math.abs(coherence) / (count * this.standardDeviation(signal) + this.config.eps);
    
    return Math.min(1, coherence);
  }

  /**
   * PSD simple via periodograma
   */
  private simplePSD(signal: Float64Array, n: number): Float64Array | null {
    if (n < 4) return null;
    
    const psd = new Float64Array(n);
    
    // Periodograma simple (magnitud al cuadrado de FFT)
    for (let k = 0; k < n; k++) {
      let real = 0, imag = 0;
      
      for (let i = 0; i < n; i++) {
        const angle = -2 * Math.PI * k * i / n;
        real += signal[i] * Math.cos(angle);
        imag += signal[i] * Math.sin(angle);
      }
      
      psd[k] = (real * real + imag * imag) / (n * n);
    }
    
    return psd;
  }

  /**
   * Desviación estándar
   */
  private standardDeviation(signal: Float64Array): number {
    const n = signal.length;
    if (n === 0) return 0;
    
    const mean = signal.reduce((sum, val) => sum + val, 0) / n;
    const variance = signal.reduce((sum, val) => sum + (val - mean) * (val - mean), 0) / n;
    
    return Math.sqrt(variance);
  }

  /**
   * Obtener top-K tiles por score combinado
   */
  public getTopTiles(k: number = 8): TileTrace[] {
    const tiles = Array.from(this.traces.values())
      .filter(trace => trace.active && trace.count >= this.config.minSamplesForQuality)
      .map(trace => ({
        ...trace,
        score: trace.sqi * 0.4 + trace.coherence * 0.3 + trace.amplitudeAC * 0.2 + trace.weight * 0.1
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    
    return tiles;
  }

  /**
   * Obtener señal promedio ponderada de top tiles
   */
  public getWeightedSignal(channel: 'R' | 'G' | 'B' | 'absorbR' | 'absorbG' | 'absorbB'): Float64Array | null {
    const topTiles = this.getTopTiles(Math.min(4, this.config.maxTiles));
    if (topTiles.length === 0) return null;
    
    const minLength = Math.min(...topTiles.map(t => t.count));
    if (minLength < 10) return null;
    
    const signal = new Float64Array(minLength);
    let totalWeight = 0;
    
    for (const tile of topTiles) {
      const weight = tile.weight * tile.sqi;
      totalWeight += weight;
      
      let source: Float64Array;
      switch (channel) {
        case 'R': source = tile.normR; break;
        case 'G': source = tile.normG; break;
        case 'B': source = tile.normB; break;
        case 'absorbR': source = tile.absorbR; break;
        case 'absorbG': source = tile.absorbG; break;
        case 'absorbB': source = tile.absorbB; break;
      }
      
      // Agregar señal ponderada (últimas N muestras)
      const startIdx = tile.writeIndex >= minLength ? tile.writeIndex - minLength : 0;
      for (let i = 0; i < minLength; i++) {
        const srcIdx = (startIdx + i) % tile.bufferSize;
        signal[i] += source[srcIdx] * weight;
      }
    }
    
    // Normalizar por peso total
    if (totalWeight > 0) {
      for (let i = 0; i < minLength; i++) {
        signal[i] /= totalWeight;
      }
    }
    
    return signal;
  }

  /**
   * Limpiar tiles inactivos o de baja calidad
   */
  public cleanup(): void {
    const now = performance.now();
    if (now - this.lastCleanupTime < 5000) return; // Limpiar cada 5 segundos como máximo
    
    this.lastCleanupTime = now;
    const tilesToRemove: string[] = [];
    
    for (const [tileId, trace] of this.traces) {
      const age = now - trace.lastUpdate;
      const shouldRemove = 
        age > 10000 || // Más de 10 segundos sin actualizaciones
        trace.sqi < 0.1 || // SQI muy bajo
        trace.clippingRatio > 0.3; // Demasiado clipping
      
      if (shouldRemove) {
        tilesToRemove.push(tileId);
      }
    }
    
    // Remover tiles y devolver buffers al pool
    for (const tileId of tilesToRemove) {
      const trace = this.traces.get(tileId);
      if (trace) {
        // Devolver buffers al pool
        this.returnBuffer(trace.rawR);
        this.returnBuffer(trace.rawG);
        this.returnBuffer(trace.rawB);
        this.returnBuffer(trace.timestamps);
        this.returnBuffer(trace.normR);
        this.returnBuffer(trace.normG);
        this.returnBuffer(trace.normB);
        this.returnBuffer(trace.absorbR);
        this.returnBuffer(trace.absorbG);
        this.returnBuffer(trace.absorbB);
        
        this.traces.delete(tileId);
        const idx = this.activeTileIds.indexOf(tileId);
        if (idx >= 0) {
          this.activeTileIds.splice(idx, 1);
        }
      }
    }
    
    // Limitar número total de tiles
    if (this.traces.size > this.config.maxTiles) {
      const sortedTiles = Array.from(this.traces.entries())
        .sort(([, a], [, b]) => b.sqi - a.sqi);
      
      const toRemove = sortedTiles.slice(this.config.maxTiles);
      for (const [tileId] of toRemove) {
        this.traces.delete(tileId);
        const idx = this.activeTileIds.indexOf(tileId);
        if (idx >= 0) {
          this.activeTileIds.splice(idx, 1);
        }
      }
    }
  }

  /**
   * Obtener métricas de debug
   */
  public getDebugMetrics(): any {
    const tiles = Array.from(this.traces.values());
    
    return {
      totalTiles: tiles.length,
      activeTiles: tiles.filter(t => t.active).length,
      avgSQI: tiles.reduce((sum, t) => sum + t.sqi, 0) / (tiles.length || 1),
      avgCoherence: tiles.reduce((sum, t) => sum + t.coherence, 0) / (tiles.length || 1),
      avgAmplitudeAC: tiles.reduce((sum, t) => sum + t.amplitudeAC, 0) / (tiles.length || 1),
      avgClippingRatio: tiles.reduce((sum, t) => sum + t.clippingRatio, 0) / (tiles.length || 1),
      bufferPoolSize: this.bufferPool.length,
      topTileIds: this.getTopTiles(3).map(t => t.tileId)
    };
  }

  /**
   * Resetear banco de trazas
   */
  public reset(): void {
    // Devolver todos los buffers al pool
    for (const trace of this.traces.values()) {
      this.returnBuffer(trace.rawR);
      this.returnBuffer(trace.rawG);
      this.returnBuffer(trace.rawB);
      this.returnBuffer(trace.timestamps);
      this.returnBuffer(trace.normR);
      this.returnBuffer(trace.normG);
      this.returnBuffer(trace.normB);
      this.returnBuffer(trace.absorbR);
      this.returnBuffer(trace.absorbG);
      this.returnBuffer(trace.absorbB);
    }
    
    this.traces.clear();
    this.activeTileIds = [];
    this.lastCleanupTime = 0;
  }
}
