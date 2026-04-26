/**
 * NEGATIVE INPUT TESTS - FAIL-CLOSED VALIDATION
 * 
 * Estos tests verifican que el sistema rechace correctamente entradas no humanas
 * y que no publique ningún signo vital sin evidencia PPG viva real.
 */

import { livePpgEvidenceGate, type LivePpgEvidenceInput } from '../modules/signal-processing/LivePpgEvidenceGate';

describe('Negative Input Tests - Fail-Closed Validation', () => {
  
  describe('Test 1: Air (No Finger)', () => {
    it('should reject when camera points to air with no tissue', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'NO_CONTACT',
        extendedContactState: 'NO_CONTACT',
        quality: 0,
        perfusionIndex: 0,
        clipHighRatio: 0,
        clipLowRatio: 0,
        motionArtifact: 0,
        sourceStability: 0,
        windowSQI: {
          score: 0,
          gating: 'reject',
          spectral: {
            dominantFrequencyHz: 0,
            spectralDominanceScore: 0,
            detectorAgreementScore: 0,
            dominantFrequencyStability: 0,
          }
        },
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
          autocorrBpm: 0,
        }
      };

      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
      expect(result.hardFail).toBe(true);
      expect(result.reasons).toContain('CONTACT_STATE_INVALID: NO_CONTACT');
    });
  });

  describe('Test 2: Red Sheet (Non-Pulsatile Surface)', () => {
    it('should reject when camera points to static red surface', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'MATERIAL_SIGNAL',
        extendedContactState: 'MATERIAL_SIGNAL',
        quality: 5,
        perfusionIndex: 0.05, // Very low - no perfusion
        clipHighRatio: 0,
        clipLowRatio: 0,
        motionArtifact: 0,
        sourceStability: 0.95, // Very stable - static surface
        windowSQI: {
          score: 0.1,
          gating: 'reject',
          spectral: {
            dominantFrequencyHz: 0, // No dominant frequency
            spectralDominanceScore: 0.05, // Very low - no pulsatile signal
            detectorAgreementScore: 0.1,
            dominantFrequencyStability: 0,
          }
        },
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
          autocorrBpm: 0,
        },
        multichannelEvidence: {
          channelCoherence: 0.2, // Low coherence - noise
          acDcRatioR: 0.0001, // Very low AC/DC - no pulsation
          acDcRatioG: 0.0001,
          acDcRatioB: 0.0001,
          spectralSnrDb: 0, // No SNR
          autocorrelationScore: 0.1, // No periodicity
        }
      };

      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
      expect(result.hardFail).toBe(true);
      expect(result.reasons.some(r => r.includes('EXTENDED_CONTACT_NOT_READY'))).toBe(true);
      expect(result.reasons.some(r => r.includes('AC_DC_RATIO_TOO_LOW'))).toBe(true);
    });
  });

  describe('Test 3: Tablecloth (Non-Pulsatile Surface)', () => {
    it('should reject when camera points to tablecloth with ambient light', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'MATERIAL_SIGNAL',
        extendedContactState: 'MATERIAL_SIGNAL',
        quality: 8,
        perfusionIndex: 0.08,
        clipHighRatio: 0,
        clipLowRatio: 0,
        motionArtifact: 0,
        sourceStability: 0.9,
        windowSQI: {
          score: 0.15,
          gating: 'reject',
          spectral: {
            dominantFrequencyHz: 0.2, // Below cardiac band
            spectralDominanceScore: 0.08,
            detectorAgreementScore: 0.15,
            dominantFrequencyStability: 0.3,
          }
        },
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
          autocorrBpm: 0,
        },
        multichannelEvidence: {
          channelCoherence: 0.25,
          acDcRatioR: 0.0005,
          acDcRatioG: 0.0005,
          acDcRatioB: 0.0005,
          spectralSnrDb: 1.5, // Below threshold
          autocorrelationScore: 0.15,
        }
      };

      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
      expect(result.hardFail).toBe(true);
    });
  });

  describe('Test 4: Covered Camera (No Signal)', () => {
    it('should reject when camera is covered (dark/no signal)', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'CAMERA_NOISE',
        extendedContactState: 'CAMERA_NOISE',
        quality: 0,
        perfusionIndex: 0,
        clipHighRatio: 0,
        clipLowRatio: 0.95, // Very high low clipping - dark
        motionArtifact: 0,
        sourceStability: 0,
        windowSQI: {
          score: 0,
          gating: 'reject',
          spectral: {
            dominantFrequencyHz: 0,
            spectralDominanceScore: 0,
            detectorAgreementScore: 0,
            dominantFrequencyStability: 0,
          }
        },
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
          autocorrBpm: 0,
        }
      };

      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
      expect(result.hardFail).toBe(true);
      expect(result.reasons.some(r => r.includes('EXTENDED_CONTACT_NOT_READY'))).toBe(true);
    });
  });

  describe('Test 5: High Clipping (Overexposed)', () => {
    it('should reject when signal is saturated (high clipping)', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 20,
        perfusionIndex: 0.3,
        clipHighRatio: 0.25, // Above threshold
        clipLowRatio: 0,
        motionArtifact: 0,
        sourceStability: 0.7,
        windowSQI: {
          score: 0.5,
          gating: 'accept',
          spectral: {
            dominantFrequencyHz: 1.2,
            spectralDominanceScore: 0.4,
            detectorAgreementScore: 0.5,
            dominantFrequencyStability: 0.5,
          }
        },
        beatDebug: {
          acceptedBeats: 5,
          consecutivePeaks: 5,
          avgBeatSQI: 60,
          avgMorphologyScore: 60,
          avgDetectorAgreement: 0.6,
          temporalSpectralAgreement: 0.6,
          spectralConfidence: 0.6,
          medianRRBpm: 72,
          spectralBpm: 70,
          autocorrBpm: 74,
        }
      };

      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
      expect(result.hardFail).toBe(true);
      expect(result.reasons.some(r => r.includes('HIGH_CLIP_SEVERE'))).toBe(true);
    });
  });

  describe('Test 6: Low Perfusion (Poor Contact)', () => {
    it('should reject when perfusion index is too low', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 30,
        perfusionIndex: 0.15, // Below threshold
        clipHighRatio: 0,
        clipLowRatio: 0,
        motionArtifact: 0,
        sourceStability: 0.7,
        windowSQI: {
          score: 0.4,
          gating: 'accept',
          spectral: {
            dominantFrequencyHz: 1.0,
            spectralDominanceScore: 0.3,
            detectorAgreementScore: 0.4,
            dominantFrequencyStability: 0.4,
          }
        },
        beatDebug: {
          acceptedBeats: 3,
          consecutivePeaks: 3,
          avgBeatSQI: 55,
          avgMorphologyScore: 55,
          avgDetectorAgreement: 0.5,
          temporalSpectralAgreement: 0.5,
          spectralConfidence: 0.5,
          medianRRBpm: 70,
          spectralBpm: 68,
          autocorrBpm: 72,
        }
      };

      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
      expect(result.hardFail).toBe(true);
      expect(result.reasons.some(r => r.includes('PERFUSION_TOO_LOW'))).toBe(true);
    });
  });

  describe('Test 7: Dominant Frequency Out of Cardiac Band', () => {
    it('should reject when dominant frequency is outside cardiac band', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 50,
        perfusionIndex: 0.4,
        clipHighRatio: 0,
        clipLowRatio: 0,
        motionArtifact: 0,
        sourceStability: 0.8,
        windowSQI: {
          score: 0.6,
          gating: 'accept',
          spectral: {
            dominantFrequencyHz: 5.0, // Above cardiac band (3.5 Hz max)
            spectralDominanceScore: 0.5,
            detectorAgreementScore: 0.6,
            dominantFrequencyStability: 0.6,
          }
        },
        beatDebug: {
          acceptedBeats: 5,
          consecutivePeaks: 5,
          avgBeatSQI: 60,
          avgMorphologyScore: 60,
          avgDetectorAgreement: 0.6,
          temporalSpectralAgreement: 0.6,
          spectralConfidence: 0.6,
          medianRRBpm: 72,
          spectralBpm: 70,
          autocorrBpm: 74,
        }
      };

      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
      expect(result.hardFail).toBe(true);
      expect(result.reasons.some(r => r.includes('DOMINANT_FREQ_OUT_OF_BAND'))).toBe(true);
    });
  });

  describe('Test 8: Low Channel Coherence (Uncorrelated Noise)', () => {
    it('should reject when RGB channels are not coherent', () => {
      const input: LivePpgEvidenceInput = {
        timestamp: Date.now(),
        sampleRate: 30,
        contactState: 'STABLE_CONTACT',
        extendedContactState: 'MEASUREMENT_READY',
        quality: 40,
        perfusionIndex: 0.35,
        clipHighRatio: 0,
        clipLowRatio: 0,
        motionArtifact: 0,
        sourceStability: 0.75,
        windowSQI: {
          score: 0.55,
          gating: 'accept',
          spectral: {
            dominantFrequencyHz: 1.2,
            spectralDominanceScore: 0.4,
            detectorAgreementScore: 0.5,
            dominantFrequencyStability: 0.5,
          }
        },
        beatDebug: {
          acceptedBeats: 4,
          consecutivePeaks: 4,
          avgBeatSQI: 58,
          avgMorphologyScore: 58,
          avgDetectorAgreement: 0.55,
          temporalSpectralAgreement: 0.55,
          spectralConfidence: 0.55,
          medianRRBpm: 70,
          spectralBpm: 68,
          autocorrBpm: 72,
        },
        multichannelEvidence: {
          channelCoherence: 0.3, // Below threshold - channels not correlated
          acDcRatioR: 0.004,
          acDcRatioG: 0.004,
          acDcRatioB: 0.004,
          spectralSnrDb: 4,
          autocorrelationScore: 0.45,
        }
      };

      const result = livePpgEvidenceGate.evaluate(input);
      
      expect(result.passed).toBe(false);
      expect(result.tier).toBe('INVALID');
      expect(result.hardFail).toBe(true);
      expect(result.reasons.some(r => r.includes('CHANNEL_COHERENCE_TOO_LOW'))).toBe(true);
    });
  });
});
