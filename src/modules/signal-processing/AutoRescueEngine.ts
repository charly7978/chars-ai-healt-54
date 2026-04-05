/**
 * AUTO-RESCUE ENGINE — Motor de recuperación adaptativa de señal PPG
 *
 * Cuando la calidad de señal (SQI) cae por debajo de un umbral configurable,
 * el motor activa una secuencia escalonada de estrategias de rescate:
 *
 *   Nivel 0 (NORMAL)   — Sin intervención, ROI 85%, filtro estándar
 *   Nivel 1 (MILD)     — Reduce ROI a 70%, relaja umbrales de dedo
 *   Nivel 2 (MODERATE) — Reduce ROI a 55%, amplía banda de filtro, suavizado extra
 *   Nivel 3 (AGGRESSIVE)— ROI 40% centrado, banda muy amplia, AGC máximo
 *
 * La escalada es temporizada: si la calidad no mejora en N frames, sube de nivel.
 * La desescalada es conservadora: requiere calidad sostenida para volver a bajar.
 *
 * Referencia: Estrategias adaptativas de ROI en PPG (Elgendi 2014, De Haan 2013)
 */

export interface RescueState {
  level: RescueLevel;
  roiFraction: number;          // 0.0-1.0, fracción del frame para ROI
  bandpassLow: number;          // Hz, límite inferior del filtro
  bandpassHigh: number;         // Hz, límite superior del filtro
  smoothingAlpha: number;       // Alpha para suavizado RGB (mayor = más reactivo)
  fingerThresholdRelax: number; // Factor multiplicador de relajación de umbrales
  agcGain: number;              // Ganancia automática de contraste
  isRescueActive: boolean;
  framesInCurrentLevel: number;
  lastEscalation: number;       // timestamp
  consecutiveGoodFrames: number;
  rescueHistory: RescueEvent[];
}

export interface RescueEvent {
  timestamp: number;
  fromLevel: RescueLevel;
  toLevel: RescueLevel;
  triggerQuality: number;
}

export enum RescueLevel {
  NORMAL = 0,
  MILD = 1,
  MODERATE = 2,
  AGGRESSIVE = 3,
}

interface LevelConfig {
  roiFraction: number;
  bandpassLow: number;
  bandpassHigh: number;
  smoothingAlpha: number;
  fingerThresholdRelax: number;
  agcGain: number;
  escalateAfterFrames: number;  // Frames sin mejora para escalar
  deescalateAfterFrames: number; // Frames buenos para desescalar
}

const LEVEL_CONFIGS: Record<RescueLevel, LevelConfig> = {
  [RescueLevel.NORMAL]: {
    roiFraction: 0.85,
    bandpassLow: 0.5,
    bandpassHigh: 4.0,
    smoothingAlpha: 0.16,
    fingerThresholdRelax: 1.0,
    agcGain: 1.28,
    escalateAfterFrames: 22,
    deescalateAfterFrames: 999,
  },
  [RescueLevel.MILD]: {
    roiFraction: 0.70,
    bandpassLow: 0.5,
    bandpassHigh: 4.0,
    smoothingAlpha: 0.18,
    fingerThresholdRelax: 1.3,
    agcGain: 1.62,
    escalateAfterFrames: 30,
    deescalateAfterFrames: 100,
  },
  [RescueLevel.MODERATE]: {
    roiFraction: 0.55,
    bandpassLow: 0.4,
    bandpassHigh: 4.5,
    smoothingAlpha: 0.21,
    fingerThresholdRelax: 1.58,
    agcGain: 2.18,
    escalateAfterFrames: 44,
    deescalateAfterFrames: 130,
  },
  [RescueLevel.AGGRESSIVE]: {
    roiFraction: 0.40,
    bandpassLow: 0.35,
    bandpassHigh: 5.0,
    smoothingAlpha: 0.26,
    fingerThresholdRelax: 2.08,
    agcGain: 3.05,
    escalateAfterFrames: 999,
    deescalateAfterFrames: 160,
  },
};

const QUALITY_ESCALATE_THRESHOLD = 14;
const QUALITY_DEESCALATE_THRESHOLD = 52;
const MAX_RESCUE_HISTORY = 50;

export class AutoRescueEngine {
  private level: RescueLevel = RescueLevel.NORMAL;
  private framesInCurrentLevel: number = 0;
  private consecutiveBadFrames: number = 0;
  private consecutiveGoodFrames: number = 0;
  private lastEscalation: number = 0;
  private rescueHistory: RescueEvent[] = [];

