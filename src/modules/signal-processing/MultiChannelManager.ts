<<<<<<< HEAD
/**
 * Manager multicanal avanzado (6 canales por defecto)
 * - Crea canales con pequeñas variantes iniciales (diversidad)
 * - Alimenta con entrada base (por ejemplo, G channel o ratio G/(R+G+B))
 * - Gestiona detección de dedo robusta: requiere debounce y consenso entre canales
 * - Feedback adaptativo: ajuste tipo PID leve sobre gain por canal
 * - Produce MultiChannelResult con BPM agregado y quality agregada
=======

/**
 * MultiChannelManager:
 * - crea 6 canales (cada uno puede tener parámetros distintos para 'sintonía fina')
 * - alimenta cada canal con la misma entrada base (rMean) pero permite transforms/adaptaciones
 * - implementa feedback bidireccional: evalúa calidad por canal y ajusta gain automáticamente
 * - produce resultado agregado para los procesadores finales (por ejemplo: BPM agregado)
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
 */

import PPGChannel from './PPGChannel';
import { ChannelResult, MultiChannelResult } from '@/types';

export default class MultiChannelManager {
  private channels: PPGChannel[] = [];
<<<<<<< HEAD
  private n: number;
  private windowSec: number;
  private lastTimestamp = Date.now();
  // debounce y consenso
  private fingerState = false;
  private fingerStableCount = 0;
  private fingerUnstableCount = 0;
  private fingerEnableFramesToConfirm = 6; // frames consecutivos con dedo para confirmar
  private fingerDisableFramesToConfirm = 6;
=======
  private n = 6;
  private windowSec: number;
  private lastTimestamp = Date.now();
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8

  constructor(n = 6, windowSec = 8) {
    this.n = n;
    this.windowSec = windowSec;
    for (let i = 0; i < n; i++) {
<<<<<<< HEAD
      // pequeñas diferencias en gain inicial para diversidad
      const initGain = 1 + (i - Math.floor(n/2)) * 0.03;
      this.channels.push(new PPGChannel(i, windowSec, initGain));
=======
      // Inicializar canales con distintas ganancias iniciales y/o parámetros para diversidad
      const initialGain = 1 + (i - Math.floor(n/2)) * 0.05; // pequeños offsets
      this.channels.push(new PPGChannel(i, windowSec, initialGain));
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
    }
  }

  pushSample(rawValue: number, timestampMs: number) {
    this.lastTimestamp = timestampMs;
<<<<<<< HEAD
    // alimentar todos los canales (podrían recibir transforms distintos en el futuro)
    for (const ch of this.channels) ch.pushSample(rawValue, timestampMs);
  }

  analyzeAll(globalCoverageRatio = 0.0, globalFrameDiff = 0.0): MultiChannelResult {
    const res: ChannelResult[] = [];
    let nFinger = 0;
    for (const ch of this.channels) {
      const out = ch.analyze();
      if (out.isFingerDetected) nFinger++;
      res.push({
        channelId: ch['channelId'],
        calibratedSignal: out.calibratedSignal,
        bpm: out.bpm,
        rrIntervals: out.rrIntervals,
=======
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
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
        snr: out.snr,
        quality: Math.round(out.quality),
        isFingerDetected: out.isFingerDetected,
        gain: ch.getGain()
<<<<<<< HEAD
      } as any);
    }

    // consenso: requerir que >= mitad de canales detecten dedo y coverageRatio alto y bajo movimiento
    const majority = Math.ceil(this.n / 2);
    const coverageOk = globalCoverageRatio > 0.35; // al menos ~35% pix cubiertos
    const motionOk = globalFrameDiff < 8; // brillo estable entre frames
    const channelConsensus = nFinger >= majority;

    // Actualizar debounce
    if (channelConsensus && coverageOk && motionOk) {
      this.fingerStableCount++;
      this.fingerUnstableCount = 0;
      if (this.fingerStableCount >= this.fingerEnableFramesToConfirm) this.fingerState = true;
    } else {
      this.fingerUnstableCount++;
      if (this.fingerUnstableCount >= this.fingerDisableFramesToConfirm) {
        this.fingerState = false;
        this.fingerStableCount = 0;
      }
    }

    // Feedback adaptativo: ajustar gains según quality (PID leve)
    for (const r of res) {
      const ch = this.channels[r.channelId];
      // Si detecta dedo pero baja quality -> aumentar gain suavemente
      if (r.isFingerDetected && r.quality < 40) {
        ch.adjustGainRel(0.02); // +2%
      }
      // Si no detecta dedo y gain alto -> reducir
      if (!r.isFingerDetected && r.gain > 1.5) ch.adjustGainRel(-0.03);
    }

    // agregación BPM: escoger valores de canales con quality >= threshold
    const good = res.filter(c => c.bpm && c.quality >= 45).map(c => ({bpm: c.bpm as number, q: c.quality}));
    let aggregatedBPM: number | null = null;
    if (good.length) {
      // voto ponderado por quality
      const sumQ = good.reduce((s, x) => s + x.q, 0) || 1;
      const avg = good.reduce((s, x) => s + x.bpm * (x.q / sumQ), 0);
      aggregatedBPM = Math.round(avg);
    } else {
      // fallback: usar cualquier bpm disponible promediado
      const any = res.filter(c => c.bpm);
      if (any.length) aggregatedBPM = Math.round(any.reduce((s,c)=>s + (c.bpm||0),0)/any.length);
      else aggregatedBPM = null;
    }

    const aggregatedQuality = Math.round(res.reduce((s,c)=>s + c.quality,0)/Math.max(1,res.length));

    return {
      timestamp: this.lastTimestamp,
      channels: res,
      aggregatedBPM,
      aggregatedQuality,
      fingerDetected: this.fingerState
    };
  }

  adjustChannelGain(channelId: number, deltaRel: number) {
    if (channelId < 0 || channelId >= this.channels.length) return;
    this.channels[channelId].adjustGainRel(deltaRel);
  }

  getGains() { return this.channels.map(c=>c.getGain()); }
=======
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
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
}
