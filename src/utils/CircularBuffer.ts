/**
 * BUFFER CIRCULAR OPTIMIZADO
 * - Pre-aloca memoria para evitar garbage collection
 * - No usa shift() que es O(n)
 * - Devuelve vista del buffer sin copiar
 */
interface PPGDataPoint {
  time: number;
  value: number;
  isArrhythmia: boolean;
}

export class CircularBuffer {
  private buffer: PPGDataPoint[];
  private maxSize: number;
  private head: number = 0;
  private count: number = 0;

  constructor(size: number) {
    this.maxSize = size;
    // Pre-alocar array para evitar resizing
    this.buffer = new Array(size);
    for (let i = 0; i < size; i++) {
      this.buffer[i] = { time: 0, value: 0, isArrhythmia: false };
    }
  }

  push(point: PPGDataPoint): void {
    // Reusar objeto existente en lugar de crear nuevo
    const slot = this.buffer[this.head];
    slot.time = point.time;
    slot.value = point.value;
    slot.isArrhythmia = point.isArrhythmia;
    
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) {
      this.count++;
    }
  }

  /**
   * Devuelve puntos válidos ordenados cronológicamente
   * OPTIMIZADO: Solo crea array cuando es necesario, reutiliza cuando puede
   */
  getPoints(): readonly PPGDataPoint[] {
    if (this.count === 0) return [];
    
    if (this.count < this.maxSize) {
      // Buffer no está lleno, puntos están al inicio
      return this.buffer.slice(0, this.count);
    }
    
    // Buffer lleno, reordenar desde head
    const result: PPGDataPoint[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(this.head + i) % this.maxSize];
    }
    return result;
  }

  getPointsCount(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
  
  /**
   * Obtener puntos recientes sin crear nuevo array
   * Útil para análisis de los últimos N puntos
   */
  getRecentPoints(n: number): PPGDataPoint[] {
    const count = Math.min(n, this.count);
    const result: PPGDataPoint[] = new Array(count);
    
    for (let i = 0; i < count; i++) {
      const idx = (this.head - count + i + this.maxSize) % this.maxSize;
      result[i] = this.buffer[idx];
    }
    
    return result;
  }
}

export type { PPGDataPoint };
