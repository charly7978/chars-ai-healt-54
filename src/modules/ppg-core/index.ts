/**
 * PPG CORE - Módulos de procesamiento PPG avanzado
 * 
 * Basado en literatura científica:
 * - Chakraborty et al., Symmetry 2022 (HDEM)
 * - PMC5597264 (Multi-SQI)
 * - Frontiers Digital Health 2023 (ZLO Calibration)
 * - IEEE EMBC 2024 (Optimal Bandpass)
 * - Nature Digital Medicine (Smartphone PPG)
 */

export { HilbertTransform } from './HilbertTransform';
export type { HilbertResult } from './HilbertTransform';

export { MultiSQIValidator } from './MultiSQIValidator';
export type { SQIResult, ConfidenceLevel } from './MultiSQIValidator';

export { RGBCalibrator } from './RGBCalibrator';
export type { RGBCalibration, CalibratedRGB } from './RGBCalibrator';

export { PeakDetectorHDEM } from './PeakDetectorHDEM';
export type { Peak, PeakDetectionResult } from './PeakDetectorHDEM';

export { AdaptiveBandpass } from './AdaptiveBandpass';

export { PPGPipeline } from './PPGPipeline';
export type { 
  PPGReading, 
  ProcessedPPGFrame, 
  PipelineState, 
  PipelineEvent,
  PipelineEventType 
} from './PPGPipeline';
