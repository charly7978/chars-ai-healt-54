import { HeartBeatProcessor } from '../HeartBeatProcessor';
import { SpO2Processor } from './spo2-processor';
import { BloodPressureProcessor } from './blood-pressure-processor';
import { ArrhythmiaProcessor } from './arrhythmia-processor';

export class VitalSignsProcessor {
  private heartProcessor = new HeartBeatProcessor();
  private spo2Processor = new SpO2Processor();
  private bpProcessor = new BloodPressureProcessor();
  private arrhythmiaProcessor = new ArrhythmiaProcessor();

  /**
   * Procesa los canales provenientes del MultiChannelOptimizer
   */
  public processChannels(channels: any, timestamp: number) {
    if (!channels || !channels.heart) return null;

    // 1. Obtener pulso base
    const bpm = this.heartProcessor.processSignal(channels.heart.output, timestamp);
    
    // 2. Obtener intervalos para arritmia
    // PROTECCIÓN: Asegurar que getRRIntervals siempre sea un array
    const rrIntervals = this.heartProcessor.getRRIntervals() || [];
    
    return this.calculateVitalSignsFromChannels(channels, bpm, rrIntervals, timestamp);
  }

  private calculateVitalSignsFromChannels(channels: any, bpm: number, rrIntervals: number[], timestamp: number) {
    try {
      // 3. SpO2 (Oxígeno)
      const spo2 = this.spo2Processor.process(
        channels.heart.output, 
        channels.spo2 ? channels.spo2.output : channels.heart.output
      );

      // 4. Presión Arterial
      // Enviamos la amplitud de la onda para el cálculo real
      const waveAmplitude = channels.heart.output;
      const bp = this.bpProcessor.process(bpm, waveAmplitude, channels.heart.quality);

      // 5. Arritmia
      // PROTECCIÓN CRÍTICA: Aquí es donde fallaba al leer .length
      let arrhythmiaStatus = "Analizando...";
      if (Array.isArray(rrIntervals) && rrIntervals.length > 0) {
        arrhythmiaStatus = this.arrhythmiaProcessor.addTimestamp(timestamp);
      }

      return {
        heartRate: bpm,
        bloodPressure: bp,
        oxygenLevel: spo2,
        arrhythmia: arrhythmiaStatus,
        confidence: channels.heart.quality
      };
    } catch (error) {
      console.error("Error en el cálculo de signos vitales:", error);
      return null;
    }
  }

  public reset() {
    this.heartProcessor.reset();
    this.spo2Processor.reset();
    this.bpProcessor.reset();
    this.arrhythmiaProcessor.reset();
  }
}
