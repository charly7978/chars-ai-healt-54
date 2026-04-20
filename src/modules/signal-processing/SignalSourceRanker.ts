/**
 * SIGNAL SOURCE RANKER V3 - ADVANCED ENSEMBLE
 * 
 * Ensemble serio de ranking de fuentes con:
 * - Integración con BeerLambertExtractor para candidatos avanzados
 * - Métricas completas por candidato: amplitud, AC/DC, energía espectral, periodicidad, estabilidad
 * - Coherencia inter-tile y penalizaciones por clipping, drift, motion
 * - Switching inteligente con histéresis mejorada
 * - Exposición de telemetría: allSQI, bestCandidate, runnerUp, reasonForSwitch
 * 
 * Reemplaza el sistema simple de 6 señales por un ensemble robusto.
 */

import type { SignalCandidate } from './BeerLambertExtractor';

export interface RankedCandidate {
  id: string;
  name: string;
  score: number;
  
  // Métricas de calidad
  amplitude: number;
  acdcRatio: number;
  signalToNoise: number;
  spectralPower: number;
  bandPowerRatio: number;
  periodicity: number;
  temporalStability: number;
  
  // Penalizaciones
  clippingPenalty: number;
  driftPenalty: number;
  motionPenalty: number;
  
  // Metadatos
  sourceType: string;
  lastUpdate: number;
}

export interface RankingResult {
  bestCandidate: RankedCandidate;
  runnerUp: RankedCandidate | null;
  allCandidates: RankedCandidate[];
  allSQI: Record<string, number>;
  reasonForSwitch: string;
  switchOccurred: boolean;
  confidence: number;
}

export interface SignalSourceRankerConfig {
  hysteresisFrames: number;
  rankingInterval: number;
  minSwitchAdvantage: number;
  minSamplesForRanking: number;
  enableCoherence: boolean;
}

export class SignalSourceRanker {
  private config: SignalSourceRankerConfig;
  private candidates: Map<string, RankedCandidate> = new Map();
  private activeCandidateId: string = 'G_abs';
  private lastSwitchFrame: number = 0;
  private frameCount: number = 0;
  private candidateHistory: Map<string, number[]> = new Map(); // Historial de scores para estabilidad
  
  constructor(config: Partial<SignalSourceRankerConfig> = {}) {
    this.config = {
      hysteresisFrames: 90,  // ~3s a 30fps
      rankingInterval: 30,   // Ranking cada 30 frames
      minSwitchAdvantage: 0.25, // 25% mejora mínima para cambiar
      minSamplesForRanking: 60,
      enableCoherence: true,
      ...config
    };
  }

  /**
   * Actualizar ranking con nuevos candidatos de BeerLambertExtractor
   */
  public updateCandidates(signalCandidates: SignalCandidate[]): RankingResult {
    this.frameCount++;
    
    // Convertir SignalCandidate a RankedCandidate
    for (const candidate of signalCandidates) {
      const ranked: RankedCandidate = {
        id: candidate.id,
        name: candidate.name,
        score: candidate.score,
        amplitude: candidate.amplitude,
        acdcRatio: candidate.acdcRatio,
        signalToNoise: candidate.signalToNoise,
        spectralPower: candidate.spectralPower,
        bandPowerRatio: candidate.bandPowerRatio,
        periodicity: candidate.periodicity,
        temporalStability: candidate.temporalStability,
        clippingPenalty: candidate.clippingPenalty,
        driftPenalty: candidate.driftPenalty,
        motionPenalty: candidate.motionPenalty,
        sourceType: candidate.sourceType,
        lastUpdate: candidate.lastUpdate
      };
      
      this.candidates.set(candidate.id, ranked);
      
      // Actualizar historial de scores
      const history = this.candidateHistory.get(candidate.id) || [];
      history.push(candidate.score);
      if (history.length > 30) history.shift();
      this.candidateHistory.set(candidate.id, history);
    }
    
    // Rankea solo en intervalos configurados
    if (this.frameCount % this.config.rankingInterval !== 0) {
      const best = this.candidates.get(this.activeCandidateId);
      return {
        bestCandidate: best || this.createEmptyCandidate(),
        runnerUp: null,
        allCandidates: Array.from(this.candidates.values()),
        allSQI: this.getAllSQI(),
        reasonForSwitch: 'Waiting for ranking interval',
        switchOccurred: false,
        confidence: best?.score || 0
      };
    }
    
    // Calcular score mejorado con estabilidad temporal
    const enhancedCandidates = this.calculateEnhancedScores();
    
    // Encontrar mejor candidato
    const sortedCandidates = enhancedCandidates.sort((a, b) => b.score - a.score);
    const bestCandidate = sortedCandidates[0];
    const runnerUp = sortedCandidates[1] || null;
    
    // Decidir si hacer switch
    const currentCandidate = this.candidates.get(this.activeCandidateId);
    const switchDecision = this.evaluateSwitch(bestCandidate, currentCandidate);
    
    if (switchDecision.shouldSwitch && bestCandidate) {
      this.activeCandidateId = bestCandidate.id;
      this.lastSwitchFrame = this.frameCount;
    }
    
    // Calcular SQI para todos
    const allSQI = this.getAllSQI();
    
    return {
      bestCandidate: bestCandidate || this.createEmptyCandidate(),
      runnerUp,
      allCandidates: enhancedCandidates,
      allSQI,
      reasonForSwitch: switchDecision.reason,
      switchOccurred: switchDecision.shouldSwitch,
      confidence: bestCandidate?.score || 0
    };
  }