  constructor(
    private escalateThreshold: number = QUALITY_ESCALATE_THRESHOLD,
    private deescalateThreshold: number = QUALITY_DEESCALATE_THRESHOLD,
  ) {}

  /**
   * Evaluar calidad y decidir si escalar/desescalar rescate.
   * Llamar una vez por frame con la calidad actual.
   */
  evaluate(signalQuality: number, fingerDetected: boolean): RescueState {
    this.framesInCurrentLevel++;
    const config = LEVEL_CONFIGS[this.level];

    // ─── ESCALADA ───
    if (!fingerDetected || signalQuality < this.escalateThreshold) {
      this.consecutiveBadFrames++;
      this.consecutiveGoodFrames = 0;

      if (
        this.consecutiveBadFrames >= config.escalateAfterFrames &&
        this.level < RescueLevel.AGGRESSIVE
      ) {
        this.escalate(signalQuality);
      }
    }
    // ─── DESESCALADA ───
    else if (signalQuality > this.deescalateThreshold) {
      this.consecutiveGoodFrames++;
      this.consecutiveBadFrames = 0;

      if (
        this.consecutiveGoodFrames >= config.deescalateAfterFrames &&
        this.level > RescueLevel.NORMAL
      ) {
        this.deescalate(signalQuality);
      }
    }
    // ─── ZONA INTERMEDIA ───
    else {
      // Decaimiento lento de contadores
      this.consecutiveBadFrames = Math.max(0, this.consecutiveBadFrames - 1);
      this.consecutiveGoodFrames = Math.max(0, this.consecutiveGoodFrames - 1);
    }

    return this.getState();
  }

  private escalate(triggerQuality: number): void {
    const from = this.level;
    this.level = Math.min(RescueLevel.AGGRESSIVE, this.level + 1) as RescueLevel;
    this.framesInCurrentLevel = 0;
    this.consecutiveBadFrames = 0;
    this.lastEscalation = Date.now();

    const event: RescueEvent = {
      timestamp: Date.now(),
      fromLevel: from,
      toLevel: this.level,
      triggerQuality,
    };
    this.rescueHistory.push(event);
    if (this.rescueHistory.length > MAX_RESCUE_HISTORY) {
      this.rescueHistory.shift();
    }

    console.log(`🚨 RESCUE: Escalando ${RescueLevel[from]} → ${RescueLevel[this.level]} (SQI=${triggerQuality.toFixed(0)})`);
  }

  private deescalate(triggerQuality: number): void {
    const from = this.level;
    this.level = Math.max(RescueLevel.NORMAL, this.level - 1) as RescueLevel;
    this.framesInCurrentLevel = 0;
    this.consecutiveGoodFrames = 0;

    const event: RescueEvent = {
      timestamp: Date.now(),
      fromLevel: from,
      toLevel: this.level,
      triggerQuality,
    };
    this.rescueHistory.push(event);
    if (this.rescueHistory.length > MAX_RESCUE_HISTORY) {
      this.rescueHistory.shift();
    }

    console.log(`✅ RESCUE: Desescalando ${RescueLevel[from]} → ${RescueLevel[this.level]} (SQI=${triggerQuality.toFixed(0)})`);
  }

  getState(): RescueState {
    const config = LEVEL_CONFIGS[this.level];
    return {
      level: this.level,
      roiFraction: config.roiFraction,
      bandpassLow: config.bandpassLow,
      bandpassHigh: config.bandpassHigh,
      smoothingAlpha: config.smoothingAlpha,
      fingerThresholdRelax: config.fingerThresholdRelax,
      agcGain: config.agcGain,
      isRescueActive: this.level > RescueLevel.NORMAL,
      framesInCurrentLevel: this.framesInCurrentLevel,
      lastEscalation: this.lastEscalation,
      consecutiveGoodFrames: this.consecutiveGoodFrames,
      rescueHistory: this.rescueHistory,
    };
  }

  getLevel(): RescueLevel {
    return this.level;
  }

  getLevelLabel(): string {
    return ['NORMAL', 'MILD', 'MODERATE', 'AGGRESSIVE'][this.level];
  }

  reset(): void {
    this.level = RescueLevel.NORMAL;
    this.framesInCurrentLevel = 0;
    this.consecutiveBadFrames = 0;
    this.consecutiveGoodFrames = 0;
    this.lastEscalation = 0;
    this.rescueHistory = [];
  }
}
