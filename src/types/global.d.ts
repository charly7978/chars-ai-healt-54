// Declaraciones para módulos que no tienen tipos
declare module 'crypto-js' {
  export * from 'crypto-js/index';
}

declare module '@tensorflow/tfjs' {
  export * from '@tensorflow/tfjs-core';
  export * from '@tensorflow/tfjs-layers';
  export * from '@tensorflow/tfjs-converter';
  export * from '@tensorflow/tfjs-backend-webgl';
  export * from '@tensorflow/tfjs-backend-cpu';
  export * from '@tensorflow/tfjs-backend-webgpu';
}

declare module 'rxjs' {
  export * from 'rxjs/index';
}

declare module 'rxjs/operators' {
  export * from 'rxjs/operators/index';
}

// Interfaz para el modelo de TensorFlow.js
interface ModelArtifacts {
  modelTopology?: {} | ArrayBuffer;
  weightSpecs?: {}[];
  weightData?: ArrayBuffer;
  format?: string;
  generatedBy?: string;
  convertedBy?: string;
  userDefinedMetadata?: {};
  modelInitializer?: {};
  trainingConfig?: {};
}

// Extender la interfaz global para incluir las propiedades del modelo
interface Window {
  tf: typeof import('@tensorflow/tfjs');
}