  /**
   * Calcular scores mejorados con estabilidad temporal
   */
  private calculateEnhancedScores(): RankedCandidate[] {
    const enhanced: RankedCandidate[] = [];
    
    for (const [id, candidate] of this.candidates) {
      const history = this.candidateHistory.get(id) || [];
      
      // Calcular estabilidad temporal del score
      let temporalStabilityBonus = 0;
      if (history.length >= 10) {
        const meanScore = history.reduce((sum, val) => sum + val, 0) / history.length;
        const variance = history.reduce((sum, val) => sum + (val - meanScore) ** 2, 0) / history.length;
        const cv = meanScore > 0 ? Math.sqrt(variance) / meanScore : 1;
        temporalStabilityBonus = (1 - cv) * 0.15; // Bonus hasta 15% por estabilidad
      }
      
      // Bonus para candidato activo (histéresis suave)
      const activeBonus = id === this.activeCandidateId ? 0.1 : 0;
      
      const enhancedScore = Math.min(1, candidate.score + temporalStabilityBonus + activeBonus);
      
      enhanced.push({
        ...candidate,
        score: enhancedScore
      });
    }
    
    return enhanced;
  }

  /**
   * Evaluar si debe hacer switch con lógica inteligente
   */
  private evaluateSwitch(
    bestCandidate: RankedCandidate | undefined,
    currentCandidate: RankedCandidate | undefined
  ): { shouldSwitch: boolean; reason: string } {
    if (!bestCandidate) {
      return { shouldSwitch: false, reason: 'No candidates available' };
    }
    
    if (!currentCandidate) {
      return { shouldSwitch: true, reason: 'No current candidate, selecting best' };
    }
    
    // Si el actual colapsó (score muy bajo), cambiar rápido
    if (currentCandidate.score < 0.2) {
      return { shouldSwitch: true, reason: 'Current candidate collapsed' };
    }
    
    // Verificar si pasó el periodo de histéresis
    const framesSinceSwitch = this.frameCount - this.lastSwitchFrame;
    if (framesSinceSwitch < this.config.hysteresisFrames) {
      return { shouldSwitch: false, reason: 'Hysteresis period active' };
    }
    
    // Verificar ventaja significativa
    const scoreAdvantage = bestCandidate.score - currentCandidate.score;
    const relativeAdvantage = currentCandidate.score > 0 ? scoreAdvantage / currentCandidate.score : 0;
    
    if (relativeAdvantage >= this.config.minSwitchAdvantage) {
      return {
        shouldSwitch: true,
        reason: `Better candidate: ${bestCandidate.name} (+${(relativeAdvantage * 100).toFixed(1)}% advantage)`
      };
    }
    
    // Si el mejor candidato tiene mejor coherencia y el actual tiene motion alto
    if (bestCandidate.motionPenalty < currentCandidate.motionPenalty * 0.5 &&
        bestCandidate.score > currentCandidate.score * 0.9) {
      return {
        shouldSwitch: true,
        reason: 'Switching to lower motion candidate'
      };
    }
    
    return { shouldSwitch: false, reason: 'Insufficient advantage' };
  }

