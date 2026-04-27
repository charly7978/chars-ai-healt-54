interface PPGDataPoint {
  time: number;
  value: number;
  isArrhythmia: boolean;
}

/**
 * CircularBuffer real de tamaño fijo. Operaciones O(1) en push y O(N) solo
 * cuando se materializa la vista lineal. Evita el O(N) por frame de Array.shift().
 */
export class CircularBuffer {
  private readonly slots: PPGDataPoint[];
  private head = 0; // Próxima posición a escribir
  private size = 0;
  private readonly maxSize: number;
  private viewCache: PPGDataPoint[] | null = null;

  constructor(size: number) {
    this.maxSize = size;
    this.slots = new Array(size);
  }

  push(point: PPGDataPoint): void {
    this.slots[this.head] = point;
    this.head = (this.head + 1) % this.maxSize;
    if (this.size < this.maxSize) this.size++;
    this.viewCache = null;
  }

  /**
   * Devuelve los puntos en orden cronológico ascendente.
   * Memoiza la materialización por frame; se invalida en cada push/clear.
   */
  getPoints(): readonly PPGDataPoint[] {
    if (this.viewCache) return this.viewCache;
    const out: PPGDataPoint[] = new Array(this.size);
    if (this.size < this.maxSize) {
      // Aún no se ha llenado; los datos están en [0, head).
      for (let i = 0; i < this.size; i++) out[i] = this.slots[i];
    } else {
      // Buffer lleno; el más antiguo es head, el más nuevo head-1.
      const start = this.head;
      for (let i = 0; i < this.size; i++) {
        out[i] = this.slots[(start + i) % this.maxSize];
      }
    }
    this.viewCache = out;
    return out;
  }

  getPointsCount(): number {
    return this.size;
  }

  /**
   * Marca retroactivamente como arritmia todos los puntos
   * desde hace `durationMs` milisegundos hasta el presente.
   */
  markArrhythmiaBack(durationMs: number): void {
    const cutoff = Date.now() - durationMs;
    // Recorrer desde el último escrito hacia atrás.
    let count = this.size;
    let idx = (this.head - 1 + this.maxSize) % this.maxSize;
    while (count-- > 0) {
      const p = this.slots[idx];
      if (!p) break;
      if (p.time < cutoff) break;
      p.isArrhythmia = true;
      idx = (idx - 1 + this.maxSize) % this.maxSize;
    }
    this.viewCache = null;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
    this.viewCache = null;
  }
}

export type { PPGDataPoint };
