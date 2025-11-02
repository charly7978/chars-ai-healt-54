import * as tf from '@tensorflow/tfjs';
import { securityService } from '../../security/SecurityService';
import { dataAnonymizer } from '../../security/DataAnonymizer';

interface FederatedLearningConfig {
  serverUrl: string;
  modelName: string;
  minSamplesForUpdate: number;
  maxSamplesPerUpdate: number;
  privacyBudget: number;
  compressionRatio?: number;
}

type ModelUpdate = {
  weights: tf.NamedTensorMap;
  numSamples: number;
  metadata: {
    timestamp: number;
    clientId: string;
    metrics?: {
      loss: number;
      accuracy?: number;
    };
  };
};

export class FederatedLearningService {
  private config: FederatedLearningConfig;
  private model: tf.LayersModel;
  private updatesBuffer: ModelUpdate[] = [];
  private isTraining = false;
  private clientId: string;
  private privacyNoiseScale: number;

  constructor(model: tf.LayersModel, config: Partial<FederatedLearningConfig> = {}) {
    this.model = model;
    this.config = {
      serverUrl: 'https://federated-server.example.com',
      modelName: 'health-monitoring-model',
      minSamplesForUpdate: 50,
      maxSamplesPerUpdate: 1000,
      privacyBudget: 1.0,
      compressionRatio: 0.5,
      ...config
    };

    this.clientId = this.getOrCreateClientId();
    this.privacyNoiseScale = this.calculateNoiseScale(this.config.privacyBudget);
  }

  private getOrCreateClientId(): string {
    const STORAGE_KEY = 'federated_learning_client_id';
    let clientId = localStorage.getItem(STORAGE_KEY);
    
    if (!clientId) {
      const t = Date.now().toString(36);
      const p = (performance.now() | 0).toString(36);
      clientId = `client_${t}_${p}`;
      localStorage.setItem(STORAGE_KEY, clientId);
    }
    
    return clientId;
  }

  private calculateNoiseScale(privacyBudget: number): number {
    return 1.0 / (privacyBudget || 0.1);
  }

  public async trainOnClientData(
    x: tf.Tensor,
    y: tf.Tensor,
    epochs: number = 1,
    batchSize: number = 32,
    validationSplit: number = 0.1
  ): Promise<tf.History> {
    if (this.isTraining) {
      throw new Error('Training already in progress');
    }

    this.isTraining = true;
    
    try {
      const history = await this.model.fit(x, y, {
        epochs,
        batchSize,
        validationSplit,
        callbacks: {
          onEpochEnd: async (epoch, logs) => {
            console.log(`Epoch ${epoch + 1}: loss = ${logs?.loss?.toFixed(4)}`);
            await tf.nextFrame();
          }
        }
      });

      const modelWeights = this.model.getWeights();
      const namedWeights: tf.NamedTensorMap = {};
      modelWeights.forEach((weight, index) => {
        namedWeights[`weight_${index}`] = weight;
      });

      const update: ModelUpdate = {
        weights: namedWeights,
        numSamples: x.shape[0] as number,
        metadata: {
          timestamp: Date.now(),
          clientId: this.clientId,
          metrics: {
            loss: history.history.loss[history.history.loss.length - 1] as number,
            accuracy: history.history.acc?.[history.history.acc.length - 1] as number
          }
        }
      };

      this.addPrivacyNoise(update);
      const compressedUpdate = this.compressUpdate(update);
      this.updatesBuffer.push(compressedUpdate);
      
      if (this.shouldSendUpdate()) {
        await this.sendUpdateToServer();
      }

      return history;
    } finally {
      this.isTraining = false;
    }
  }

  private addPrivacyNoise(update: ModelUpdate): void {
    if (this.privacyNoiseScale <= 0) return;
    
    const weightNames = Object.keys(update.weights);
    for (const weightName of weightNames) {
      const weight = update.weights[weightName];
      const noise = tf.randomNormal(
        weight.shape,
        0,
        this.privacyNoiseScale * Math.sqrt(update.numSamples)
      );
      
      const noisyWeight = weight.add(noise);
      
      tf.dispose(noise);
      tf.dispose(weight);
      
      update.weights[weightName] = noisyWeight;
    }
  }

  private compressUpdate(update: ModelUpdate): ModelUpdate {
    if (!this.config.compressionRatio || this.config.compressionRatio >= 1.0) {
      return update;
    }
    
    const compressedWeights: tf.NamedTensorMap = {};
    const weightNames = Object.keys(update.weights);
    
    for (const weightName of weightNames) {
      const weight = update.weights[weightName];
      const values = weight.dataSync();
      const compressedValues = new Float32Array(
        Math.ceil(values.length * this.config.compressionRatio!)
      );
      
      for (let i = 0; i < compressedValues.length; i++) {
        compressedValues[i] = values[Math.floor(i / this.config.compressionRatio!)];
      }
      
      compressedWeights[weightName] = tf.tensor(
        compressedValues,
        [compressedValues.length],
        weight.dtype
      );
    }
    
    return {
      ...update,
      weights: compressedWeights
    };
  }

