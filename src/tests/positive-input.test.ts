/**
 * POSITIVE INPUT TEST - FAIL-CLOSED VALIDATION
 * 
 * Este test verifica que el sistema acepte correctamente señales PPG reales
 * de dedo humano con flash, mostrando métricas RGB/OD/AC/DC válidas.
 */

import { livePpgEvidenceGate, type LivePpgEvidenceInput } from '../modules/signal-processing/LivePpgEvidenceGate';

describe('Positive Input Test - Human Finger with Flash', () => {
  
  it('should accept valid PPG signal from human finger with flash', () => {
    const input: LivePpgEvidenceInput = {
      timestamp: Date.now(),
      sampleRate: 30, // Good sample rate
      contactState: 'STABLE_CONTACT',
      extendedContactState: 'MEASUREMENT_READY',
      quality: 75, // High quality
      perfusionIndex: 0.45, // Good perfusion
      clipHighRatio: 0.02, // Low clipping
      clipLowRatio: 0.01, // Low clipping
      motionArtifact: 0, // No motion
      sourceStability: 0.85, // High stability
      windowSQI: {
        score: 0.78, // High window SQI
        gating: 'accept_high_confidence',
        spectral: {
          dominantFrequencyHz: 1.2, // ~72 BPM - in cardiac band
          spectralDominanceScore: 0.65, // High spectral dominance
          detectorAgreementScore: 0.72, // High detector agreement
          dominantFrequencyStability: 0.75, // High frequency stability
          spectralEntropyPenalty: 0.4, // Low entropy penalty
        }
      },
      beatDebug: {
        acceptedBeats: 8, // Sufficient beats
        consecutivePeaks: 7, // Good consecutive peaks
        avgBeatSQI: 72, // High beat SQI
        avgMorphologyScore: 68, // Good morphology
        avgDetectorAgreement: 0.68, // Good agreement
        temporalSpectralAgreement: 0.75, // High temporal-spectral agreement
        spectralConfidence: 0.78, // High spectral confidence
        medianRRBpm: 72,
        spectralBpm: 71,
        autocorrBpm: 73,
      },
      roiEvidence: {
        activeCellCount: 8,
        spatialCoherence: 0.65, // High spatial coherence
        phaseCoherence: 0.62, // High phase coherence
        roiReputation: 0.8,
        backgroundCorrelation: 0.25, // Low background correlation
        topRoiToBackgroundPowerRatio: 3.2, // High ROI-to-background ratio
      },
      radiometry: {
        linearized: true,
        opticalDensityEnabled: true,
        darkFrameReady: true,
        whiteReferenceReady: true,
        redClipping: 0.01,
        greenClipping: 0.01,
        blueClipping: 0.01,
        exposureLocked: true,
        whiteBalanceLocked: true,
        torchEnabled: true,
      },
      multichannelEvidence: {
        channelCoherence: 0.68, // High channel coherence
        acDcRatioR: 0.009, // Good AC/DC ratio
        acDcRatioG: 0.012, // Best channel (green)
        acDcRatioB: 0.007,
        spectralSnrDb: 8.5, // High SNR
        autocorrelationScore: 0.62, // High autocorrelation
      }
    };

    const result = livePpgEvidenceGate.evaluate(input);
    
    // Should pass
    expect(result.passed).toBe(true);
    expect(result.tier).toBe('VALID_LIVE_PPG');
    expect(result.hardFail).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(0.78);
    
    // Should have no rejection reasons
    expect(result.reasons.length).toBe(0);
    
    // Metrics should be recorded
    expect(result.metrics.sampleRate).toBe(30);
    expect(result.metrics.perfusionIndex).toBe(0.45);
    expect(result.metrics.channelCoherence).toBe(0.68);
    expect(result.metrics.spectralSnrDb).toBe(8.5);
    expect(result.metrics.autocorrelationScore).toBe(0.62);
    expect(result.metrics.acceptedBeats).toBe(8);
  });

  it('should accept valid PPG with minimum passing score', () => {
    const input: LivePpgEvidenceInput = {
      timestamp: Date.now(),
      sampleRate: 30,
      contactState: 'STABLE_CONTACT',
      extendedContactState: 'MEASUREMENT_READY',
      quality: 60,
      perfusionIndex: 0.35, // At minimum
      clipHighRatio: 0.05,
      clipLowRatio: 0.05,
      motionArtifact: 0.1,
      sourceStability: 0.7,
      windowSQI: {
        score: 0.6, // At minimum
        gating: 'accept_high_confidence',
        spectral: {
          dominantFrequencyHz: 1.0,
          spectralDominanceScore: 0.4, // At minimum
          detectorAgreementScore: 0.5, // At minimum
          dominantFrequencyStability: 0.55, // At minimum
        }
      },
      beatDebug: {
        acceptedBeats: 5, // At minimum
        consecutivePeaks: 5, // At target
        avgBeatSQI: 60, // At target
        avgMorphologyScore: 60, // At target
        avgDetectorAgreement: 0.6,
        temporalSpectralAgreement: 0.6,
        spectralConfidence: 0.65, // At target
        medianRRBpm: 70,
        spectralBpm: 68,
        autocorrBpm: 72,
      },
      roiEvidence: {
        activeCellCount: 5,
        spatialCoherence: 0.5, // At minimum
        phaseCoherence: 0.5, // At minimum
        roiReputation: 0.6,
        backgroundCorrelation: 0.4, // At target
        topRoiToBackgroundPowerRatio: 1.8, // Above minimum
      },
      multichannelEvidence: {
        channelCoherence: 0.5, // At minimum
        acDcRatioR: 0.004,
        acDcRatioG: 0.006,
        acDcRatioB: 0.003,
        spectralSnrDb: 4.0, // At minimum
        autocorrelationScore: 0.5, // At minimum
      }
    };

    const result = livePpgEvidenceGate.evaluate(input);
    
    // Should pass with minimum score
    expect(result.passed).toBe(true);
    expect(result.tier).toBe('VALID_LIVE_PPG');
    expect(result.score).toBeGreaterThanOrEqual(0.78);
  });

  it('should reject if one critical metric is below threshold', () => {
    const input: LivePpgEvidenceInput = {
      timestamp: Date.now(),
      sampleRate: 30,
      contactState: 'STABLE_CONTACT',
      extendedContactState: 'MEASUREMENT_READY',
      quality: 75,
      perfusionIndex: 0.45,
      clipHighRatio: 0.02,
      clipLowRatio: 0.01,
      motionArtifact: 0,
      sourceStability: 0.85,
      windowSQI: {
        score: 0.78,
        gating: 'accept_high_confidence',
        spectral: {
          dominantFrequencyHz: 1.2,
          spectralDominanceScore: 0.65,
          detectorAgreementScore: 0.72,
          dominantFrequencyStability: 0.75,
        }
      },
      beatDebug: {
        acceptedBeats: 8,
        consecutivePeaks: 7,
        avgBeatSQI: 72,
        avgMorphologyScore: 68,
        avgDetectorAgreement: 0.68,
        temporalSpectralAgreement: 0.75,
        spectralConfidence: 0.78,
        medianRRBpm: 72,
        spectralBpm: 71,
        autocorrBpm: 73,
      },
      roiEvidence: {
        activeCellCount: 8,
        spatialCoherence: 0.65,
        phaseCoherence: 0.62,
        roiReputation: 0.8,
        backgroundCorrelation: 0.25,
        topRoiToBackgroundPowerRatio: 3.2,
      },
      multichannelEvidence: {
        channelCoherence: 0.68,
        acDcRatioR: 0.009,
        acDcRatioG: 0.012,
        acDcRatioB: 0.007,
        spectralSnrDb: 8.5,
        autocorrelationScore: 0.62,
      }
    };

    // Test with low accepted beats (below threshold)
    const lowBeatsInput = { ...input, beatDebug: { ...input.beatDebug!, acceptedBeats: 2 } };
    const lowBeatsResult = livePpgEvidenceGate.evaluate(lowBeatsInput);
    expect(lowBeatsResult.passed).toBe(false);
    expect(lowBeatsResult.hardFail).toBe(true);
    expect(lowBeatsResult.reasons.some(r => r.includes('ACCEPTED_BEATS_TOO_LOW'))).toBe(true);

    // Test with low spectral dominance (below threshold)
    const lowSpectralInput = { 
      ...input, 
      windowSQI: { 
        ...input.windowSQI!, 
        spectral: { 
          ...input.windowSQI!.spectral!, 
          spectralDominanceScore: 0.25 
        } 
      } 
    };
    const lowSpectralResult = livePpgEvidenceGate.evaluate(lowSpectralInput);
    expect(lowSpectralResult.passed).toBe(false);
    expect(lowSpectralResult.hardFail).toBe(true);
    expect(lowSpectralResult.reasons.some(r => r.includes('SPECTRAL_DOMINANCE_TOO_LOW'))).toBe(true);
  });

  it('should verify RGB/OD/AC/DC metrics are present in valid signal', () => {
    const input: LivePpgEvidenceInput = {
      timestamp: Date.now(),
      sampleRate: 30,
      contactState: 'STABLE_CONTACT',
      extendedContactState: 'MEASUREMENT_READY',
      quality: 75,
      perfusionIndex: 0.45,
      clipHighRatio: 0.02,
      clipLowRatio: 0.01,
      motionArtifact: 0,
      sourceStability: 0.85,
      windowSQI: {
        score: 0.78,
        gating: 'accept_high_confidence',
        spectral: {
          dominantFrequencyHz: 1.2,
          spectralDominanceScore: 0.65,
          detectorAgreementScore: 0.72,
          dominantFrequencyStability: 0.75,
        }
      },
      beatDebug: {
        acceptedBeats: 8,
        consecutivePeaks: 7,
        avgBeatSQI: 72,
        avgMorphologyScore: 68,
        avgDetectorAgreement: 0.68,
        temporalSpectralAgreement: 0.75,
        spectralConfidence: 0.78,
        medianRRBpm: 72,
        spectralBpm: 71,
        autocorrBpm: 73,
      },
      multichannelEvidence: {
        channelCoherence: 0.68,
        acDcRatioR: 0.009, // AC/DC for red channel
        acDcRatioG: 0.012, // AC/DC for green channel (best)
        acDcRatioB: 0.007, // AC/DC for blue channel
        spectralSnrDb: 8.5,
        autocorrelationScore: 0.62,
      }
    };

    const result = livePpgEvidenceGate.evaluate(input);
    
    expect(result.passed).toBe(true);
    
    // Verify AC/DC ratios are recorded
    expect(result.metrics.acDcRatioR).toBe(0.009);
    expect(result.metrics.acDcRatioG).toBe(0.012);
    expect(result.metrics.acDcRatioB).toBe(0.007);
    
    // Verify multichannel metrics
    expect(result.metrics.channelCoherence).toBe(0.68);
    expect(result.metrics.spectralSnrDb).toBe(8.5);
    expect(result.metrics.autocorrelationScore).toBe(0.62);
  });
});
