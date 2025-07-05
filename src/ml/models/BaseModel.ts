// Import TensorFlow.js with ES module syntax
import * as tf from '@tensorflow/tfjs';

// Type aliases for TensorFlow.js types
type Tensor = tf.Tensor;
type Rank = tf.Rank;
type TensorLike = tf.Tensor | tf.TensorLike;
interface LayersModel extends tf.LayersModel {}
interface Sequential extends tf.Sequential {}
interface CustomCallback extends tf.CustomCallback {}
interface History extends tf.History {}

export interface ModelConfig {
  inputShape: number[];
  outputShape: number[];
  learningRate?: number;
  modelUrl?: string;
}

export abstract class BaseModel {
  protected model: tf.LayersModel | tf.Sequential;
  protected config: ModelConfig;
  protected isTrained: boolean = false;
  protected modelName: string;

  constructor(config: ModelConfig, modelName: string) {
    this.config = {
      learningRate: 0.001,
      ...config
    };
    this.modelName = modelName;
    this.model = this.buildModel();
  }

  protected abstract buildModel(): tf.LayersModel | tf.Sequential;

  public async train(
    x: tf.Tensor | tf.Tensor[] | tf.TensorLike | tf.TensorLike[],
    y: tf.Tensor | tf.Tensor[] | tf.TensorLike | tf.TensorLike[],
    epochs: number = 10,
    batchSize: number = 32,
    validationSplit: number = 0.2,
    callbacks?: tf.CustomCallback[] | tf.CustomCallback
  ): Promise<tf.History> {
    // Convert input to tensors if they're not already
    const convertToTensor = (data: tf.Tensor | tf.Tensor[] | tf.TensorLike | tf.TensorLike[]): tf.Tensor | tf.Tensor[] => {
      if (Array.isArray(data)) {
        return data.map(item => item instanceof tf.Tensor ? item : tf.tensor(item));
      }
      return data instanceof tf.Tensor ? data : tf.tensor(data);
    };

    const xs = convertToTensor(x);
    const ys = convertToTensor(y);

    // Ensure callbacks is an array
    const callbacksArray = callbacks 
      ? Array.isArray(callbacks) 
        ? [...callbacks] 
        : [callbacks]
      : [];

    const history = await this.model.fit(xs, ys, {
      epochs,
      batchSize,
      validationSplit,
      callbacks: [
        {
          onEpochEnd: async (epoch, logs) => {
            const lossValue = typeof logs?.loss === 'number' ? logs.loss : logs?.loss?.dataSync?.()[0];
            console.log(`Epoch ${epoch}: loss = ${lossValue?.toFixed(4)}`);
            await tf.nextFrame();
          }
        } as tf.CustomCallback,
        ...callbacksArray
      ]
    });

    this.isTrained = true;
    tf.dispose([xs, ys]);
    return history;
  }

  public async predict(x: tf.Tensor | tf.TensorLike): Promise<tf.Tensor> {
    if (!this.isTrained) {
      throw new Error('Model must be trained before making predictions');
    }
    const input = x instanceof tf.Tensor ? x : tf.tensor(x);
    const prediction = this.model.predict(input);
    if (Array.isArray(prediction)) {
      // Return the first output if model has multiple outputs
      return prediction[0];
    }
    return prediction as tf.Tensor;
  }

  public async save(): Promise<tf.io.SaveResult> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    return await this.model.save(`indexeddb://${this.modelName}`);
  }

  public async load(): Promise<void> {
    try {
      const models = await tf.io.listModels();
      if (models[`indexeddb://${this.modelName}`]) {
        this.model = await tf.loadLayersModel(`indexeddb://${this.modelName}`);
        this.isTrained = true;
        console.log(`${this.modelName} model loaded successfully`);
      }
    } catch (error) {
      console.error(`Error loading ${this.modelName} model:`, error);
      throw error;
    }
  }

  public dispose(): void {
    if (this.model) {
      this.model.dispose();
    }
  }

  public getModelSummary(): void {
    this.model.summary();
  }

  protected addDenseLayer(
    units: number,
    activation: string = 'relu',
    inputShape?: number[]
  ): tf.layers.Layer {
    return tf.layers.dense({
      units,
      activation: this.getActivation(activation),
      ...(inputShape && { inputShape })
    });
  }

  protected addConv1DLayer(
    filters: number,
    kernelSize: number,
    activation: string = 'relu',
    inputShape?: number[]
  ): tf.layers.Layer {
    return tf.layers.conv1d({
      filters,
      kernelSize,
      activation: this.getActivation(activation),
      ...(inputShape && { inputShape })
    });
  }

  protected addLSTMLayer(
    units: number,
    returnSequences: boolean = false,
    inputShape?: number[]
  ): tf.layers.Layer {
    return tf.layers.lstm({
      units,
      returnSequences,
      ...(inputShape && { inputShape })
    });
  }

  protected addDropout(rate: number): tf.layers.Layer {
    return tf.layers.dropout({ rate });
  }

  protected addBatchNormalization(): tf.layers.Layer {
    return tf.layers.batchNormalization();
  }

  protected getActivation(activationName: string): tf.serialization.ConfigDictValue {
    // Map activation names to their corresponding string identifiers
    const activationMap: Record<string, string> = {
      'relu': 'relu',
      'sigmoid': 'sigmoid',
      'tanh': 'tanh',
      'softmax': 'softmax',
      'linear': 'linear',
      'leakyRelu': 'leakyRelu',
      'elu': 'elu',
      'softplus': 'softplus',
      'softsign': 'softsign',
      'hardSigmoid': 'hardSigmoid',
      'selu': 'selu',
      'swish': 'swish',
      'mish': 'mish'
    };
    
    const activation = activationMap[activationName.toLowerCase()] || 'linear';
    return tf.layers.activation({activation}).getConfig();
  }
}
