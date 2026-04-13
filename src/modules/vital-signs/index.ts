/**
 * Vital Signs Module - Exports
 */

export { AdvancedArrhythmiaDetector } from './AdvancedArrhythmiaDetector';
export { HRVNonlinearAnalyzer, type NonlinearHRVResult } from './HRVNonlinearAnalyzer';
export { HRVFrequencyAnalyzer, type FrequencyHRVResult } from './HRVFrequencyAnalyzer';
export { ArrhythmiaProcessor } from './arrhythmia-processor';
export { RhythmClassifier, type RhythmLabel, type RhythmEvent, type RhythmResult, type RhythmFeatures } from './RhythmClassifier';
export { VitalSignsProcessor, type VitalSignsResult, type RGBData } from './VitalSignsProcessor';
export { BloodPressureProcessor } from './BloodPressureProcessor';
export { SpO2Processor, type SpO2Result } from './SpO2Processor';
export { PPGFeatureExtractor } from './PPGFeatureExtractor';
export { BPCalibrationManager } from './BPCalibrationManager';
export { SpO2Calibrator } from './SpO2Calibrator';
export { ratioOfRatios } from './OpticalRatioEngine';

// Types adicionales del detector avanzado
export type { 
  ArrhythmiaType, 
  ArrhythmiaEvent, 
  ArrhythmiaFeatures, 
  PPGMorphology, 
  ArrhythmiaResult 
} from './AdvancedArrhythmiaDetector';
