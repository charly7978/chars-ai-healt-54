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

  /**
   * Marca retroactivamente como arritmia todos los puntos
   * desde hace `durationMs` milisegundos hasta el presente.
   * Esto permite colorear el latido completo (subida + pico).
   */
  markArrhythmiaBack(durationMs: number): void {
    const cutoff = Date.now() - durationMs;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].time < cutoff) break;
      this.buffer[i].isArrhythmia = true;
    }
  }

  clear(): void {
    this.buffer = [];
  }
}

export type { PPGDataPoint };
