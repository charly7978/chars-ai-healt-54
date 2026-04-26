import React from 'react';

export interface ForensicDebugData {
  rawFrame: {
    videoWidth: number;
    videoHeight: number;
    fps: number;
    droppedFrames: number;
    torchEnabled: boolean;
  };
  roi: {
    x: number;
    y: number;
    width: number;
    height: number;
    validPixelRatio: number;
    meanR: number;
    meanG: number;
    meanB: number;
    stdR: number;
    stdG: number;
    stdB: number;
    clipHighR: number;
    clipHighG: number;
    clipHighB: number;
  };
  signal: {
    rawR: number;
    rawG: number;
    rawB: number;
    odR: number;
    odG: number;
    odB: number;
    acDcR: number;
    acDcG: number;
    acDcB: number;
    selectedChannel: string;
    filteredValue: number;
    signalRms: number;
    noiseRms: number;
  };
  livePpg: {
    passed: boolean;
    qualityScore: number;
    reasons: string[];
    dominantFrequencyHz: number;
    temporalBpm: number;
    spectralBpm: number;
    acceptedBeats: number;
    rejectedBeats: number;
    detectorAgreementScore: number;
    spectralSnrDb: number;
    autocorrelationScore: number;
    channelCoherence: number;
  };
  publication: {
    canPublishWaveform: boolean;
    canPublishBpm: boolean;
    canPublishSpo2: boolean;
    canPublishPressure: boolean;
    canPublishGlucose: boolean;
    canPublishLipids: boolean;
    hapticsAllowed: boolean;
  };
}

interface ForensicDebugPanelProps {
  data: ForensicDebugData;
  visible: boolean;
  onClose: () => void;
}

