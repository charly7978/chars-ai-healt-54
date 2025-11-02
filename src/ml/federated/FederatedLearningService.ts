/**
 * SERVICIO TEMPORALMENTE DESHABILITADO
 * Los tipos de TensorFlow no están disponibles en el proyecto actual
 * Este módulo se reactivará cuando se necesite funcionalidad de ML
 */

interface FederatedLearningConfig {
  serverUrl: string;
  modelName: string;
  minSamplesForUpdate: number;
  maxSamplesPerUpdate: number;
  privacyBudget: number;
  compressionRatio?: number;
}

export class FederatedLearningService {
  constructor(_model: any, _config: Partial<FederatedLearningConfig> = {}) {
    console.warn('FederatedLearningService: Módulo deshabilitado - TensorFlow no disponible');
  }

  public async trainOnClientData(): Promise<any> {
    console.warn('FederatedLearningService.trainOnClientData: Método deshabilitado');
    return { history: { loss: [], acc: [] } };
  }

  public async checkForModelUpdates(): Promise<boolean> {
    console.warn('FederatedLearningService.checkForModelUpdates: Método deshabilitado');
    return false;
  }

  public async startPeriodicUpdates(): Promise<void> {
    console.warn('FederatedLearningService.startPeriodicUpdates: Método deshabilitado');
  }

  public dispose(): void {
    // No-op
  }
}

export async function createFederatedLearningService(
  _model: any,
  _config?: Partial<FederatedLearningConfig>
): Promise<FederatedLearningService> {
  return new FederatedLearningService(_model, _config);
}
