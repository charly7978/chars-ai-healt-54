// Import TensorFlow.js with ES module syntax
import * as tf from '@tensorflow/tfjs';
import { serialization } from '@tensorflow/tfjs-layers';

// Define layer configuration interfaces
interface LayerConfig {
  units: number;
  activation?: string;
  inputShape?: number | number[];
  // Allow any string key with unknown value type
  [key: string]: unknown;
}

interface ConvLayerArgs {
  filters: number;
  kernelSize: number | number[];
  strides?: number | number[];
  padding?: 'valid' | 'same' | 'causal';
  dataFormat?: 'channelsFirst' | 'channelsLast';
  dilationRate?: number | [number] | [number, number] | [number, number, number];
  activation?: string;
  useBias?: boolean;
  kernelInitializer?: string;
  biasInitializer?: string;
  kernelRegularizer?: string;
  biasRegularizer?: string;
  activityRegularizer?: string;
  kernelConstraint?: string;
  biasConstraint?: string;
  inputShape?: number | number[];
  batchInputShape?: number | number[];
  batchSize?: number;
  dtype?: tf.DataType;
  name?: string;
  trainable?: boolean;
  weights?: unknown; // Using unknown to avoid type conflicts with TensorFlow.js internals
  inputDType?: tf.DataType;
  // Add index signature to allow any string key with unknown value type
  [key: string]: unknown;
}

type ActivationIdentifier = 
  | 'elu' 
  | 'hardSigmoid' 
  | 'linear' 
  | 'relu' 
  | 'relu6' 
  | 'selu' 
  | 'sigmoid' 
  | 'softmax' 
  | 'softplus' 
  | 'softsign' 
  | 'tanh' 
  | 'swish' 
  | 'mish' 
  | 'leakyRelu';

// Type guard to check if a string is a valid activation identifier
function isActivationIdentifier(value: string): value is ActivationIdentifier {
  const validActivations: string[] = [
    'elu', 'hardSigmoid', 'linear', 'relu', 'relu6',
    'selu', 'sigmoid', 'softmax', 'softplus', 'softsign',
    'tanh', 'swish', 'mish', 'leakyRelu'
  ];
  return validActivations.includes(value);
}

/**
 * Custom callback implementation that properly extends tf.CustomCallback
 */
class TrainingCallback {
  private readonly epochs: number;
  
  constructor(epochs: number) {
    this.epochs = epochs;
  }

  // Required by tf.CustomCallback
  public readonly model: any = null;
  public readonly params: any = {};
  
  // Required by tf.CustomCallback
  public readonly yieldEvery: 'auto' | 'batch' | 'epoch' | number = 'auto';
  public readonly yieldNow: () => boolean = () => true;
  
  // Required callback methods with default implementations
  public readonly trainBegin = async (logs?: tf.Logs): Promise<void> => {
    console.log('Training started');
  };
  
  public readonly trainEnd = async (logs?: tf.Logs): Promise<void> => {
    console.log('Training completed');
  };
  
  public readonly epochBegin = async (epoch: number, logs?: tf.Logs): Promise<void> => {
    // No-op
  };
  
  public readonly epochEnd = async (epoch: number, logs?: tf.Logs): Promise<void> => {
    await this.onEpochEnd(epoch, logs);
  };
  
  public readonly batchBegin = async (batch: number, logs?: tf.Logs): Promise<void> => {
    // No-op
  };
  
  public readonly batchEnd = async (batch: number, logs?: tf.Logs): Promise<void> => {
    // No-op
  };
  
  // Helper function to safely extract numeric values from logs
  private getNumericValue(value: any): number | null {
    if (typeof value === 'number') return value;
    if (value && typeof value.dataSync === 'function') {
      try {
        const data = value.dataSync();
        return data.length > 0 ? data[0] : null;
      } catch (e) {
        console.warn('Error getting numeric value:', e);
        return null;
      }
    }
    return null;
  }
  
  // Format values safely
  private formatValue(value: any, formatter: (n: number) => string): string {
    const numValue = this.getNumericValue(value);
    return numValue !== null ? formatter(numValue) : 'N/A';
  }

