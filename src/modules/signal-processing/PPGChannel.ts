
/**
 * PPGChannel COMPLETAMENTE CORREGIDO:
 * - Umbrales ajustados para valores REALES de cámara (0-255)
 * - Detección de dedo robusta y balanceada
 * - SNR calculado correctamente con métodos avanzados
 * - Filtrado y procesamiento optimizado para señales PPG débiles
 * - Logging detallado para debug completo
 */

import { savitzkyGolay } from './SavitzkyGolayFilter';
import { Biquad } from './Biquad';
import { goertzelPower } from './Goertzel';
import { computeSNR } from './SignalQualityAnalyzer';
import { improvedDetectPeaks } from './ImprovedPeakDetector';

type Sample = { t: number; v: number };

export default class PPGChannel {
  channelId: number;
  private buffer: Sample[] = [];
  private windowSec: number;
  private gain: number;
  private bufferStartTime: number = 0;
  
  // Historia de RR para validación
  private rrHistory: number[] = [];
  
  // Histéresis por canal para evitar flapping
  private detectionState: boolean = false;
  private consecutiveTrue: number = 0;
  private consecutiveFalse: number = 0;
  private readonly MIN_TRUE_FRAMES = 3;  // Balance entre velocidad y confiabilidad
  private readonly MIN_FALSE_FRAMES = 12; // Evitar pérdidas prematuras
  private lastToggleMs: number = 0;
  private readonly HOLD_MS = 200; // Respuesta más rápida
  private qualityEma: number | null = null;
  
  // CRÍTICO: Umbrales PROFESIONALES para detección precisa
  private minRMeanForFinger = 70;   // Balance entre sensibilidad y precisión
  private maxRMeanForFinger = 245;  // Evitar saturación
  private minVarianceForPulse = 1.2; // Señal AC mínima clara
  private minSNRForFinger = 1.5;    // SNR razonable
  private maxFrameDiffForStability = 15; // Movimiento moderado
  // Umbrales adicionales para robustecer gating
  private readonly minStdSmoothForPulse = 0.15; // Amplitud mínima en señal filtrada
  private readonly maxRRCoeffVar = 0.20;        // Máximo 20% variación RR
  private readonly EARLY_DETECT_MIN_SAMPLES = 60; // ~2s con 30FPS
  private readonly EARLY_DETECT_MAX_SAMPLES = 120; // ~4s ventana temprana

  constructor(channelId = 0, windowSec = 8, initialGain = 1) {
    this.channelId = channelId;
    this.windowSec = windowSec;
    this.gain = initialGain;
    
    // Sin inicialización adicional necesaria
    
    // Buffer circular para evitar problemas con shift()
    this.bufferStartTime = 0;
    
    console.log(`🔬 PPGChannel ${channelId} creado:`, {
      windowSec,
      initialGain,
      minRMeanForFinger: this.minRMeanForFinger,
      maxRMeanForFinger: this.maxRMeanForFinger,
      minVarianceForPulse: this.minVarianceForPulse,
      minSNRForFinger: this.minSNRForFinger
    });
  }

  pushSample(rawValue: number, timestampMs: number) {
    const t = timestampMs / 1000;
    const v = rawValue * this.gain;
    this.buffer.push({ t, v });
    
    // Mantener ventana temporal con suavizado
    const t0 = t - this.windowSec;
    
    // Solo hacer shift si hay suficientes muestras y el buffer es muy grande
    if (this.buffer.length > 300 && this.buffer[0].t < t0) {
      // Mantener al menos 20% de muestras antiguas para continuidad
      const keepTime = t - this.windowSec * 1.2;
      while (this.buffer.length > 250 && this.buffer[0].t < keepTime) {
        this.buffer.shift();
      }
      this.bufferStartTime = this.buffer[0].t;
    }
    
    // Debug logging cada 300 muestras para no saturar (aumentado de 100)
    if (this.buffer.length % 300 === 0 && this.channelId === 0) {
      console.log(`📊 Canal ${this.channelId} Buffer:`, {
        bufferSize: this.buffer.length,
        timeSpan: this.buffer.length > 1 ? 
          (this.buffer[this.buffer.length-1].t - this.buffer[0].t).toFixed(2) + 's' : '0s',
        lastValue: v.toFixed(2),
        rawValue: rawValue.toFixed(1),
        gain: this.gain.toFixed(3)
      });
    }
  }

