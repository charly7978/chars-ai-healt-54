/**
 * MODELO TEMPORALMENTE DESHABILITADO
 * Los tipos de TensorFlow no están disponibles en el proyecto actual
 * Este módulo se reactivará cuando se necesite funcionalidad de ML
 */

export interface BloodPressureModelConfig {
  signalLength: number;
  samplingRate: number;
  learningRate?: number;
  batchSize?: number;
  epochs?: number;
}

export class BloodPressureModel {
  private config: BloodPressureModelConfig;

  constructor(config: BloodPressureModelConfig) {
    this.config = config;
    console.warn('BloodPressureModel: Módulo deshabilitado - TensorFlow no disponible');
  }

  public async predictBloodPressure(
    _ppgSignal: Float32Array,
    _ecgSignal?: Float32Array,
    _preprocess: boolean = true
  ): Promise<{
    systolic: number;
    diastolic: number;
    map: number;
    confidence: number;
    features: any;
  }> {
    console.warn('BloodPressureModel.predictBloodPressure: Método deshabilitado');
    return {
      systolic: 0,
      diastolic: 0,
      map: 0,
      confidence: 0,
      features: {}
    };
  }

  public async save(): Promise<void> {
    // No-op
  }

  public async load(): Promise<void> {
    // No-op
  }

  public dispose(): void {
    // No-op
  }
}
