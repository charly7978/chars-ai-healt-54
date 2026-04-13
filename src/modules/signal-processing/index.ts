/**
 * Signal Processing Module - Exports
 */

export { AdvancedFingerTracker, type FingerTrackingResult } from './AdvancedFingerTracker';
export { AdaptiveROIMask, type ROIMaskResult, type TileMetrics } from './AdaptiveROIMask';
export { TilePulsatilityMap } from './TilePulsatilityMap';
export { AdaptiveROIAssembler } from './AdaptiveROIAssembler';
export { ContactStateMachine, type ContactMachineState } from './ContactStateMachine';
export { FrameAnalysisEngine, type FrameAnalysisResult } from './FrameAnalysisCore';
export { WorkerizedFramePipeline } from './WorkerizedFramePipeline';
export { CameraControlEngine } from './CameraControlEngine';
export { SignalQualityScorer } from './SignalQualityScorer';
export { SignalExtractionEngine } from './SignalExtractionEngine';
export { BandpassFilter } from './BandpassFilter';
export { PPGSignalProcessor } from './PPGSignalProcessor';
export { PressureProxyEstimator, type PressureState, type PressureEstimate } from './PressureProxyEstimator';
export { RingBuffer } from './RingBuffer';
export { SignalSourceRanker } from './SignalSourceRanker';
export { computeGlobalSQI } from './SignalQualityEstimator';
