import * as tf from '@tensorflow/tfjs';
import { securityService } from '../../security/SecurityService';
import { dataAnonymizer } from '../../security/DataAnonymizer';

interface FederatedLearningConfig {
  serverUrl: string;
  modelName: string;
  minSamplesForUpdate: number;
  maxSamplesPerUpdate: number;
  privacyBudget: number; // For differential privacy
  compressionRatio?: number; // For model compression
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

    // Generate or retrieve client ID
    this.clientId = this.getOrCreateClientId();
    
    // Calculate noise scale based on privacy budget
    this.privacyNoiseScale = this.calculateNoiseScale(this.config.privacyBudget);
  }

  private getOrCreateClientId(): string {
    const STORAGE_KEY = 'federated_learning_client_id';
    let clientId = localStorage.getItem(STORAGE_KEY);
    
    if (!clientId) {
      // Generate a new client ID and store it
      clientId = `client_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).substr(2, 9)}`;
      localStorage.setItem(STORAGE_KEY, clientId);
    }
    
    return clientId;
  }

  private calculateNoiseScale(privacyBudget: number): number {
    // Higher privacy budget = less noise
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
      // Train the model on local data
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

      // Create a model update
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

      // Add differential privacy noise
      this.addPrivacyNoise(update);
      
      // Compress the update
      const compressedUpdate = this.compressUpdate(update);
      
      // Add to buffer
      this.updatesBuffer.push(compressedUpdate);
      
      // Check if we have enough samples to send an update
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
      // Generate random noise with the same shape as the weight tensor
      const noise = tf.randomNormal(
        weight.shape,
        0,
        this.privacyNoiseScale * Math.sqrt(update.numSamples)
      );
      
      // Add noise to the weight
      const noisyWeight = weight.add(noise);
      
      // Clean up
      tf.dispose(noise);
      tf.dispose(weight);
      
      update.weights[weightName] = noisyWeight;
    }
  }

  private compressUpdate(update: ModelUpdate): ModelUpdate {
    if (!this.config.compressionRatio || this.config.compressionRatio >= 1.0) {
      return update;
    }
    
    // Simple compression: only keep a fraction of the weights
    const compressedWeights: tf.NamedTensorMap = {};
    const weightNames = Object.keys(update.weights);
    
    for (const weightName of weightNames) {
      const weight = update.weights[weightName];
      const values = weight.dataSync();
      const compressedValues = new Float32Array(
        Math.ceil(values.length * this.config.compressionRatio!)
      );
      
      // Copy a subset of the weights
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
      // Aggregate updates if needed
      const aggregatedUpdate = this.aggregateUpdates();
      
      // Create anonymized update from aggregated weights
      const anonymizedUpdate = this.createAnonymizedUpdate(aggregatedUpdate);
      
      // Encrypt the update
      const encryptedUpdate = await this.encryptUpdate(anonymizedUpdate);
      
      // Send to server
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
      
      // Clear the buffer if successful
      this.updatesBuffer = [];
      
      // Check for model updates
      await this.checkForModelUpdates();
      
    } catch (error) {
      console.error('Failed to send update to server:', error);
      // Implement retry logic here
    }
  }

  private aggregateUpdates(): tf.NamedTensorMap {
    if (this.updatesBuffer.length === 1) {
      return this.updatesBuffer[0].weights;
    }
    
    // Simple federated averaging
    const totalSamples = this.updatesBuffer.reduce(
      (sum, update) => sum + update.numSamples, 0
    );
    
    const weightedUpdates = this.updatesBuffer.map(update => ({
      weights: update.weights,
      weight: update.numSamples / totalSamples
    }));

    // Initialize result object
    const result: tf.NamedTensorMap = {};
    
    // Get all weight names from the first update
    const weightNames = Object.keys(this.updatesBuffer[0].weights);
    
    // Weighted average of updates
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
          // Average metrics
          loss: this.updatesBuffer.reduce(
            (sum, update) => sum + (update.metadata.metrics?.loss || 0) * update.numSamples, 0
          ) / totalSamples
        }
      }, {}),
    };
  }

  private anonymizeUpdate(update: ModelUpdate): ModelUpdate {
    return {
      ...update,
      metadata: dataAnonymizer.anonymize(update.metadata, {
        removeFields: ['clientId'],
        pseudonymizeFields: ['clientId']
      })
    };
  }

  private async encryptUpdate(update: ModelUpdate): Promise<any> {
    // Convert tensors to arrays for JSON serialization
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
    
    // Encrypt the entire update
    return securityService.encryptData(serializableUpdate);
  }

  public async checkForModelUpdates(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.serverUrl}/api/models/${this.config.modelName}/latest`,
        {
          headers: {
            'X-Client-Id': this.clientId,
            'X-Client-Version': '1.0.0' // Current model version
          }
        }
      );
      
      if (!response.ok) {
        if (response.status === 304) {
          // No updates
          return false;
        }
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      // Download and apply the updated model
      const modelUpdate = await response.json();
      await this.applyModelUpdate(modelUpdate);
      
      return true;
      
    } catch (error) {
      console.error('Failed to check for model updates:', error);
      return false;
    }
  }

  private async applyModelUpdate(update: any): Promise<void> {
    // Verify the update (in a real app, verify the signature)
    if (!update.weights || !Array.isArray(update.weights)) {
      throw new Error('Invalid model update format');
    }
    
    // Convert arrays back to tensors
    const newWeights = update.weights.map((w: any) => {
      return tf.tensor(w.data, w.shape, w.dtype);
    });
    
    // Update the model weights
    this.model.setWeights(newWeights);
    
    // Clean up
    tf.dispose(newWeights);
    
    console.log('Model updated successfully');
  }

  public async startPeriodicUpdates(intervalMinutes: number = 60): Promise<void> {
    // Check for updates immediately
    await this.checkForModelUpdates();
    
    // Set up periodic checking
    setInterval(() => {
      this.checkForModelUpdates().catch(console.error);
    }, intervalMinutes * 60 * 1000);
    
    // Also check when the page becomes visible again
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.checkForModelUpdates().catch(console.error);
        }
      });
    }
  }

  public dispose(): void {
    // Clean up resources
    this.updatesBuffer.forEach(update => {
      const weightNames = Object.keys(update.weights);
      weightNames.forEach(name => update.weights[name].dispose());
    });
    this.updatesBuffer = [];
  }
}

// Helper function to create a federated learning service
export async function createFederatedLearningService(
  model: tf.LayersModel,
  config?: Partial<FederatedLearningConfig>
): Promise<FederatedLearningService> {
  const service = new FederatedLearningService(model, config);
  
  // Start periodic update checks
  service.startPeriodicUpdates().catch(console.error);
  
  return service;
}
