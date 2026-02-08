/**
 * ANALIZADOR DE POINCARÉ - DETECCIÓN AVANZADA DE ARRITMIAS
 * 
 * Basado en literatura científica:
 * - IOP Science 2024: PPG para detección de Fibrilación Auricular
 * - JACC Clinical Electrophysiology 2024: DNN vs Signal Processing
 * - PMC 2020: pNN50, RMSSD, Poincare plot para AF
 * 
 * El diagrama de Poincaré grafica RR(n+1) vs RR(n)
 * - SD1 = variabilidad a corto plazo (actividad parasimpática)
 * - SD2 = variabilidad a largo plazo (actividad simpática + parasimpática)
 * - SD1/SD2 ratio = balance autonómico
 * 
 * CRITERIOS DE ARRITMIA:
 * - Fibrilación Auricular: SD1 > 40ms y SD1/SD2 > 0.6
 * - Extrasístoles: puntos alejados de la diagonal
 * - Bradicardia: cluster en zona superior derecha
 * - Taquicardia: cluster en zona inferior izquierda
 */

export interface PoincareResult {
  /** SD1: variabilidad a corto plazo (ms) */
  sd1: number;
  
  /** SD2: variabilidad a largo plazo (ms) */
  sd2: number;
  
  /** Ratio SD1/SD2 */
  ratio: number;
  
  /** Área de la elipse (ms²) */
  ellipseArea: number;
  
  /** Puntos del plot [x, y] */
  points: Array<{ x: number; y: number }>;
  
  /** Análisis de arritmia */
  arrhythmiaAnalysis: {
    /** Riesgo de fibrilación auricular */
    afRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    
    /** Extrasístoles detectadas */
    ectopicBeats: number;
    
    /** Patrón detectado */
    pattern: 'NORMAL' | 'AF_LIKE' | 'ECTOPIC' | 'BIGEMINY' | 'TRIGEMINY' | 'IRREGULAR';
    
    /** Descripción */
    description: string;
  };
}

export class PoincareAnalyzer {
  private readonly MIN_INTERVALS = 10;
  private readonly AF_SD1_THRESHOLD = 40; // ms
  private readonly AF_RATIO_THRESHOLD = 0.6;
  
  constructor() {
    console.log('✅ PoincareAnalyzer inicializado');
  }
  
  /**
   * ANÁLISIS COMPLETO DE POINCARÉ
   */
  analyze(rrIntervals: number[]): PoincareResult {
    // Validar entrada
    if (rrIntervals.length < this.MIN_INTERVALS) {
      return this.emptyResult();
    }
    
    // Filtrar intervalos técnicamente válidos
    const validIntervals = rrIntervals.filter(rr => rr >= 200 && rr <= 3000);
    
    if (validIntervals.length < this.MIN_INTERVALS) {
      return this.emptyResult();
    }
    
    // Construir puntos del diagrama de Poincaré
    const points = this.buildPoints(validIntervals);
    
    // Calcular SD1 y SD2
    const { sd1, sd2 } = this.calculateSD(points);
    
    // Calcular ratio
    const ratio = sd2 > 0 ? sd1 / sd2 : 0;
    
    // Área de la elipse: π * SD1 * SD2
    const ellipseArea = Math.PI * sd1 * sd2;
    
    // Análisis de arritmia
    const arrhythmiaAnalysis = this.analyzeArrhythmia(sd1, sd2, ratio, points, validIntervals);
    
    return {
      sd1,
      sd2,
      ratio,
      ellipseArea,
      points,
      arrhythmiaAnalysis
    };
  }
  
  /**
   * CONSTRUIR PUNTOS DEL DIAGRAMA
   * Cada punto es (RR[n], RR[n+1])
   */
  private buildPoints(intervals: number[]): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    
    for (let i = 0; i < intervals.length - 1; i++) {
      points.push({
        x: intervals[i],
        y: intervals[i + 1]
      });
    }
    