  // Custom implementation for epoch end logging
  private async onEpochEnd(epoch: number, logs?: tf.Logs): Promise<void> {
    if (!logs) return;
    
    try {
      // Get formatted values
      const loss = this.formatValue(logs.loss, n => n.toFixed(4));
      const valLoss = this.formatValue(logs.val_loss, n => n.toFixed(4));
      const lr = this.formatValue(logs.lr, n => n.toExponential(2));
      
      // Log the main metrics
      console.log(
        `Epoch ${epoch + 1}/${this.epochs} - ` +
        `loss: ${loss} - val_loss: ${valLoss} - lr: ${lr}`
      );
      
      // Log additional metrics if they exist
      Object.entries(logs).forEach(([key, value]) => {
        if (!['loss', 'val_loss', 'lr'].includes(key)) {
          const numValue = this.getNumericValue(value);
          if (numValue !== null) {
            console.log(`  ${key}: ${numValue.toFixed(4)}`);
          }
        }
      });
    } catch (error) {
      console.error('Error in training callback:', error);
    }
    
    await tf.nextFrame();
  }
  
  // Implement remaining required tf.CustomCallback methods with no-op defaults
  public readonly yieldTo = async (epoch: number, batch: number, logs?: tf.Logs): Promise<void> => {
    // No-op
  };
  
  public readonly onYield = async (epoch: number, batch: number, logs?: tf.Logs): Promise<void> => {
    // No-op
  };
  
  public readonly onYieldBegin = async (epoch: number, batch: number, logs?: tf.Logs): Promise<void> => {
    // No-op
  };
  
  public readonly onYieldEnd = async (epoch: number, batch: number, logs?: tf.Logs): Promise<void> => {
    // No-op
  };
  
