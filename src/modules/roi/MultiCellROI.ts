/**
 * MULTI-CELL ROI WITH BACKGROUND CONTROL
 * 
 * Implementa múltiples celdas ROI (Region of Interest) con control de fondo.
 * Objetivo: Asegurar que la señal PPG proviene de tejido vivo y no de fuentes externas.
 * 
 * FAIL-CLOSED: Si no hay correlación positiva entre celdas o si el fondo correlaciona,
 * rechaza la medición.
 */

export interface ROICell {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  signal: number[];
  quality: number;
  active: boolean;
}

export interface BackgroundROI {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  signal: number[];
}

export interface MultiCellROIResult {
  valid: boolean;
  cellCorrelation: number; // Correlación promedio entre celdas
  backgroundCorrelation: number; // Correlación con fondo
  signalQuality: number; // Calidad promedio de celdas
  activeCells: number;
  rejectionReasons: string[];
}

export class MultiCellROI {
  private cells: ROICell[] = [];
  private backgroundROIs: BackgroundROI[] = [];
  private readonly MIN_CELLS = 3;
  private readonly MIN_CELL_CORRELATION = 0.7;
  private readonly MAX_BACKGROUND_CORRELATION = 0.3;
  private readonly MIN_SIGNAL_QUALITY = 0.5;
  private readonly SIGNAL_BUFFER_SIZE = 60; // 2 segundos a 30fps

  constructor(cellCount: number = 5) {
    this.initializeCells(cellCount);
  }

  /**
   * Inicializar celdas ROI en patrón de cuadrícula
   */
  private initializeCells(count: number): void {
    this.cells = [];
    for (let i = 0; i < count; i++) {
      this.cells.push({
        id: `cell_${i}`,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        signal: [],
        quality: 0,
        active: true
      });
    }
  }

  /**
   * Configurar posiciones de celdas ROI
   */
  configureCells(
    frameWidth: number,
    frameHeight: number,
    centerX: number,
    centerY: number,
    radius: number
  ): void {
    const angleStep = (2 * Math.PI) / this.cells.length;

    this.cells.forEach((cell, index) => {
      const angle = index * angleStep;
      cell.x = Math.round(centerX + radius * Math.cos(angle) - radius / 2);
      cell.y = Math.round(centerY + radius * Math.sin(angle) - radius / 2);
      cell.width = Math.round(radius);
      cell.height = Math.round(radius);
    });
  }

  /**
   * Configurar ROI de fondo
   */
  configureBackgroundROIs(
    frameWidth: number,
    frameHeight: number,
    count: number = 4
  ): void {
    this.backgroundROIs = [];
    const margin = 20;

    // Crear ROIs en las esquinas del frame
    const positions = [
      { x: margin, y: margin },
      { x: frameWidth - margin - 50, y: margin },
      { x: margin, y: frameHeight - margin - 50 },
      { x: frameWidth - margin - 50, y: frameHeight - margin - 50 }
    ];

    for (let i = 0; i < Math.min(count, positions.length); i++) {
      this.backgroundROIs.push({
        id: `bg_${i}`,
        x: positions[i].x,
        y: positions[i].y,
        width: 50,
        height: 50,
        signal: []
      });
    }
  }

  /**
   * Extraer señal de una ROI específica
   */
  private extractROISignal(
    imageData: Uint8ClampedArray,
    frameWidth: number,
    roi: { x: number; y: number; width: number; height: number }
  ): number {
    let sum = 0;
    let count = 0;

    for (let y = roi.y; y < roi.y + roi.height; y++) {
      for (let x = roi.x; x < roi.x + roi.width; x++) {
        if (x >= 0 && x < frameWidth && y >= 0 && y < (imageData.length / 4 / frameWidth)) {
          const index = (y * frameWidth + x) * 4;
          // Usar canal verde (mejor para PPG)
          sum += imageData[index + 1];
          count++;
        }
      }
    }

    return count > 0 ? sum / count : 0;
  }

  /**
   * Procesar frame y actualizar señales
   */
  processFrame(
    imageData: Uint8ClampedArray,
    frameWidth: number,
    frameHeight: number
  ): MultiCellROIResult {
    const rejectionReasons: string[] = [];

    // Actualizar señales de celdas
    this.cells.forEach(cell => {
      if (cell.active) {
        const signal = this.extractROISignal(imageData, frameWidth, cell);
        cell.signal.push(signal);

        // Mantener buffer de tamaño fijo
        if (cell.signal.length > this.SIGNAL_BUFFER_SIZE) {
          cell.signal.shift();
        }

        // Calcular calidad de señal
        cell.quality = this.calculateSignalQuality(cell.signal);
      }
    });

    // Actualizar señales de fondo
    this.backgroundROIs.forEach(bg => {
      const signal = this.extractROISignal(imageData, frameWidth, bg);
      bg.signal.push(signal);

      if (bg.signal.length > this.SIGNAL_BUFFER_SIZE) {
        bg.signal.shift();
      }
    });

    // Calcular correlación entre celdas
    const cellCorrelation = this.calculateCellCorrelation();
    const activeCells = this.cells.filter(c => c.active && c.quality >= this.MIN_SIGNAL_QUALITY).length;

    // FAIL-CLOSED: Insuficientes celdas activas
    if (activeCells < this.MIN_CELLS) {
      rejectionReasons.push(
        `INSUFFICIENT_ACTIVE_CELLS: ${activeCells}/${this.MIN_CELLS} required`
      );
    }

    // FAIL-CLOSED: Correlación entre celdas insuficiente
    if (cellCorrelation < this.MIN_CELL_CORRELATION) {
      rejectionReasons.push(
        `LOW_CELL_CORRELATION: ${cellCorrelation.toFixed(3)} < ${this.MIN_CELL_CORRELATION}`
      );
    }

    // Calcular correlación con fondo
    const backgroundCorrelation = this.calculateBackgroundCorrelation();

    // FAIL-CLOSED: Fondo correlaciona demasiado (posible ruido externo)
    if (backgroundCorrelation > this.MAX_BACKGROUND_CORRELATION) {
      rejectionReasons.push(
        `HIGH_BACKGROUND_CORRELATION: ${backgroundCorrelation.toFixed(3)} > ${this.MAX_BACKGROUND_CORRELATION}`
      );
    }

    // Calcular calidad promedio
    const signalQuality = this.calculateAverageQuality();

    // FAIL-CLOSED: Calidad de señal insuficiente
    if (signalQuality < this.MIN_SIGNAL_QUALITY) {
      rejectionReasons.push(
        `LOW_SIGNAL_QUALITY: ${signalQuality.toFixed(3)} < ${this.MIN_SIGNAL_QUALITY}`
      );
    }

    const valid = rejectionReasons.length === 0;

    return {
      valid,
      cellCorrelation,
      backgroundCorrelation,
      signalQuality,
      activeCells,
      rejectionReasons
    };
  }

