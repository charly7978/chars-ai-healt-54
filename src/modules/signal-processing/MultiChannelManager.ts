
/**
 * MultiChannelManager CORREGIDO:
 * - Lógica de consenso arreglada
 * - Umbrales realistas para detección de dedo  
 * - Feedback adaptativo mejorado
 * - Agregación de BPM más robusta
 */

import PPGChannel from './PPGChannel';
import { ChannelResult, MultiChannelResult } from '@/types';

export default class MultiChannelManager {
  private channels: PPGChannel[] = [];
  private n: number;
  private windowSec: number;
  private lastTimestamp = Date.now();
  
  // Estado de detección con debounce
  private fingerState = false;
  private fingerStableCount = 0;
  private fingerUnstableCount = 0;
  
  // CORREGIDO: Parámetros de consenso más balanceados
  private readonly FRAMES_TO_CONFIRM_FINGER = 5;    // Confirmar dedo
  private readonly FRAMES_TO_LOSE_FINGER = 8;       // Perder dedo
  private readonly MIN_COVERAGE_RATIO = 0.15;       // 15% cobertura mínima
  private readonly MAX_FRAME_DIFF = 15;              // Tolerancia a movimiento
  private readonly MIN_CONSENSUS_RATIO = 0.4;       // 40% canales deben detectar

  constructor(n = 6, windowSec = 8) {
    this.n = n;
    this.windowSec = windowSec;
    
    // Crear canales con ligeras variaciones para diversidad
    for (let i = 0; i < n; i++) {
      const gainVariation = 1 + (i - Math.floor(n/2)) * 0.05; // ±5% variación
      this.channels.push(new PPGChannel(i, windowSec, gainVariation));
    }
  }

  pushSample(rawValue: number, timestampMs: number) {
    this.lastTimestamp = timestampMs;
    
    // Alimentar todos los canales con el mismo valor base
    for (const channel of this.channels) {
      channel.pushSample(rawValue, timestampMs);
    }
  }

  analyzeAll(globalCoverageRatio = 0.0, globalFrameDiff = 0.0): MultiChannelResult {
    // Analizar todos los canales
    const channelResults: ChannelResult[] = [];
    let detectedChannels = 0;
    
    for (const channel of this.channels) {
      const result = channel.analyze();
      
      if (result.isFingerDetected) {
        detectedChannels++;
      }
      
      channelResults.push({
        channelId: channel['channelId'],
        calibratedSignal: result.calibratedSignal,
        bpm: result.bpm,
        rrIntervals: result.rrIntervals,
        snr: result.snr,
        quality: result.quality,
        isFingerDetected: result.isFingerDetected,
        gain: result.gain
      } as any);
    }

    // CRITERIOS DE CONSENSO CORREGIDOS
    const coverageOk = globalCoverageRatio >= this.MIN_COVERAGE_RATIO;
    const motionOk = globalFrameDiff <= this.MAX_FRAME_DIFF;
    const consensusOk = detectedChannels >= Math.ceil(this.n * this.MIN_CONSENSUS_RATIO);
    const globalCondition = coverageOk && motionOk && consensusOk;

    // Debug logging periódico
    if (Date.now() % 3000 < 100) { // Cada ~3 segundos
      console.log('🏭 MultiChannel Estado:', {
        detectedChannels: `${detectedChannels}/${this.n}`,
        coverageRatio: (globalCoverageRatio * 100).toFixed(1) + '%',
        frameDiff: globalFrameDiff.toFixed(1),
        consensusOk,
        coverageOk,
        motionOk,
        globalCondition,
        fingerState: this.fingerState
      });
    }

    // Actualizar estado con debounce
    if (globalCondition) {
      this.fingerStableCount++;
      this.fingerUnstableCount = 0;
      
      if (this.fingerStableCount >= this.FRAMES_TO_CONFIRM_FINGER) {
        if (!this.fingerState) {
          console.log('✅ DEDO DETECTADO - Estado cambiado a TRUE');
        }
        this.fingerState = true;
      }
    } else {
      this.fingerUnstableCount++;
      
      if (this.fingerUnstableCount >= this.FRAMES_TO_LOSE_FINGER) {
        if (this.fingerState) {
          console.log('❌ DEDO PERDIDO - Estado cambiado a FALSE');
        }
        this.fingerState = false;
        this.fingerStableCount = 0;
      }
    }

    // Feedback adaptativo de ganancia
    this.applyAdaptiveFeedback(channelResults);

    // Agregación de BPM mejorada
    const aggregatedBPM = this.aggregateBPM(channelResults);
    const aggregatedQuality = this.aggregateQuality(channelResults);

    return {
      timestamp: this.lastTimestamp,
      channels: channelResults,
      aggregatedBPM,
      aggregatedQuality,
      fingerDetected: this.fingerState
    };
  }

  private applyAdaptiveFeedback(results: ChannelResult[]) {
    for (const result of results) {
      const channel = this.channels[result.channelId];
      
      if (result.isFingerDetected) {
        // Si detecta dedo pero calidad baja, aumentar ganancia ligeramente
        if (result.quality < 40) {
          channel.adjustGainRel(0.03); // +3%
        }
        // Si detecta dedo y calidad muy alta, reducir ganancia para evitar saturación
        else if (result.quality > 90) {
          channel.adjustGainRel(-0.02); // -2%
        }
      } else {
        // Si no detecta dedo pero ganancia muy alta, reducir
        if (result.gain > 2.0) {
          channel.adjustGainRel(-0.05); // -5%
        }
      }
    }
  }

  private aggregateBPM(results: ChannelResult[]): number | null {
    // Filtrar canales con detección válida y BPM en rango fisiológico
    const validBPMs = results
      .filter(r => r.isFingerDetected && r.bpm && r.bpm >= 45 && r.bpm <= 180 && r.quality >= 30)
      .map(r => ({ bpm: r.bpm!, quality: r.quality }));

    if (validBPMs.length === 0) {
      // Fallback: usar cualquier BPM disponible si es razonable
      const anyBPM = results
        .filter(r => r.bpm && r.bpm >= 45 && r.bpm <= 180)
        .map(r => r.bpm!);
      
      return anyBPM.length > 0 ? 
        Math.round(anyBPM.reduce((sum, bpm) => sum + bpm, 0) / anyBPM.length) : 
        null;
    }

    // Promedio ponderado por calidad
    const totalQuality = validBPMs.reduce((sum, item) => sum + item.quality, 0);
    const weightedSum = validBPMs.reduce((sum, item) => 
      sum + item.bpm * (item.quality / totalQuality), 0);
    
    return Math.round(weightedSum);
  }

  private aggregateQuality(results: ChannelResult[]): number {
    if (results.length === 0) return 0;
    
    // Promedio de calidad de todos los canales
    const avgQuality = results.reduce((sum, r) => sum + r.quality, 0) / results.length;
    
    // Bonus si múltiples canales detectan dedo
    const detectionBonus = results.filter(r => r.isFingerDetected).length * 5;
    
    return Math.round(Math.min(100, avgQuality + detectionBonus));
  }

  adjustChannelGain(channelId: number, deltaRel: number) {
    if (channelId >= 0 && channelId < this.channels.length) {
      this.channels[channelId].adjustGainRel(deltaRel);
    }
  }

  getGains() {
    return this.channels.map(ch => ch.getGain());
  }

  reset() {
    this.fingerState = false;
    this.fingerStableCount = 0;
    this.fingerUnstableCount = 0;
    
    // Reset individual channels
    for (const channel of this.channels) {
      channel.setGain(1.0);
    }
  }
}