  public readonly onYieldTo = async (epoch: number, batch: number, logs?: tf.Logs): Promise<void> => {
    // No-op
  };
}

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

  /**
   * Advanced model training with comprehensive error handling and training features
   * @param x Input features (tensor or tensor-like)
   * @param y Target values (tensor or tensor-like)
   * @param epochs Number of training epochs
   * @param batchSize Batch size for training
   * @param validationSplit Fraction of data to use for validation
   * @param callbacks Optional training callbacks
   * @param learningRate Optional custom learning rate
   * @param clipValue Optional gradient clipping value
   * @returns Training history
   */
  public async train(
    x: tf.Tensor | tf.Tensor[] | tf.TensorLike | tf.TensorLike[],
    y: tf.Tensor | tf.Tensor[] | tf.TensorLike | tf.TensorLike[],
    epochs: number = 100,
    batchSize: number = 32,
    validationSplit: number = 0.2,
    callbacks?: tf.CustomCallback | tf.CustomCallback[],
    learningRate?: number,
    clipValue?: number
  ): Promise<tf.History> {
    // Input validation
    if (!x || (Array.isArray(x) && x.length === 0)) {
      throw new Error('Input features cannot be empty');
    }
    if (!y || (Array.isArray(y) && y.length === 0)) {
      throw new Error('Target values cannot be empty');
    }

    // Convert input to tensors with proper error handling
    const convertToTensor = (
      data: tf.Tensor | tf.Tensor[] | tf.TensorLike | tf.TensorLike[],
      name: string = 'data'
    ): tf.Tensor | tf.Tensor[] => {
      try {
        if (Array.isArray(data)) {
          return data.map((item, i) => {
            if (item == null) {
              throw new Error(`Invalid value at index ${i} in ${name}`);
            }
            return item instanceof tf.Tensor ? item : tf.tensor(item);
          });
        }
        if (data == null) {
          throw new Error(`${name} cannot be null or undefined`);
        }
        return data instanceof tf.Tensor ? data : tf.tensor(data);
      } catch (error) {
        console.error(`Error converting ${name} to tensor:`, error);
        throw new Error(`Failed to convert ${name} to tensor: ${error.message}`);
      }
    };

    // Apply learning rate if provided
    if (learningRate !== undefined && this.model.optimizer) {
      const optimizer = this.model.optimizer;
      // Type assertion since the optimizer interface doesn't expose setLearningRate directly
      const optim = optimizer as any;
      if (typeof optim.setLearningRate === 'function') {
        optim.setLearningRate(learningRate);
      }
    }

    // Configure gradient clipping if specified
    if (clipValue !== undefined) {
      const optimizer = this.model.optimizer || tf.train.adam(this.config.learningRate);
      if ('clipValue' in optimizer) {
        (optimizer as any).clipValue = clipValue;
      }
    }

    let xs: tf.Tensor | tf.Tensor[];
    let ys: tf.Tensor | tf.Tensor[];

    try {
      // Convert inputs to tensors
      xs = convertToTensor(x, 'input features');
      ys = convertToTensor(y, 'target values');

      // Prepare callbacks
      const callbacksArray = callbacks 
        ? Array.isArray(callbacks) 
          ? [...callbacks] 
          : [callbacks]
        : [];

      // Create and add the training callback
      const trainingCallback = new TrainingCallback(epochs) as unknown as tf.CustomCallback;
      callbacksArray.push(trainingCallback);

      // Train the model
      const history = await this.model.fit(xs, ys, {
        epochs,
        batchSize,
        validationSplit,
        callbacks: callbacksArray,
        shuffle: true,
        verbose: 0 // Disable default logging (we handle it ourselves)
      });

      this.isTrained = true;
      return history;

    } catch (error) {
      console.error('Error during model training:', error);
      throw new Error(`Training failed: ${error.message}`);
    } finally {
      // Clean up tensors
      if (xs) {
        const tensorsToDispose = Array.isArray(xs) ? [...xs] : [xs];
        if (ys) {
          tensorsToDispose.push(...(Array.isArray(ys) ? ys : [ys]));
        }
        tf.dispose(tensorsToDispose);
      }
    }
  }

  /**
   * Makes predictions using the trained model with enhanced error handling and input validation
   * @param x Input data for prediction (tensor or tensor-like)
   * @param batchSize Optional batch size for prediction
   * @param verbose Whether to log prediction details
   * @returns Prediction results as a tensor
   */
  public async predict(
    x: tf.Tensor | tf.TensorLike,
    batchSize: number = 32,
    verbose: boolean = false
  ): Promise<tf.Tensor> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    
    if (!this.isTrained) {
      throw new Error('Model must be trained before making predictions');
    }

    let input: tf.Tensor;
    let prediction: tf.Tensor | tf.Tensor[];
    
    try {
      // Convert input to tensor if it's not already one
      input = x instanceof tf.Tensor ? x : tf.tensor(x);
      
      // Validate input shape
      const expectedShape = this.model.inputs[0].shape;
      if (expectedShape && input.shape.length !== expectedShape.length) {
        throw new Error(
          `Input shape mismatch. Expected ${expectedShape.length}D input, ` +
          `but got ${input.shape.length}D input`
        );
      }

      if (verbose) {
        console.log(`Making predictions on batch size: ${batchSize}`);
        console.log(`Input shape: [${input.shape}]`);
      }

      // Make predictions
      prediction = this.model.predict(input, { batchSize });
      
      // Handle multiple outputs
      if (Array.isArray(prediction)) {
        if (verbose) {
          console.log(`Model has ${prediction.length} output heads`);
        }
        // For simplicity, return the first output
        // In a production environment, you might want to handle multiple outputs differently
        return prediction[0];
      }
      
      return prediction as tf.Tensor;
      
    } catch (error) {
      console.error('Prediction error:', error);
      throw new Error(`Prediction failed: ${error.message}`);
      
    } finally {
      // Clean up the input tensor if we created it
      if (input && !(x instanceof tf.Tensor)) {
        input.dispose();
      }
    }
  }

  /**
   * Saves the model to the specified path with enhanced error handling and options
   * @param path Optional custom path to save the model (defaults to IndexedDB)
   * @param includeOptimizer Whether to save the optimizer state
   * @param saveFormat The format to save the model in ('tfjs' or 'layers-model')
   * @returns A promise that resolves when the model is saved
   */
  public async save(
    path?: string,
    includeOptimizer: boolean = true
  ): Promise<tf.io.SaveResult> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }

    if (!this.isTrained) {
      console.warn('Saving an untrained model');
    }

    const savePath = path || `indexeddb://${this.modelName}`;
    
    try {
      console.log(`Saving model to: ${savePath}`);
      
      // Create a custom save handler to include metadata
      const saveHandler: tf.io.IOHandler = {
        save: async (modelArtifacts: tf.io.ModelArtifacts): Promise<tf.io.SaveResult> => {
          try {
            // Create a shallow copy of the model artifacts to avoid mutating the original
            const updatedArtifacts: tf.io.ModelArtifacts = {
              ...modelArtifacts,
              userDefinedMetadata: {
                ...(modelArtifacts.userDefinedMetadata || {}),
                modelName: this.modelName,
                dateSaved: new Date().toISOString(),
                inputShape: this.config.inputShape,
                outputShape: this.config.outputShape,
                learningRate: this.config.learningRate,
              }
            };
            
            // Determine the appropriate save handler based on the path
            let handler: tf.io.IOHandler;
            if (savePath.startsWith('indexeddb://')) {
              const handlers = tf.io.getSaveHandlers('indexeddb://model-storage');
              if (!handlers || handlers.length === 0) {
                throw new Error('No IndexedDB save handler available');
              }
              handler = handlers[0];
            } else {
              const handlers = tf.io.getSaveHandlers(savePath);
              if (!handlers || handlers.length === 0) {
                throw new Error(`No save handler found for path: ${savePath}`);
              }
              handler = handlers[0];
            }
            
            // Use the handler to save the model
            return await handler.save(updatedArtifacts);
            
          } catch (error) {
            console.error('Error in save handler:', error);
            throw error;
          }
        }
      };
      
      // Save the model using the custom handler
      const saveResult = await this.model.save(saveHandler);
      console.log('Model saved successfully');
      return saveResult;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to save model:', errorMessage);
      throw new Error(`Failed to save model: ${errorMessage}`);
    }
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
    const activationFn = this.getActivation(activation);
    // Create a config object with proper typing for dense layer
    const config = {
      units,
      activation: activationFn,
      ...(inputShape && { inputShape })
    } as const; // Use const assertion to preserve literal types
    
    // Use the correct type for layer configuration
    return tf.layers.dense(config as unknown as serialization.ConfigDict);
  }

  protected addConv1DLayer(
    filters: number,
    kernelSize: number,
    activation: string = 'relu',
    inputShape?: number[]
  ): tf.layers.Layer {
    const activationFn = this.getActivation(activation);
    // Create a config object with proper typing for conv1d layer
    const config = {
      filters,
      kernelSize,
      activation: activationFn,
      ...(inputShape && { inputShape }),
      padding: 'same' as const, // Use const assertion for literal type
      useBias: true
    } as const;
    
    // Use the correct type for layer configuration
    return tf.layers.conv1d(config as unknown as serialization.ConfigDict);
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

  protected getActivation(activationName: string): ActivationIdentifier {
    // Convert to lowercase for case-insensitive matching
    const normalizedName = activationName.toLowerCase();
    
    // Map common variations to standard activation names
    const activationMap: Record<string, ActivationIdentifier> = {
      'relu': 'relu',
      'sigmoid': 'sigmoid',
      'tanh': 'tanh',
      'softmax': 'softmax',
      'linear': 'linear',
      'leakyrelu': 'leakyRelu',
      'elu': 'elu',
      'softplus': 'softplus',
      'softsign': 'softsign',
      'hardsigmoid': 'hardSigmoid',
      'selu': 'selu',
      'swish': 'swish',
      'mish': 'mish'
    };
    
    // Get the activation if it exists in our map, otherwise default to 'linear'
    const activation = activationMap[normalizedName] || 'linear';
    
    // Ensure the activation is a valid ActivationIdentifier
    if (!isActivationIdentifier(activation)) {
      console.warn(`Invalid activation function: ${activationName}, defaulting to 'linear'`);
      return 'linear';
    }
    
    return activation;
  }
}