  /**
   * Calcular correlación promedio entre celdas activas
   */
  private calculateCellCorrelation(): number {
    const activeCells = this.cells.filter(c => c.active && c.signal.length >= 30);
    if (activeCells.length < 2) return 0;

    let totalCorrelation = 0;
    let pairCount = 0;

    for (let i = 0; i < activeCells.length; i++) {
      for (let j = i + 1; j < activeCells.length; j++) {
        const correlation = this.calculatePearsonCorrelation(
          activeCells[i].signal,
          activeCells[j].signal
        );
        totalCorrelation += correlation;
        pairCount++;
      }
    }

    return pairCount > 0 ? totalCorrelation / pairCount : 0;
  }

  /**
   * Calcular correlación promedio con fondo
   */
  private calculateBackgroundCorrelation(): number {
    const activeCells = this.cells.filter(c => c.active && c.signal.length >= 30);
    if (activeCells.length === 0 || this.backgroundROIs.length === 0) return 0;

    let totalCorrelation = 0;
    let pairCount = 0;

    activeCells.forEach(cell => {
      this.backgroundROIs.forEach(bg => {
        if (bg.signal.length >= 30) {
          const correlation = this.calculatePearsonCorrelation(cell.signal, bg.signal);
          totalCorrelation += correlation;
          pairCount++;
        }
      });
    });

    return pairCount > 0 ? totalCorrelation / pairCount : 0;
  }

  /**
   * Calcular correlación de Pearson entre dos arrays
   */
  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;

    const meanX = x.slice(0, n).reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.slice(0, n).reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let denominatorX = 0;
    let denominatorY = 0;

    for (let i = 0; i < n; i++) {
      const diffX = x[i] - meanX;
      const diffY = y[i] - meanY;
      numerator += diffX * diffY;
      denominatorX += diffX * diffX;
      denominatorY += diffY * diffY;
    }

    const denominator = Math.sqrt(denominatorX * denominatorY);
    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /**
   * Calcular calidad de señal (basada en variación y rango)
   */
  private calculateSignalQuality(signal: number[]): number {
    if (signal.length < 10) return 0;

    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    const stdDev = Math.sqrt(variance);

    // Calidad basada en coeficiente de variación
    const cv = stdDev / mean;

    // CV óptimo para PPG: 0.01 - 0.05
    if (cv < 0.005) return 0; // Señal plana
    if (cv > 0.1) return 0; // Ruido excesivo

    // Normalizar a 0-1
    return Math.min(1, cv / 0.05);
  }

  /**
   * Calcular calidad promedio de celdas activas
   */
  private calculateAverageQuality(): number {
    const activeCells = this.cells.filter(c => c.active);
    if (activeCells.length === 0) return 0;

    return activeCells.reduce((sum, cell) => sum + cell.quality, 0) / activeCells.length;
  }

  /**
   * Obtener señal promedio de celdas activas
   */
  getAverageSignal(): number[] {
    const activeCells = this.cells.filter(c => c.active && c.signal.length > 0);
    if (activeCells.length === 0) return [];

    const maxLength = Math.max(...activeCells.map(c => c.signal.length));
    const averageSignal: number[] = [];

    for (let i = 0; i < maxLength; i++) {
      let sum = 0;
      let count = 0;

      activeCells.forEach(cell => {
        if (i < cell.signal.length) {
          sum += cell.signal[i];
          count++;
        }
      });

      averageSignal.push(count > 0 ? sum / count : 0);
    }

    return averageSignal;
  }

  /**
   * Desactivar celda específica
   */
  deactivateCell(cellId: string): void {
    const cell = this.cells.find(c => c.id === cellId);
    if (cell) {
      cell.active = false;
    }
  }

  /**
   * Activar celda específica
   */
  activateCell(cellId: string): void {
    const cell = this.cells.find(c => c.id === cellId);
    if (cell) {
      cell.active = true;
    }
  }

  /**
   * Obtener información de celdas
   */
  getCellsInfo(): ROICell[] {
    return this.cells.map(cell => ({
      ...cell,
      signal: [] // No exponer la señal completa
    }));
  }
}

export default MultiCellROI;