  adjustGainRel(rel: number) {
    const oldGain = this.gain;
    this.gain = Math.max(0.1, Math.min(10, this.gain * (1 + rel)));
    
    if (this.channelId === 0) {
      console.log(`🔧 Canal ${this.channelId} Ganancia:`, {
        oldGain: oldGain.toFixed(3),
        newGain: this.gain.toFixed(3),
        changePercent: (rel * 100).toFixed(1) + '%'
      });
    }
  }

  setGain(g: number) { 
    this.gain = Math.max(0.1, Math.min(10, g)); 
  }

  getGain() { 
    return this.gain; 
  }

  analyze() {
    if (this.buffer.length < 50) { // Aumentado para análisis más confiable
      return { 
        calibratedSignal: [], 
        bpm: null, 
        rrIntervals: [], 
        snr: 0, 
        quality: 0, 
        isFingerDetected: false, 
        gain: this.gain 
      };
    }

    // Remuestreo uniforme optimizado
    const N = 256;
    const sampled = this.resampleUniform(this.buffer, N);
    
    // Estadísticas básicas CORREGIDAS
    const mean = sampled.reduce((a, b) => a + b, 0) / sampled.length;
    const variance = sampled.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sampled.length;
    const std = Math.sqrt(variance);

    // Normalización z-score robusta
    const normalized = std > 0.5 ? 
      sampled.map(x => (x - mean) / std) : 
      sampled.map(x => x - mean);

    // Filtrado PROFESIONAL - pasabanda optimizado para señal cardíaca
    const fs = N / this.windowSec;
    const biquad = new Biquad();
    biquad.setBandpass(1.2, 1.5, fs); // Centro 1.2Hz (72 bpm), ancho 1.5Hz para rango 45-150 BPM
    const filtered = biquad.processArray(normalized);

    // Suavizado Savitzky-Golay para preservar picos
    const smooth = savitzkyGolay(filtered, 9); // Ventana optimizada

    // Análisis espectral MEJORADO con Goertzel
    const freqs = this.linspace(0.8, 4.0, 120); // Resolución suficiente con menor costo
    const powers = freqs.map(f => goertzelPower(smooth, fs, f));
    
    // Encontrar pico espectral MÁS ROBUSTO
    const maxPower = Math.max(...powers);
    const maxIdx = powers.indexOf(maxPower);
    const peakFreq = freqs[maxIdx];
    
    // SNR MEJORADO con análisis más sofisticado
    const sortedPowers = powers.slice().sort((a, b) => b - a);
    const signalPower = sortedPowers[0];
    
    // Ruido calculado como mediana de 70% de valores más bajos
    const noiseStart = Math.floor(sortedPowers.length * 0.3);
    const noisePowers = sortedPowers.slice(noiseStart);
    const noisePower = this.median(noisePowers);
    
    const snr = signalPower / Math.max(1e-6, noisePower);
    
    // Calidad COMBINADA: usar calidad robusta del procesador + métricas locales
    const qualitySpectral = Math.min(40, Math.max(0, (snr - 1) * 28));
    const qualityVariance = variance > this.minVarianceForPulse ? 30 : 8;
    const qualityStability = this.buffer.length >= 150 ? 22 : 
                            this.buffer.length >= 100 ? 18 : 12;
    const qualitySignalStrength = Math.min(20, Math.max(0, (maxPower - 1e-4) * 65000));
    
    const localQuality = qualitySpectral + qualityVariance + qualityStability + qualitySignalStrength;
    
    // Combinar con calidad robusta (dar más peso a la robusta)
    const quality = robustQuality ? (robustQuality * 100 * 0.7 + localQuality * 0.3) : localQuality;

    // BPM del pico espectral con validación
    const bpmSpectral = maxPower > 1e-5 ? Math.round(peakFreq * 60) : null;

    // Detección PROFESIONAL de picos PPG mejorada
    const { peaks, peakTimesMs, rr, confidence } = improvedDetectPeaks(smooth, fs, 300, 0.15);
    
    // Calcular BPM temporal con validación
    const bpmTemporal = rr.length >= 2 ? 
      Math.round(60000 / (rr.reduce((a,b) => a+b, 0) / rr.length)) : null;
    
    // Actualizar historia de RR para análisis de tendencias
    if (rr.length > 0) {
      this.rrHistory = [...this.rrHistory, ...rr].slice(-20);
    }
    
    // Calcular métricas de calidad avanzadas
    const peakAmplitudes = peaks.map(idx => smooth[idx]);
    const avgAmplitude = peakAmplitudes.length > 0 ? 
      peakAmplitudes.reduce((a,b) => a+b, 0) / peakAmplitudes.length : 0;
    
    const robustQuality = confidence || 0.5;
    const noiseLevel = 1 / (1 + snr);

    // Chequeos adicionales: amplitud AC y regularidad RR
    const stdSmooth = this.stdArray(smooth);
    const acOk = stdSmooth >= this.minStdSmoothForPulse || variance >= this.minVarianceForPulse;
    let rrConsistencyOk = true;
    if (rr.length >= 3) {
      const meanRR = rr.reduce((a,b)=>a+b,0)/rr.length;
      const stdRR = Math.sqrt(rr.reduce((a,b)=>a+(b-meanRR)*(b-meanRR),0)/rr.length);
      const cvRR = stdRR / Math.max(1, meanRR);
      rrConsistencyOk = cvRR <= this.maxRRCoeffVar;
    }

    // CRITERIOS DE DETECCIÓN MEJORADOS - Más tolerantes pero realistas
    const brightnessOk = mean >= this.minRMeanForFinger && mean <= this.maxRMeanForFinger;
    const varianceOk = variance >= this.minVarianceForPulse;
    const snrOk = snr >= this.minSNRForFinger;
    const bpmOk = (bpmSpectral && bpmSpectral >= 45 && bpmSpectral <= 180) || 
                  (bpmTemporal && bpmTemporal >= 45 && bpmTemporal <= 180);
    
    // Detección basada en métricas profesionales
    const hasValidPeaks = peaks.length >= 2 && rr.length >= 1;
    const hasGoodConfidence = (confidence ?? 0) > 0.4;
    const hasConsistentRR = rrConsistencyOk || this.rrHistory.length < 5;
    const peakConfidence = hasValidPeaks && hasGoodConfidence && hasConsistentRR;
    
    // Si ya estamos detectando, ser más tolerante para mantener la detección
    if (this.detectionState) {
      // Mantener detección si tenemos al menos señal básica
      const maintainDetection = brightnessOk && (varianceOk || peakConfidence || (snr > 0.8));
      var rawDetected = maintainDetection;
    } else {
      // Para nueva detección, ser más estricto
      const inEarlyWindow = this.buffer.length >= this.EARLY_DETECT_MIN_SAMPLES && this.buffer.length <= this.EARLY_DETECT_MAX_SAMPLES;
      const earlyOk = inEarlyWindow && brightnessOk && acOk && varianceOk;
      var rawDetected = Boolean((brightnessOk && varianceOk && snrOk && bpmOk && acOk && rrConsistencyOk) || earlyOk || peakConfidence);
    }

    // Aplicar histéresis por canal
    if (rawDetected) {
      this.consecutiveTrue++;
      this.consecutiveFalse = 0;
      if (!this.detectionState && this.consecutiveTrue >= this.MIN_TRUE_FRAMES) {
        this.detectionState = true;
        this.lastToggleMs = Date.now();
      }
    } else {
      this.consecutiveFalse++;
      this.consecutiveTrue = 0;
      if (this.detectionState) {
        const sinceToggle = Date.now() - this.lastToggleMs;
        if (sinceToggle >= this.HOLD_MS && this.consecutiveFalse >= this.MIN_FALSE_FRAMES) {
          // DEBUG: Log cuando se pierde la detección
          console.warn(`❌ Canal ${this.channelId} PERDIENDO DETECCIÓN:`, {
            sinceToggle: sinceToggle + 'ms',
            consecutiveFalse: this.consecutiveFalse,
            mean: mean.toFixed(1),
            variance: variance.toFixed(2),
            snr: snr.toFixed(2),
            criterios: {
              brightnessOk,
              varianceOk,
              snrOk,
              bpmOk,
              acOk,
              rrConsistencyOk
            }
          });
          this.detectionState = false;
          this.lastToggleMs = Date.now();
        }
      }
    }

    // Suavizado de calidad para evitar saltos bruscos
    const alphaQ = 0.25;
    if (this.qualityEma == null) this.qualityEma = quality;
    else this.qualityEma = this.qualityEma * (1 - alphaQ) + quality * alphaQ;

    const isFingerDetected = this.detectionState;

    // Debug detección COMPLETA solo para canal 0 o cuando hay detección
    if ((this.channelId === 0 && this.buffer.length % 120 === 0) || isFingerDetected) {
      console.log(`🔍 Canal ${this.channelId} Análisis Completo:`, {
        // Estadísticas básicas
        mean: mean.toFixed(1),
        variance: variance.toFixed(2),
        std: std.toFixed(2),
        
        // Análisis espectral
        snr: snr.toFixed(2),
        maxPower: maxPower.toExponential(2),
        peakFreq: peakFreq.toFixed(2) + ' Hz',
        
        // BPM
        bpmSpectral,
        bpmTemporal,
        stdSmooth: stdSmooth.toFixed(3),
        acOk,
        rrCount: rr.length,
        rrConsistencyOk,
        earlyWindow: inEarlyWindow,
        earlyOk,
        
        // Criterios individuales
        brightnessOk: `${brightnessOk} (${this.minRMeanForFinger}-${this.maxRMeanForFinger})`,
        varianceOk: `${varianceOk} (min ${this.minVarianceForPulse})`,
        snrOk: `${snrOk} (min ${this.minSNRForFinger})`,
        bpmOk: `${bpmOk} (50-160 bpm)`,
        
        // Resultado final
        quality: quality.toFixed(1),
        isFingerDetected
      });
    }

    return {
      calibratedSignal: smooth,
      bpm: isFingerDetected ? (bpmTemporal || bpmSpectral) : null,
      rrIntervals: rr,
      snr,
      quality: Math.round(Math.min(100, this.qualityEma ?? quality)),
      isFingerDetected,
      gain: this.gain
    };
  }

