interface PPGDataPoint {
  time: number;
  value: number;
  isArrhythmia: boolean;
}

export class CircularBuffer {
  private buffer: PPGDataPoint[];
  private maxSize: number;

  constructor(size: number) {
    this.buffer = [];
    this.maxSize = size;
  }

  push(point: PPGDataPoint): void {
    this.buffer.push(point);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * OPTIMIZADO: Devuelve referencia directa al buffer interno
   * IMPORTANTE: NO modificar el array devuelto - es de solo lectura
   * Esto evita crear ~60 copias/segundo del array
   */
  getPoints(): readonly PPGDataPoint[] {
    return this.buffer;
  }

  /**
   * Devuelve el número de puntos sin crear copia del array
   */
  getPointsCount(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }
}

export type { PPGDataPoint };
