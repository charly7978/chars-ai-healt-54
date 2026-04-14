/**
 * Vital Signs Module - Exports
 */

export { AdvancedArrhythmiaDetector } from './AdvancedArrhythmiaDetector';
export { HRVNonlinearAnalyzer, type NonlinearHRVResult } from './HRVNonlinearAnalyzer';
export { HRVFrequencyAnalyzer, type FrequencyHRVResult } from './HRVFrequencyAnalyzer';
export { SpO2ProcessorElite, type SpO2ResultElite } from './SpO2ProcessorElite';
export { BloodPressureProcessorElite, type BPEstimateElite } from './BloodPressureProcessorElite';
export { ArrhythmiaProcessor } from './arrhythmia-processor';
export { RhythmClassifier, type RhythmLabel, type RhythmEvent, type RhythmResult, type RhythmFeatures } from './RhythmClassifier';
export { VitalSignsProcessor, type VitalSignsResult, type RGBData } from './VitalSignsProcessor';
/** Tipos legacy para compatibilidad - runtime principal usa *ProcessorElite vía VitalSignsProcessor */
export type { SpO2Result, BPEstimate } from './types';
export { mapEliteSpO2ToDetail } from './spo2EliteAdapter';
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