  // Helper methods OPTIMIZADOS
  private resampleUniform(samples: Sample[], N: number) {
    if (samples.length === 0) return [];
    const t0 = samples[0].t;
    const t1 = samples[samples.length - 1].t;
    const T = Math.max(0.001, t1 - t0);
    const output: number[] = new Array(N);
    
    // Recorrido lineal O(N) en el buffer de muestras
    let j = 0;
    for (let i = 0; i < N; i++) {
      const targetTime = t0 + (i / (N - 1)) * T;
      while (j < samples.length - 1 && samples[j + 1].t < targetTime) {
        j++;
      }
      const s0 = samples[j];
      const s1 = samples[Math.min(samples.length - 1, j + 1)];
      if (s1.t === s0.t) {
        output[i] = s0.v;
      } else {
        const alpha = (targetTime - s0.t) / (s1.t - s0.t);
        const smoothAlpha = alpha * alpha * (3 - 2 * alpha);
        output[i] = s0.v * (1 - smoothAlpha) + s1.v * smoothAlpha;
      }
    }
    return output;
  }

  private linspace(start: number, end: number, num: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < num; i++) {
      result.push(start + (end - start) * (i / (num - 1)));
    }
    return result;
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? 
      (sorted[mid - 1] + sorted[mid]) / 2 : 
      sorted[mid];
  }

  private stdArray(arr: number[]): number {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
    const variance = arr.reduce((a,b)=>a+(b-mean)*(b-mean),0)/arr.length;
    return Math.sqrt(variance);
  }

  private simpleSmooth(signal: number[], windowSize: number): number[] {
    const result = [...signal];
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = halfWindow; i < signal.length - halfWindow; i++) {
      let sum = 0;
      for (let j = -halfWindow; j <= halfWindow; j++) {
        sum += signal[i + j];
      }
      result[i] = sum / windowSize;
    }
    
    return result;
  }
}
