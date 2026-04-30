/**
 * GreenChannelTriad — construcción canónica de tres canales verdes
 * ortogonales para PPG smartphone con flash.
 *
 * Definiciones (literatura PPG smartphone clínica 2017-2026):
 *   G1 = meanG raw (DC + AC sumados)
 *        Canal verde directo. Captura toda la modulación de hemoglobina.
 *
 *   G2 = (meanG − DC_G) / DC_G
 *        Verde NORMALIZADO por DC. Invariante a iluminación absoluta.
 *        Estándar usado en Verkruysse 2008, Poh 2010.
 *
 *   G3 = (R − G) / (R + G)
 *        Cromática R-G normalizada. Ortogonal a iluminación dispersa,
 *        robusta a motion. Inspirado en POS (Wang 2017) y CHROM (de Haan 2013).
 *
 * Cada canal se filtra independientemente con su propio BandpassFilter.
 * El motor selecciona el canal de mayor SQI con histéresis (no flicker
 * frame-a-frame).
 *
 * MODO SIN FLASH: Usa configuración de filtro adaptativa para señal débil,
 * prioriza G3 (cromática) por robustez a iluminación variable.
 */

import { BandpassFilter } from './BandpassFilter';
import { RingBuffer } from './RingBuffer';
import { NO_FLASH_GREEN_NORMALIZATION_FACTOR } from '@/constants/processing';

export type GreenChannelId = 'G1' | 'G2' | 'G3';

export interface TriadSample {
  g1Raw: number;
  g2Raw: number;
  g3Raw: number;
  g1Filtered: number;
  g2Filtered: number;
  g3Filtered: number;
  /** Canal seleccionado por el motor para el frame actual */
  selectedId: GreenChannelId;
  /** Valor filtrado del canal seleccionado (atajo) */
  selectedFiltered: number;
  /** SQI 0-1 de cada canal */
  sqi: { g1: number; g2: number; g3: number };
}

export interface TriadInput {
  meanR: number;
  meanG: number;
  /** DC de R en ventana actual (de PPGSignalProcessor.calculateACDC) */
  dcR: number;
  /** DC de G en ventana actual */
  dcG: number;
}

/**
 * SQI por canal: combina perfusion-index (AC/DC en su escala normalizada)
 * con periodicidad (autocorrelación a lag cardíaco). Se computa por
 * ventana de ~4 s para no oscilar frame a frame.
 */
class ChannelSQI {
  private buf: RingBuffer;
  private sampleRate: number;
  private windowSec: number;

  constructor(sampleRate: number, windowSec = 4) {
    this.sampleRate = sampleRate;
    this.windowSec = windowSec;
    this.buf = new RingBuffer(Math.max(60, Math.round(sampleRate * windowSec)));
  }

  setSampleRate(sr: number): void {
    if (Math.abs(sr - this.sampleRate) < 1.5) return;
    this.sampleRate = sr;
    const cap = Math.max(60, Math.round(sr * this.windowSec));
    this.buf = new RingBuffer(cap);
  }

  push(value: number): void {
    if (!isFinite(value)) return;
    this.buf.push(value);
  }

  /**
   * Devuelve SQI 0-1.
   *  - Componente A (50%): AC/DC normalizado del canal post-filtro
   *    (rango p10-p90 vs amplitud absoluta media).
   *  - Componente B (50%): autocorrelación a lag cardíaco (60-180 BPM).
   *  Si el buffer es corto, devuelve 0.
   */
  compute(): number {
    const n = this.buf.length;
    if (n < Math.round(this.sampleRate * 1.5)) return 0;
    const m = Math.min(n, Math.round(this.sampleRate * this.windowSec));
    const p10 = this.buf.percentile(0.1, m);
    const p90 = this.buf.percentile(0.9, m);
    const range = p90 - p10;
    if (range < 0.05) return 0;
    const mean = this.buf.mean(m);
    const variance = this.buf.variance(m);
    const std = Math.sqrt(variance);
    if (std < 1e-6) return 0;
    // Componente A: SNR rango/std (típico 3-6 para PPG limpia)
    const snrA = Math.min(1, range / (std + 0.1) / 6);
    // Componente B: autocorrelación máxima en banda 60-180 BPM
    const minLag = Math.max(4, Math.floor((this.sampleRate * 60) / 180));
    const maxLag = Math.min(m - 4, Math.floor((this.sampleRate * 60) / 38));
    let bestAc = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const ac = this.buf.autocorrelation(lag, m);
      if (ac > bestAc) bestAc = ac;
    }
    const periodicity = Math.max(0, Math.min(1, bestAc));
    return Math.max(0, Math.min(1, 0.5 * snrA + 0.5 * periodicity));
    // (mean usado solo para evitar -Wunused; no afecta cálculo)
    void mean;
  }

  reset(): void {
    this.buf.clear();
  }
}

