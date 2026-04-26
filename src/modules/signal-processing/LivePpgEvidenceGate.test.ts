/**
 * TESTS NEGATIVOS PARA LIVE_PPG_EVIDENCE_GATE
 * 
 * Estos tests validan que el gate rechaza correctamente casos de ruido,
 * señales falsas y condiciones que no representan PPG viva real.
 * 
 * REGLA MADRE: Si no hay evidencia matemática fuerte de PPG viva,
 * el gate debe retornar passed=false con hardFail=true o score bajo.
 */

import { describe, it, expect } from 'vitest';
import { livePpgEvidenceGate, type LivePpgEvidenceInput } from './LivePpgEvidenceGate';

describe('LivePpgEvidenceGate - FAIL-CLOSED Tests', () => {
  
  describe('HARD FAILS - Rechazo inmediato', () => {
    
    it('debe rechazar cuando sampleRate < 15 fps', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 14.9,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { score: 0.8, gating: 'accept_high_confidence' },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('SAMPLE_RATE_TOO_LOW'));
    });
    
    it('debe rechazar cuando clipHighRatio >= 0.15', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0.15,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { score: 0.8, gating: 'accept_high_confidence' },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('HIGH_CLIP_SEVERE'));
    });
    
    it('debe rechazar cuando perfusionIndex < 0.20', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.19,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { score: 0.8, gating: 'accept_high_confidence' },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('PERFUSION_TOO_LOW'));
    });
    
    it('debe rechazar cuando windowSQI.score < 0.55', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { score: 0.54, gating: 'accept' },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('WINDOW_SQI_TOO_LOW'));
    });
    
    it('debe rechazar cuando acceptedBeats < 4', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { score: 0.8, gating: 'accept_high_confidence' },
        beatDebug: {
          acceptedBeats: 3,
          consecutivePeaks: 3,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('ACCEPTED_BEATS_TOO_LOW'));
    });
    
    it('debe rechazar cuando backgroundCorrelation > 0.60', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { score: 0.8, gating: 'accept_high_confidence' },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        },
        roiEvidence: {
          activeCellCount: 5,
          spatialCoherence: 0.6,
          phaseCoherence: 0.6,
          roiReputation: 0.8,
          backgroundCorrelation: 0.61,
          topRoiToBackgroundPowerRatio: 2.0
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('BACKGROUND_CORRELATION_TOO_HIGH'));
    });
    
    it('debe rechazar cuando contactState es NO_CONTACT', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'NO_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { score: 0.8, gating: 'accept_high_confidence' },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('CONTACT_STATE_INVALID'));
    });
    
    it('debe rechazar cuando motionArtifact > 0.5', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.51,
        sourceStability: 0.8,
        windowSQI: { score: 0.8, gating: 'accept_high_confidence' },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('MOTION_ARTIFACT_HIGH'));
    });
    
    it('debe rechazar cuando frecuencia dominante está fuera de banda cardíaca', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { 
          score: 0.8, 
          gating: 'accept_high_confidence',
          spectral: {
            dominantFrequencyHz: 0.5, // Fuera de banda (muy bajo)
            spectralDominanceScore: 0.6,
            detectorAgreementScore: 0.6,
            dominantFrequencyStability: 0.6
          }
        },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('DOMINANT_FREQ_OUT_OF_BAND'));
    });
  });
  
  describe('CASOS NEGATIVOS - Ruido y señales falsas', () => {
    
    it('debe rechazar señal de aire (sin perfusión)', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 10,
        perfusionIndex: 0.05, // Casi sin perfusión
        clipHighRatio: 0.02,
        clipLowRatio: 0.02,
        motionArtifact: 0.05,
        sourceStability: 0.9,
        windowSQI: { score: 0.3, gating: 'reject' },
        beatDebug: {
          acceptedBeats: 0,
          consecutivePeaks: 0,
          avgBeatSQI: 0,
          avgMorphologyScore: 0,
          avgDetectorAgreement: 0,
          temporalSpectralAgreement: 0,
          spectralConfidence: 0,
          medianRRBpm: 0,
          spectralBpm: 0,
          autocorrBpm: 0
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
    });
    
    it('debe rechazar señal de sábana roja (alta correlación de fondo)', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 40,
        perfusionIndex: 0.25,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.7,
        windowSQI: { score: 0.5, gating: 'accept' },
        beatDebug: {
          acceptedBeats: 5,
          consecutivePeaks: 5,
          avgBeatSQI: 50,
          avgMorphologyScore: 50,
          avgDetectorAgreement: 0.5,
          temporalSpectralAgreement: 0.5,
          spectralConfidence: 0.5,
          medianRRBpm: 70,
          spectralBpm: 70,
          autocorrBpm: 70
        },
        roiEvidence: {
          activeCellCount: 5,
          spatialCoherence: 0.4,
          phaseCoherence: 0.4,
          roiReputation: 0.5,
          backgroundCorrelation: 0.85, // Muy alta - señal global
          topRoiToBackgroundPowerRatio: 1.2 // Baja diferenciación
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
    });
    
    it('debe rechazar luz oscilante (frecuencia fuera de banda)', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 60,
        perfusionIndex: 0.35,
        clipHighRatio: 0.05,
        clipLowRatio: 0.05,
        motionArtifact: 0.1,
        sourceStability: 0.8,
        windowSQI: { 
          score: 0.7, 
          gating: 'accept',
          spectral: {
            dominantFrequencyHz: 10, // 10 Hz = 600 BPM - imposible
            spectralDominanceScore: 0.8,
            detectorAgreementScore: 0.8,
            dominantFrequencyStability: 0.8
          }
        },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 70,
          avgMorphologyScore: 70,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 600,
          spectralBpm: 600,
          autocorrBpm: 600
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
    });
    
    it('debe rechazar cámara tapada (sin señal)', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'NO_CONTACT',
        extendedContactState: 'INSUFFICIENT_SIGNAL',
        quality: 0,
        perfusionIndex: 0,
        clipHighRatio: 0,
        clipLowRatio: 0,
        motionArtifact: 0,
        sourceStability: 0,
        windowSQI: { score: 0, gating: 'reject' },
        beatDebug: {
          acceptedBeats: 0,
          consecutivePeaks: 0,
          avgBeatSQI: 0,
          avgMorphologyScore: 0,
          avgDetectorAgreement: 0,
          temporalSpectralAgreement: 0,
          spectralConfidence: 0,
          medianRRBpm: 0,
          spectralBpm: 0,
          autocorrBpm: 0
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.hardFail).toBe(true);
    });
    
    it('debe rechazar ruido sintético (alta variabilidad sin estructura)', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 20,
        perfusionIndex: 0.15,
        clipHighRatio: 0.1,
        clipLowRatio: 0.1,
        motionArtifact: 0.4,
        sourceStability: 0.3,
        windowSQI: { 
          score: 0.4, 
          gating: 'reject',
          spectral: {
            spectralDominanceScore: 0.2, // Baja dominancia
            detectorAgreementScore: 0.2,
            dominantFrequencyStability: 0.2
          }
        },
        beatDebug: {
          acceptedBeats: 2,
          consecutivePeaks: 2,
          avgBeatSQI: 30,
          avgMorphologyScore: 30,
          avgDetectorAgreement: 0.3,
          temporalSpectralAgreement: 0.3,
          spectralConfidence: 0.3,
          medianRRBpm: 80,
          spectralBpm: 80,
          autocorrBpm: 80
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
    });
  });
  
  describe('CASO POSITIVO - Señal PPG válida', () => {
    
    it('debe aceptar señal PPG de alta calidad', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 70,
        perfusionIndex: 0.45,
        clipHighRatio: 0.03,
        clipLowRatio: 0.03,
        motionArtifact: 0.05,
        sourceStability: 0.85,
        windowSQI: { 
          score: 0.8, 
          gating: 'accept_high_confidence',
          spectral: {
            dominantFrequencyHz: 1.25, // 75 BPM
            spectralDominanceScore: 0.7,
            detectorAgreementScore: 0.75,
            dominantFrequencyStability: 0.7
          }
        },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 75,
          avgMorphologyScore: 75,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        },
        roiEvidence: {
          activeCellCount: 8,
          spatialCoherence: 0.7,
          phaseCoherence: 0.7,
          roiReputation: 0.9,
          backgroundCorrelation: 0.3,
          topRoiToBackgroundPowerRatio: 3.5
        }
      };
      
      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(true);
      expect(result.tier).toBe('VALID_LIVE_PPG');
      expect(result.score).toBeGreaterThanOrEqual(0.78);
    });
  });
  
  describe('PÉRDIDA DE CONTACTO - Reset de evidencia', () => {
    
    it('debe rechazar cuando cambia a estado inválido', () => {
      const inputValid: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 70,
        perfusionIndex: 0.45,
        clipHighRatio: 0.03,
        clipLowRatio: 0.03,
        motionArtifact: 0.05,
        sourceStability: 0.85,
        windowSQI: { 
          score: 0.8, 
          gating: 'accept_high_confidence',
          spectral: {
            dominantFrequencyHz: 1.25,
            spectralDominanceScore: 0.7,
            detectorAgreementScore: 0.75,
            dominantFrequencyStability: 0.7
          }
        },
        beatDebug: {
          acceptedBeats: 10,
          consecutivePeaks: 10,
          avgBeatSQI: 75,
          avgMorphologyScore: 75,
          avgDetectorAgreement: 0.8,
          temporalSpectralAgreement: 0.8,
          spectralConfidence: 0.8,
          medianRRBpm: 75,
          spectralBpm: 75,
          autocorrBpm: 75
        }
      };
      
      const resultValid = livePpgEvidenceGate.evaluate(inputValid);
      expect(resultValid.passed).toBe(true);
      
      const inputInvalid: LivePpgEvidenceInput = {
        ...inputValid,
        contactState: 'NO_CONTACT',
        extendedContactState: 'INSUFFICIENT_SIGNAL'
      };
      
      const resultInvalid = livePpgEvidenceGate.evaluate(inputInvalid);
      expect(resultInvalid.passed).toBe(false);
      expect(resultInvalid.hardFail).toBe(true);
    });
  });
});