const ForensicDebugPanel: React.FC<ForensicDebugPanelProps> = ({ data, visible, onClose }) => {
  if (!visible) return null;

  const formatNumber = (val: number, decimals: number = 2) => {
    if (val === 0 || val === undefined || val === null || !isFinite(val)) return '0.00';
    return val.toFixed(decimals);
  };

  const formatBool = (val: boolean) => val ? '✅' : '❌';

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-4">
      <h3 className="text-xs font-bold text-green-400 mb-2 uppercase tracking-wider">{title}</h3>
      <div className="bg-gray-900/50 rounded p-2 text-xs font-mono">{children}</div>
    </div>
  );

  const Row = ({ label, value, warning = false }: { label: string; value: string | number; warning?: boolean }) => (
    <div className={`flex justify-between py-1 ${warning ? 'text-red-400' : 'text-gray-300'}`}>
      <span className="text-gray-500">{label}:</span>
      <span>{value}</span>
    </div>
  );

  const isSignalDead = data.signal.rawR === 0 && data.signal.rawG === 0 && data.signal.rawB === 0;
  const isOdDead = data.signal.odR === 0 && data.signal.odG === 0 && data.signal.odB === 0;

  return (
    <div className="fixed top-4 right-4 w-96 max-h-[90vh] overflow-y-auto bg-gray-950 border border-green-900/50 rounded-lg shadow-2xl z-50 font-mono text-xs">
      <div className="sticky top-0 bg-gray-950 border-b border-green-900/50 p-3 flex justify-between items-center">
        <h2 className="text-sm font-bold text-green-400">FORENSIC DEBUG</h2>
        <button 
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="p-3 space-y-4">
        {/* RAW FRAME */}
        <Section title="RAW FRAME">
          <Row label="Resolution" value={`${data.rawFrame.videoWidth}x${data.rawFrame.videoHeight}`} />
          <Row label="FPS" value={formatNumber(data.rawFrame.fps, 1)} />
          <Row label="Dropped Frames" value={data.rawFrame.droppedFrames} />
          <Row label="Torch" value={formatBool(data.rawFrame.torchEnabled)} />
        </Section>

        {/* ROI */}
        <Section title="ROI">
          <Row label="Position" value={`(${data.roi.x}, ${data.roi.y})`} />
          <Row label="Size" value={`${data.roi.width}x${data.roi.height}`} />
          <Row label="Valid Pixels" value={`${formatNumber(data.roi.validPixelRatio * 100, 1)}%`} warning={data.roi.validPixelRatio < 0.5} />
          <Row label="Mean R" value={formatNumber(data.roi.meanR)} />
          <Row label="Mean G" value={formatNumber(data.roi.meanG)} />
          <Row label="Mean B" value={formatNumber(data.roi.meanB)} />
          <Row label="Std R" value={formatNumber(data.roi.stdR)} />
          <Row label="Std G" value={formatNumber(data.roi.stdG)} />
          <Row label="Std B" value={formatNumber(data.roi.stdB)} />
          <Row label="Clip High R" value={formatNumber(data.roi.clipHighR * 100, 1) + '%'} warning={data.roi.clipHighR > 0.05} />
          <Row label="Clip High G" value={formatNumber(data.roi.clipHighG * 100, 1) + '%'} warning={data.roi.clipHighG > 0.05} />
          <Row label="Clip High B" value={formatNumber(data.roi.clipHighB * 100, 1) + '%'} warning={data.roi.clipHighB > 0.05} />
        </Section>

        {/* SIGNAL */}
        <Section title={isSignalDead ? "SIGNAL ⚠️ DEAD" : "SIGNAL"}>
          <Row label="Raw R" value={formatNumber(data.signal.rawR)} warning={isSignalDead} />
          <Row label="Raw G" value={formatNumber(data.signal.rawG)} warning={isSignalDead} />
          <Row label="Raw B" value={formatNumber(data.signal.rawB)} warning={isSignalDead} />
          <Row label="OD R" value={formatNumber(data.signal.odR)} warning={isOdDead} />
          <Row label="OD G" value={formatNumber(data.signal.odG)} warning={isOdDead} />
          <Row label="OD B" value={formatNumber(data.signal.odB)} warning={isOdDead} />
          <Row label="AC/DC R" value={formatNumber(data.signal.acDcR)} />
          <Row label="AC/DC G" value={formatNumber(data.signal.acDcG)} />
          <Row label="AC/DC B" value={formatNumber(data.signal.acDcB)} />
          <Row label="Selected Channel" value={data.signal.selectedChannel} />
          <Row label="Filtered Value" value={formatNumber(data.signal.filteredValue)} />
          <Row label="Signal RMS" value={formatNumber(data.signal.signalRms)} />
          <Row label="Noise RMS" value={formatNumber(data.signal.noiseRms)} />
        </Section>

        {/* LIVE PPG */}
        <Section title={data.livePpg.passed ? "LIVE PPG ✅" : "LIVE PPG ❌"}>
          <Row label="Passed" value={formatBool(data.livePpg.passed)} />
          <Row label="Quality Score" value={formatNumber(data.livePpg.qualityScore)} warning={data.livePpg.qualityScore < 65} />
          <Row label="Dominant Freq" value={formatNumber(data.livePpg.dominantFrequencyHz, 2) + ' Hz'} />
          <Row label="Temporal BPM" value={formatNumber(data.livePpg.temporalBpm, 1)} />
          <Row label="Spectral BPM" value={formatNumber(data.livePpg.spectralBpm, 1)} />
          <Row label="Accepted Beats" value={data.livePpg.acceptedBeats} />
          <Row label="Rejected Beats" value={data.livePpg.rejectedBeats} />
          <Row label="Detector Agreement" value={formatNumber(data.livePpg.detectorAgreementScore)} />
          <Row label="Spectral SNR" value={formatNumber(data.livePpg.spectralSnrDb, 1) + ' dB'} />
          <Row label="Autocorr Score" value={formatNumber(data.livePpg.autocorrelationScore)} />
          <Row label="Channel Coherence" value={formatNumber(data.livePpg.channelCoherence)} />
          {data.livePpg.reasons.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <div className="text-red-400 font-bold mb-1">Rejection Reasons:</div>
              {data.livePpg.reasons.map((reason, i) => (
                <div key={i} className="text-red-300 text-[10px]">• {reason}</div>
              ))}
            </div>
          )}
        </Section>

        {/* PUBLICATION */}
        <Section title="PUBLICATION">
          <Row label="Waveform" value={formatBool(data.publication.canPublishWaveform)} />
          <Row label="BPM" value={formatBool(data.publication.canPublishBpm)} />
          <Row label="SpO₂" value={formatBool(data.publication.canPublishSpo2)} />
          <Row label="Pressure" value={formatBool(data.publication.canPublishPressure)} />
          <Row label="Glucose" value={formatBool(data.publication.canPublishGlucose)} />
          <Row label="Lipids" value={formatBool(data.publication.canPublishLipids)} />
          <Row label="Haptics" value={formatBool(data.publication.hapticsAllowed)} />
        </Section>

        {/* STATUS SUMMARY */}
        <div className="mt-4 p-2 bg-gray-900 rounded border border-gray-700">
          <div className={`font-bold ${isSignalDead || isOdDead ? 'text-red-500' : 'text-green-400'}`}>
            {isSignalDead || isOdDead ? '⚠️ SIGNAL DEAD - NO EXTRACCIÓN REAL' : '✅ SIGNAL ACTIVE'}
          </div>
          <div className={`mt-1 ${data.livePpg.passed ? 'text-green-400' : 'text-red-400'}`}>
            {data.livePpg.passed ? '✅ LIVE PPG CONFIRMED' : '❌ LIVE PPG REJECTED'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForensicDebugPanel;
