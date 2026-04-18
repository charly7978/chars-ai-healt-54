/**
 * VITAL SIGNS MODULE - V2 EXPORTS
 */

export { RhythmClassifierV2, type RhythmLabelV2, type RhythmEvidence } from './RhythmClassifierV2';
export { SpO2ProcessorV2, type SpO2Calibration } from './SpO2ProcessorV2';
export { BloodPressureProcessorV2, type BPFeatureVector } from './BloodPressureProcessorV2';

// Legacy exports for backward compatibility
export { RhythmClassifier } from './RhythmClassifier';
export { SpO2Processor, type SpO2Result } from './SpO2Processor';
export { BloodPressureProcessor, type BPEstimate } from './BloodPressureProcessor';
export { ArrhythmiaProcessor } from './arrhythmia-processor';
export { PPGFeatureExtractor } from './PPGFeatureExtractor';
export { VitalSignsProcessor, type VitalSignsResult, type RGBData } from './VitalSignsProcessor';
