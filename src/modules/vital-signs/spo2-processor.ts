import * as tf from '@tensorflow/tfjs';
import { SpO2Model, SpO2ModelConfig } from '../../ml/models/SpO2Model';

export class SpO2Processor {
  private spo2Model: SpO2Model;
  private readonly DEFAULT_SIGNAL_LENGTH = 40; // Desde HeartBeatProcessor.ts
  private readonly DEFAULT_SAMPLING_RATE = 60; // Desde HeartBeatProcessor.ts
  private readonly SPO2_BUFFER_SIZE = 10;
  private spo2Buffer: number[] = [];

  constructor() {
    const config: SpO2ModelConfig = {
      signalLength: this.DEFAULT_SIGNAL_LENGTH,
      samplingRate: this.DEFAULT_SAMPLING_RATE,
      inputShape: [this.DEFAULT_SIGNAL_LENGTH, 2],
      outputShape: [1],
      learningRate: 0.001 // Valor por defecto, se puede ajustar
    };
    this.spo2Model = new SpO2Model(config);
    // Cargar el modelo si está pre-entrenado. Esto puede ser asíncrono.
    // this.spo2Model.load(); // Descomentar si hay un modelo pre-entrenado para cargar
  }

  /**
   * Calculates the oxygen saturation (SpO2) from PPG values using a TensorFlow.js model
   */
  public async calculateSpO2(values: number[]): Promise<{ spo2: number; confidence: number }> {
    // Para simplificar, asumo que 'values' contiene tanto la señal roja como la IR.
    // En una aplicación real, necesitarías separar estas señales o tener dos arrays.
    // Por ahora, para la integración, asumo que 'values' es la señal roja y que la señal IR
    // puede ser derivada o que este módulo espera dos arrays de entrada.
    // Para hacer una integración funcional, necesitaremos que la fuente de datos
    // proporcione señales rojas e IR separadas o que se extraigan de 'values' de manera coherente.
    // Por ahora, para demostrar la integración, simularé que 'values' se puede dividir.

    if (values.length < this.DEFAULT_SIGNAL_LENGTH * 2) { // Multiplicado por 2 porque se asume red e ir alternados
      console.warn('SpO2Processor: Insufficient data for SpO2 calculation. Need at least', this.DEFAULT_SIGNAL_LENGTH * 2, 'samples.');
      return { spo2: 0, confidence: 0 };
    }

    // Se asume que 'values' alterna entre muestras de Rojo y IR.
    // Esto es una simplificación; en una implementación real, se esperarían dos canales separados.
    const redSignal = new Float32Array(this.DEFAULT_SIGNAL_LENGTH);
    const irSignal = new Float32Array(this.DEFAULT_SIGNAL_LENGTH);

    // Asegurarse de que tenemos suficientes datos para llenar los buffers
    const startIndex = Math.max(0, values.length - (this.DEFAULT_SIGNAL_LENGTH * 2)); // Asumiendo pares (red, ir)
    for (let i = 0; i < this.DEFAULT_SIGNAL_LENGTH; i++) {
      // Esto es una HACK para que funcione con un solo array 'values'.
      // Idealmente, 'values' debería ser ya un objeto con señales 'red' e 'ir'.
      redSignal[i] = values[startIndex + (i * 2)];
      irSignal[i] = values[startIndex + (i * 2) + 1];
    }

    try {
      const prediction = await this.spo2Model.predictSpO2(redSignal, irSignal);
      let spo2 = prediction.spo2;
      let confidence = prediction.confidence;

      this.spo2Buffer.push(spo2);
      if (this.spo2Buffer.length > this.SPO2_BUFFER_SIZE) {
        this.spo2Buffer.shift();
      }

      if (this.spo2Buffer.length > 0) {
        const sum = this.spo2Buffer.reduce((a, b) => a + b, 0);
        spo2 = Math.round(sum / this.spo2Buffer.length);
      }

      return { spo2, confidence };

    } catch (error) {
      console.error("SpO2Processor: Error predicting SpO2 with model:", error);
      return { spo2: 0, confidence: 0 };
    }
  }

  /**
   * Reset the SpO2 processor state
   */
  public reset(): void {
    this.spo2Buffer = [];
  }
}