    return points;
  }
  
  /**
   * CALCULAR SD1 Y SD2
   * 
   * SD1 = sqrt(0.5 * Var(RR[n+1] - RR[n]))
   * SD2 = sqrt(2*SDNN² - 0.5*SD1²)
   * 
   * Alternativamente:
   * SD1 = std de distancias a la diagonal (perpendicular)
   * SD2 = std de distancias a lo largo de la diagonal
   */
  private calculateSD(points: Array<{ x: number; y: number }>): { sd1: number; sd2: number } {
    if (points.length < 5) {
      return { sd1: 0, sd2: 0 };
    }
    
    // Método 1: Diferencias sucesivas
    const diffs: number[] = [];
    const sums: number[] = [];
    
    for (const point of points) {
      diffs.push(point.y - point.x);
      sums.push(point.y + point.x);
    }
    
    // SD1: variabilidad de diferencias / sqrt(2)
    const diffMean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const diffVariance = diffs.reduce((acc, d) => acc + Math.pow(d - diffMean, 2), 0) / diffs.length;
    const sd1 = Math.sqrt(diffVariance / 2);
    
    // SD2: variabilidad de sumas / sqrt(2)
    const sumMean = sums.reduce((a, b) => a + b, 0) / sums.length;
    const sumVariance = sums.reduce((acc, s) => acc + Math.pow(s - sumMean, 2), 0) / sums.length;
    const sd2 = Math.sqrt(sumVariance / 2);
    
    return { sd1, sd2 };
  }
  
  /**
   * ANÁLISIS DE ARRITMIA BASADO EN POINCARÉ
   */
  private analyzeArrhythmia(
    sd1: number,
    sd2: number,
    ratio: number,
    points: Array<{ x: number; y: number }>,
    intervals: number[]
  ): PoincareResult['arrhythmiaAnalysis'] {
    
    // === RIESGO DE FIBRILACIÓN AURICULAR ===
    let afRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    
    if (sd1 > this.AF_SD1_THRESHOLD && ratio > this.AF_RATIO_THRESHOLD) {
      afRisk = 'HIGH';
    } else if (sd1 > 30 || ratio > 0.5) {
      afRisk = 'MEDIUM';
    }
    
    // === DETECCIÓN DE EXTRASÍSTOLES ===
    const ectopicBeats = this.detectEctopicBeats(points, intervals);
    
    // === DETECCIÓN DE PATRÓN ===
    const pattern = this.detectPattern(points, intervals, sd1, ratio, ectopicBeats);
    
    // === GENERAR DESCRIPCIÓN ===
    const description = this.generateDescription(afRisk, ectopicBeats, pattern, sd1, sd2, ratio);
    
    return {
      afRisk,
      ectopicBeats,
      pattern,
      description
    };
  }
  
  /**
   * DETECTAR LATIDOS ECTÓPICOS
   * Puntos muy alejados de la diagonal principal
   */
  private detectEctopicBeats(
    points: Array<{ x: number; y: number }>,
    intervals: number[]
  ): number {
    if (intervals.length < 5) return 0;
    
    const meanRR = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const threshold = meanRR * 0.25; // 25% de desviación
    
    let ectopicCount = 0;
    
    for (const point of points) {
      // Distancia a la diagonal (y = x)
      const distanceToDiagonal = Math.abs(point.y - point.x) / Math.sqrt(2);
      
      if (distanceToDiagonal > threshold) {
        ectopicCount++;
      }
    }
    
    return ectopicCount;
  }
  
  /**
   * DETECTAR PATRÓN DE ARRITMIA
   */
  private detectPattern(
    points: Array<{ x: number; y: number }>,
    intervals: number[],
    sd1: number,
    ratio: number,
    ectopics: number
  ): PoincareResult['arrhythmiaAnalysis']['pattern'] {
    
    // Alta variabilidad + ratio alto = patrón tipo FA
    if (sd1 > this.AF_SD1_THRESHOLD && ratio > this.AF_RATIO_THRESHOLD) {
      return 'AF_LIKE';
    }
    
    // Muchos ectópicos
    if (ectopics > points.length * 0.2) {
      return 'ECTOPIC';
    }
    
    // Detectar bigeminia (patrón alternante)
    if (this.detectBigeminy(intervals)) {
      return 'BIGEMINY';
    }
    
    // Detectar trigeminia (patrón cada 3)
    if (this.detectTrigeminy(intervals)) {
      return 'TRIGEMINY';
    }
    
    // Irregular pero sin patrón específico
    if (sd1 > 25 || ratio > 0.4) {
      return 'IRREGULAR';
    }
    
    return 'NORMAL';
  }
  
  /**
   * DETECTAR BIGEMINIA
   * Patrón: largo-corto-largo-corto
   */
  private detectBigeminy(intervals: number[]): boolean {
    if (intervals.length < 6) return false;
    
    let bigeminyCount = 0;
    
    for (let i = 0; i < intervals.length - 3; i++) {
      const diff1 = Math.abs(intervals[i] - intervals[i + 2]);
      const diff2 = Math.abs(intervals[i + 1] - intervals[i + 3]);
      const crossDiff = Math.abs(intervals[i] - intervals[i + 1]);
      
      const mean = (intervals[i] + intervals[i + 1]) / 2;
      
      // Si alternan de manera consistente
      if (diff1 < mean * 0.1 && diff2 < mean * 0.1 && crossDiff > mean * 0.15) {
        bigeminyCount++;
      }
    }
    
    return bigeminyCount >= 2;
  }
  
  /**
   * DETECTAR TRIGEMINIA
   * Patrón: normal-normal-ectópico repetido
   */
  private detectTrigeminy(intervals: number[]): boolean {
    if (intervals.length < 9) return false;
    
    let trigeminyCount = 0;
    
    for (let i = 0; i < intervals.length - 6; i += 3) {
      const group1 = [intervals[i], intervals[i + 1], intervals[i + 2]];
      const group2 = [intervals[i + 3], intervals[i + 4], intervals[i + 5]];
      
      // Verificar si los grupos son similares
      const g1Mean = group1.reduce((a, b) => a + b, 0) / 3;
      const g2Mean = group2.reduce((a, b) => a + b, 0) / 3;
      
      if (Math.abs(g1Mean - g2Mean) < g1Mean * 0.15) {
        // Verificar patrón dentro del grupo
        const diff01 = Math.abs(group1[0] - group1[1]);
        const diff12 = Math.abs(group1[1] - group1[2]);
        
        if (diff01 < g1Mean * 0.1 && diff12 > g1Mean * 0.15) {
          trigeminyCount++;
        }
      }
    }
    
    return trigeminyCount >= 2;
  }
  
  /**
   * GENERAR DESCRIPCIÓN TEXTUAL
   */
  private generateDescription(
    afRisk: 'LOW' | 'MEDIUM' | 'HIGH',
    ectopics: number,
    pattern: string,
    sd1: number,
    sd2: number,
    ratio: number
  ): string {
    const parts: string[] = [];
    
    // Patrón detectado
    const patternNames: Record<string, string> = {
      'NORMAL': 'Ritmo sinusal normal',
      'AF_LIKE': 'Patrón compatible con fibrilación auricular',
      'ECTOPIC': 'Múltiples latidos ectópicos',
      'BIGEMINY': 'Patrón de bigeminia ventricular',
      'TRIGEMINY': 'Patrón de trigeminia',
      'IRREGULAR': 'Ritmo irregular inespecífico'
    };
    parts.push(patternNames[pattern] || 'Ritmo indeterminado');
    
    // Estadísticas
    parts.push(`SD1=${sd1.toFixed(1)}ms SD2=${sd2.toFixed(1)}ms`);
    
    // Riesgo AF
    if (afRisk !== 'LOW') {
      parts.push(`Riesgo FA: ${afRisk}`);
    }
    
    // Ectópicos
    if (ectopics > 0) {
      parts.push(`${ectopics} latido(s) ectópico(s)`);
    }
    
    return parts.join(' | ');
  }
  
  /**
   * RESULTADO VACÍO
   */
  private emptyResult(): PoincareResult {
    return {
      sd1: 0,
      sd2: 0,
      ratio: 0,
      ellipseArea: 0,
      points: [],
      arrhythmiaAnalysis: {
        afRisk: 'LOW',
        ectopicBeats: 0,
        pattern: 'NORMAL',
        description: 'Datos insuficientes'
      }
    };
  }
}
