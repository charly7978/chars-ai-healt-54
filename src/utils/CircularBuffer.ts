import type { BeatWaveClass } from './beatVisualization';

interface PPGDataPoint {
  time: number;
  value: number;
  /** Segmentación del trazo: normal / débil (ámbar) / arritmia (rojo). */
  waveClass: BeatWaveClass;
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
   * Colorea retroactivamente el trazo desde hace `durationMs` hasta ahora.
   * La arritmia no se sobrescribe con “weak”; “weak” no pisa “arrhythmia”.
   */
  markWaveClassBack(durationMs: number, waveClass: 'weak' | 'arrhythmia'): void {
    const cutoff = Date.now() - durationMs;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].time < cutoff) break;
      if (waveClass === 'arrhythmia') {
        this.buffer[i].waveClass = 'arrhythmia';
      } else if (this.buffer[i].waveClass !== 'arrhythmia') {
        this.buffer[i].waveClass = 'weak';
      }
    }
  }

  clear(): void {
    this.buffer = [];
  }
}

export type { PPGDataPoint };