  private shouldSendUpdate(): boolean {
    const totalSamples = this.updatesBuffer.reduce(
      (sum, update) => sum + update.numSamples, 0
    );
    
    return totalSamples >= this.config.minSamplesForUpdate;
  }

  private async sendUpdateToServer(): Promise<void> {
    if (this.updatesBuffer.length === 0) return;
    
    try {
      const aggregatedUpdate = this.aggregateUpdates();
      const anonymizedUpdate = this.createAnonymizedUpdate(aggregatedUpdate);
      const encryptedUpdate = await this.encryptUpdate(anonymizedUpdate);
      
      const response = await fetch(`${this.config.serverUrl}/api/updates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Model-Name': this.config.modelName,
          'X-Client-Id': this.clientId
        },
        body: JSON.stringify(encryptedUpdate)
      });
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      this.updatesBuffer = [];
      await this.checkForModelUpdates();
      
    } catch (error) {
      console.error('Failed to send update to server:', error);
    }
  }

  private aggregateUpdates(): tf.NamedTensorMap {
    if (this.updatesBuffer.length === 1) {
      return this.updatesBuffer[0].weights;
    }
    
    const totalSamples = this.updatesBuffer.reduce(
      (sum, update) => sum + update.numSamples, 0
    );
    
    const weightedUpdates = this.updatesBuffer.map(update => ({
      weights: update.weights,
      weight: update.numSamples / totalSamples
    }));

    const result: tf.NamedTensorMap = {};
    const weightNames = Object.keys(this.updatesBuffer[0].weights);
    
    for (const weightName of weightNames) {
      const firstUpdate = weightedUpdates[0];
      let weightedSum = tf.mul(firstUpdate.weights[weightName], firstUpdate.weight);
      
      for (let j = 1; j < weightedUpdates.length; j++) {
        const update = weightedUpdates[j];
        weightedSum = tf.add(weightedSum, tf.mul(update.weights[weightName], update.weight));
      }
      
      result[weightName] = weightedSum;
    }
    
    return result;
  }

  private createAnonymizedUpdate(update: tf.NamedTensorMap): ModelUpdate {
    const totalSamples = this.updatesBuffer.reduce((sum, update) => sum + update.numSamples, 0);
    return {
      weights: update,
      numSamples: totalSamples,
      metadata: dataAnonymizer.anonymize({
        timestamp: Date.now(),
        clientId: this.clientId,
        metrics: {
          loss: this.updatesBuffer.reduce(
            (sum, update) => sum + (update.metadata.metrics?.loss || 0) * update.numSamples, 0
          ) / totalSamples
        }
      }, {}),
    };
  }

  private async encryptUpdate(update: ModelUpdate): Promise<any> {
    const weightNames = Object.keys(update.weights);
    const serializableWeights = weightNames.map(name => ({
      name,
      shape: update.weights[name].shape,
      dtype: update.weights[name].dtype,
      data: Array.from(update.weights[name].dataSync())
    }));

    const serializableUpdate = {
      ...update,
      weights: serializableWeights
    };
    
    return securityService.encryptData(serializableUpdate);
  }

  public async checkForModelUpdates(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.serverUrl}/api/models/${this.config.modelName}/latest`,
        {
          headers: {
            'X-Client-Id': this.clientId,
            'X-Client-Version': '1.0.0'
          }
        }
      );
      
      if (!response.ok) {
        if (response.status === 304) {
          return false;
        }
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      const modelUpdate = await response.json();
      await this.applyModelUpdate(modelUpdate);
      
      return true;
      
    } catch (error) {
      console.error('Failed to check for model updates:', error);
      return false;
    }
  }

  private async applyModelUpdate(update: any): Promise<void> {
    if (!update.weights || !Array.isArray(update.weights)) {
      throw new Error('Invalid model update format');
    }
    
    const newWeights = update.weights.map((w: any) => {
      return tf.tensor(w.data, w.shape, w.dtype);
    });
    
    this.model.setWeights(newWeights);
    tf.dispose(newWeights);
    
    console.log('Model updated successfully');
  }

  public async startPeriodicUpdates(intervalMinutes: number = 60): Promise<void> {
    await this.checkForModelUpdates();
    
    setInterval(() => {
      this.checkForModelUpdates().catch(console.error);
    }, intervalMinutes * 60 * 1000);
    
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.checkForModelUpdates().catch(console.error);
        }
      });
    }
  }

  public dispose(): void {
    this.updatesBuffer.forEach(update => {
      const weightNames = Object.keys(update.weights);
      weightNames.forEach(name => update.weights[name].dispose());
    });
    this.updatesBuffer = [];
  }
}

export async function createFederatedLearningService(
  model: tf.LayersModel,
  config?: Partial<FederatedLearningConfig>
): Promise<FederatedLearningService> {
  const service = new FederatedLearningService(model, config);
  service.startPeriodicUpdates().catch(console.error);
  return service;
}