  /**
   * Obtener SQI para todos los candidatos
   */
  private getAllSQI(): Record<string, number> {
    const allSQI: Record<string, number> = {};
    
    for (const [id, candidate] of this.candidates) {
      // SQI combinado de múltiples métricas
      const sqi = this.calculateSQI(candidate);
      allSQI[id] = sqi;
    }
    
    return allSQI;
  }

  /**
   * Calcular SQI individual para candidato
   */
  private calculateSQI(candidate: RankedCandidate): number {
    const weights = {
      amplitude: 0.15,
      acdcRatio: 0.15,
      signalToNoise: 0.20,
      bandPowerRatio: 0.20,
      periodicity: 0.15,
      temporalStability: 0.10,
      clippingPenalty: -0.25,
      driftPenalty: -0.15,
      motionPenalty: -0.20
    };
    
    let sqi = 0;
    sqi += Math.min(1, candidate.amplitude) * weights.amplitude;
    sqi += Math.min(1, candidate.acdcRatio) * weights.acdcRatio;
    sqi += Math.min(1, candidate.signalToNoise / 10) * weights.signalToNoise;
    sqi += candidate.bandPowerRatio * weights.bandPowerRatio;
    sqi += candidate.periodicity * weights.periodicity;
    sqi += candidate.temporalStability * weights.temporalStability;
    sqi += candidate.clippingPenalty * weights.clippingPenalty;
    sqi += candidate.driftPenalty * weights.driftPenalty;
    sqi += candidate.motionPenalty * weights.motionPenalty;
    
    return Math.max(0, Math.min(1, sqi));
  }

  /**
   * Obtener candidato activo actual
   */
  public getActiveCandidate(): RankedCandidate | null {
    return this.candidates.get(this.activeCandidateId) || null;
  }

  /**
   * Obtener ID de fuente activa
   */
  public getActiveSourceId(): string {
    return this.activeCandidateId;
  }

  /**
   * Forzar cambio a candidato específico
   */
  public forceSwitch(candidateId: string): void {
    if (this.candidates.has(candidateId)) {
      this.activeCandidateId = candidateId;
      this.lastSwitchFrame = this.frameCount;
    }
  }

  /**
   * Obtener telemetría de debug
   */
  public getDebugInfo(): any {
    const candidateInfo = Array.from(this.candidates.entries()).map(([id, candidate]) => ({
      id,
      name: candidate.name,
      score: candidate.score,
      amplitude: candidate.amplitude,
      bandPowerRatio: candidate.bandPowerRatio,
      periodicity: candidate.periodicity,
      temporalStability: candidate.temporalStability,
      clippingPenalty: candidate.clippingPenalty,
      motionPenalty: candidate.motionPenalty
    }));
    
    return {
      activeCandidate: this.activeCandidateId,
      framesSinceSwitch: this.frameCount - this.lastSwitchFrame,
      candidateCount: this.candidates.size,
      candidates: candidateInfo,
      hysteresisActive: (this.frameCount - this.lastSwitchFrame) < this.config.hysteresisFrames
    };
  }

  /**
   * Resetear ranker
   */
  public reset(): void {
    this.candidates.clear();
    this.candidateHistory.clear();
    this.activeCandidateId = 'G_abs';
    this.lastSwitchFrame = 0;
    this.frameCount = 0;
  }

  /**
   * Actualizar configuración
   */
  public updateConfig(newConfig: Partial<SignalSourceRankerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Crear candidato vacío para fallback
   */
  private createEmptyCandidate(): RankedCandidate {
    return {
      id: 'empty',
      name: 'No Signal',
      score: 0,
      amplitude: 0,
      acdcRatio: 0,
      signalToNoise: 0,
      spectralPower: 0,
      bandPowerRatio: 0,
      periodicity: 0,
      temporalStability: 0,
      clippingPenalty: 1,
      driftPenalty: 1,
      motionPenalty: 1,
      sourceType: 'none',
      lastUpdate: performance.now()
    };
  }
}