export class GreenChannelTriad {
  private bpG1: BandpassFilter;
  private bpG2: BandpassFilter;
  private bpG3: BandpassFilter;

  private sqiG1: ChannelSQI;
  private sqiG2: ChannelSQI;
  private sqiG3: ChannelSQI;

  // Selector con histéresis: cambiar de canal solo si el competidor
  // supera al actual por > HYSTERESIS_MARGIN durante >= HYSTERESIS_FRAMES.
  private selectedId: GreenChannelId = 'G2';
  private selectorStreak: Record<GreenChannelId, number> = { G1: 0, G2: 0, G3: 0 };
  private readonly HYSTERESIS_MARGIN = 0.10;
  private readonly HYSTERESIS_FRAMES = 30;
  private useFlash: boolean;

  constructor(sampleRate = 30, useFlash = true) {
    this.useFlash = useFlash;
    const filterConfig = BandpassFilter.getConfig(useFlash);
    this.bpG1 = new BandpassFilter(sampleRate, filterConfig);
    this.bpG2 = new BandpassFilter(sampleRate, filterConfig);
    this.bpG3 = new BandpassFilter(sampleRate, filterConfig);
    this.sqiG1 = new ChannelSQI(sampleRate);
    this.sqiG2 = new ChannelSQI(sampleRate);
    this.sqiG3 = new ChannelSQI(sampleRate);
    
    // MODO SIN FLASH: priorizar G3 (cromática) por robustez a iluminación variable
    if (!useFlash) {
      this.selectedId = 'G3';
    }
  }

  setSampleRate(sr: number): void {
    this.bpG1.setSampleRate(sr);
    this.bpG2.setSampleRate(sr);
    this.bpG3.setSampleRate(sr);
    this.sqiG1.setSampleRate(sr);
    this.sqiG2.setSampleRate(sr);
    this.sqiG3.setSampleRate(sr);
  }

  process(input: TriadInput): TriadSample {
    const g1Raw = input.meanG;
    const g2Raw = input.dcG > 1e-3 ? (input.meanG - input.dcG) / input.dcG : 0;
    const denom = input.meanR + input.meanG;
    const g3Raw = denom > 1e-3 ? (input.meanR - input.meanG) / denom : 0;

    const g1Filtered = this.bpG1.filter(g1Raw);
    // G2 ya viene normalizado a un orden 0.001-0.05; escalamos x2000 para
    // que el bandpass trabaje en unidades comparables a G1/G3 escalado.
    const g2Filtered = this.bpG2.filter(g2Raw * 2000);
    const g3Filtered = this.bpG3.filter(g3Raw * 2000);

    this.sqiG1.push(g1Filtered);
    this.sqiG2.push(g2Filtered);
    this.sqiG3.push(g3Filtered);
    const sqi = {
      g1: this.sqiG1.compute(),
      g2: this.sqiG2.compute(),
      g3: this.sqiG3.compute(),
    };

    // Selector con histéresis
    const sqiByCh: Record<GreenChannelId, number> = { G1: sqi.g1, G2: sqi.g2, G3: sqi.g3 };
    const currentSqi = sqiByCh[this.selectedId];
    let bestId: GreenChannelId = this.selectedId;
    let bestSqi = currentSqi;
    for (const id of ['G1', 'G2', 'G3'] as const) {
      if (id === this.selectedId) continue;
      if (sqiByCh[id] > bestSqi + this.HYSTERESIS_MARGIN) {
        bestSqi = sqiByCh[id];
        bestId = id;
      }
    }
    if (bestId !== this.selectedId) {
      this.selectorStreak[bestId]++;
      if (this.selectorStreak[bestId] >= this.HYSTERESIS_FRAMES) {
        this.selectedId = bestId;
        this.selectorStreak = { G1: 0, G2: 0, G3: 0 };
      }
    } else {
      this.selectorStreak = { G1: 0, G2: 0, G3: 0 };
    }

    const selectedFiltered =
      this.selectedId === 'G1' ? g1Filtered : this.selectedId === 'G2' ? g2Filtered : g3Filtered;

    return {
      g1Raw,
      g2Raw,
      g3Raw,
      g1Filtered,
      g2Filtered,
      g3Filtered,
      selectedId: this.selectedId,
      selectedFiltered,
      sqi,
    };
  }

  reset(): void {
    this.bpG1.reset();
    this.bpG2.reset();
    this.bpG3.reset();
    this.sqiG1.reset();
    this.sqiG2.reset();
    this.sqiG3.reset();
    this.selectedId = 'G2';
    this.selectorStreak = { G1: 0, G2: 0, G3: 0 };
  }

  getSelectedId(): GreenChannelId {
    return this.selectedId;
  }
}
