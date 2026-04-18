import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

// UNIFIED Contact Taxonomy - Single source of truth
// Estados del clasificador + estados internos del pipeline
export type ContactState = 
  // Estados del clasificador de dedo
  | 'NO_FINGER'           // Sin dedo detectado
  | 'PARTIAL_CONTACT'     // Dedo presente pero mal posicionado
  | 'GOOD_CONTACT'        // Contacto adecuado
  | 'OVERPRESSURE'        // Presión excesiva detectada
  | 'UNDERILLUMINATED'    // Dedo presente pero muy oscuro
  | 'EXCESSIVE_CLIPPING'  // Saturación/alta presión
  | 'MOTION_CONTAMINATED' // Movimiento excesivo
  // Estados internos del pipeline (legacy compat)
  | 'NO_CONTACT'          // Alias interno de NO_FINGER
  | 'ACQUIRING_CONTACT'   // Transición inicial (alias PARTIAL_CONTACT)
  | 'UNSTABLE_CONTACT'    // Contacto inestable
  | 'STABLE_CONTACT'      // Contacto estable y óptimo
  | 'SATURATED_CONTACT'   // Alias de EXCESSIVE_CLIPPING
  | 'EXCESSIVE_PRESSURE'  // Alias de OVERPRESSURE
  | 'LOW_PERFUSION_CONTACT' // Perfusión baja
  | 'MOTION_CONTAMINATED_CONTACT'; // Alias legacy

// Alias para compatibilidad
export type FingerContactState = ContactState;

export interface ProcessedSignal {
  timestamp: number;
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  contactState: ContactState;
  motionArtifact?: boolean;
  roi: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  perfusionIndex?: number;
  rawRed?: number;
  rawGreen?: number;
  diagnostics?: {
    message: string;
    hasPulsatility: boolean;
    pulsatilityValue: number;
  };
  // Enhanced metrics from new pipeline
  clipHighRatio?: number;
  clipLowRatio?: number;
  spectralSNR?: number;
  peakProminence?: number;
  harmonicConsistency?: number;
  zeroCrossingRate?: number;
  temporalStability?: number;
  // Contact classifier metrics
  contactConfidence?: number;
  contactStateExtended?: ContactState;
  // Tile fusion metrics
  fusionConfidence?: number;
  effectiveTileCount?: number;
  validTileRatio?: number;
  tileWeightMap?: number[];
  dominantTileIndices?: number[];
  // Source ranking metrics
  sourceQuality?: number;
  sourceName?: string;
  // Frame quality gate
  gateScore?: number;
  rejectionReason?: string;
  // Calibration
  calibrationReady?: boolean;
  calibrationConfidence?: number;
  // Motion
  motionScore?: number;
}

export interface ProcessingError {
  code: string;
  message: string;
  timestamp: number;
}

export interface SignalProcessor {
  initialize: () => Promise<void>;
  start: () => void;
  stop: () => void;
  calibrate: () => Promise<boolean>;
  onSignalReady?: (signal: ProcessedSignal) => void;
  onError?: (error: ProcessingError) => void;
}

declare global {
  interface Window {
    heartBeatProcessor: HeartBeatProcessor;
  }
}
