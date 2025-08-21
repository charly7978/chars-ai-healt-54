
/**
 * MultiChannelManager:
 * - crea 6 canales (cada uno puede tener parámetros distintos para 'sintonía fina')
 * - alimenta cada canal con la misma entrada base (rMean) pero permite transforms/adaptaciones
 * - implementa feedback bidireccional: evalúa calidad por canal y ajusta gain automáticamente
 * - produce resultado agregado para los procesadores finales (por ejemplo: BPM agregado)
 */

import PPGChannel from './PPGChannel';
import { ChannelResult, MultiChannelResult } from '@/types';

export default class MultiChannelManager {
  private channels: PPGChannel[] = [];
  private n = 6;
  private windowSec: number;
  private lastTimestamp = Date.now();

  constructor(n = 6, windowSec = 8) {
    this.n = n;
    this.windowSec = windowSec;
    for (let i = 0; i < n; i++) {
      // Inicializar canales con distintas ganancias iniciales y/o parámetros para diversidad
      const initialGain = 1 + (i - Math.floor(n/2)) * 0.05; // pequeños offsets
      this.channels.push(new PPGChannel(i, windowSec, initialGain));
    }
  }

  pushSample(rawValue: number, timestampMs: number) {
    this.lastTimestamp = timestampMs;
    // Distribución simple: misma señal, los canales diferirán por gain y parámetros internos
    for (let i = 0; i < this.n; i++) {
      this.channels[i].pushSample(rawValue, timestampMs);
    }
  }

  // Ejecutar análisis para todos los canales, aplicar feedback de calibración automática
  analyzeAll(): MultiChannelResult {
    const channelResults: ChannelResult[] = [];
    for (let i = 0; i < this.n; i++) {
      const ch = this.channels[i];
      const out = ch.analyze();
      // feedback automático: si quality baja demasiado, ajustamos gain
      // regla heurística: si quality < 30 pero mean signal baja -> incremento de gain
      const meanSignal = out.calibratedSignal.length ? (out.calibratedSignal.reduce((a,b)=>a+b,0)/out.calibratedSignal.length) : 0;
      // si hay detección de dedo pero baja calidad, intentar aumentar gain levemente
      if (out.isFingerDetected && out.quality < 40 && meanSignal < 30) {
        ch.adjustGain(0.03); // +3%
      }
      // si no hay dedo y gain grande, reducir para evitar saturación
      if (!out.isFingerDetected && ch.getGain() > 1.5) {
        ch.adjustGain(-0.05); // -5%
      }
      channelResults.push({
        channelId: i,
        calibratedSignal: out.calibratedSignal,
        bpm: out.bpm,
        snr: out.snr,
        quality: Math.round(out.quality),
        isFingerDetected: out.isFingerDetected,
        gain: ch.getGain()
      });
    }

    // Agregación: BPM más frecuente entre canales con buena calidad
    const goodBpms = channelResults.filter(c => c.bpm && c.quality >= 45).map(c => c.bpm as number);
    let aggregatedBPM: number | null = null;
    if (goodBpms.length) {
      // moda simple
      const counts = new Map<number, number>();
      for (const b of goodBpms) counts.set(b, (counts.get(b) || 0) + 1);
      let best = goodBpms[0], bestCount = 0;
      counts.forEach((cnt, val) => { if (cnt > bestCount) { best = val; bestCount = cnt; }});
      aggregatedBPM = best;
    } else {
      // fallback: promedio ponderado por quality
      const withQ = channelResults.filter(c => c.bpm != null);
      if (withQ.length) {
        const sumQ = withQ.reduce((s,c)=>s + (c.quality || 0),0) || 1;
        const avg = withQ.reduce((s,c)=>s + ((c.bpm||0) * (c.quality||0)),0)/sumQ;
        aggregatedBPM = Math.round(avg);
      } else aggregatedBPM = null;
    }

    const aggregatedQuality = Math.round(channelResults.reduce((s,c)=>s + c.quality,0)/Math.max(1, channelResults.length));

    return {
      timestamp: this.lastTimestamp,
      channels: channelResults,
      aggregatedBPM,
      aggregatedQuality
    };
  }

  // Permite ajustes manuales desde UI por canal
  adjustChannelGain(channelId: number, deltaRel: number) {
    if (channelId < 0 || channelId >= this.channels.length) return;
    this.channels[channelId].adjustGain(deltaRel);
  }

  getChannelGains() {
    return this.channels.map(c => c.getGain());
  }
}
