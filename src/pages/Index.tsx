import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';
import { RealTimeGraph } from '../components/RealTimeGraph';
import { ArrhythmiaDisplay } from '../components/ArrhythmiaDisplay';
import { CalibrationControls } from '../components/CalibrationControls';
import { RespiratoryRate } from '../components/RespiratoryRate';
import { MotionLevel } from '../components/MotionLevel';
import { AudioFeedback } from '../components/AudioFeedback';
import { useAudio } from '../hooks/useAudio';
import { useNotifications } from '../hooks/useNotifications';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { useVitalSignsSettings } from '../hooks/useVitalSignsSettings';
import { usePatientContext } from '../contexts/PatientContext';
import { useUIPreferences } from '../contexts/UIPreferencesContext';
import { useSensorData } from '../hooks/useSensorData';
import { useCalibration } from '../hooks/useCalibration';
import { useEmergencySystem } from '../hooks/useEmergencySystem';
import { useRiskAssessment } from '../hooks/useRiskAssessment';
import { useDataLogging } from '../hooks/useDataLogging';
import { useRealTimeAnalysis } from '../hooks/useRealTimeAnalysis';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { useAdvancedMonitoring } from '../hooks/useAdvancedMonitoring';
import { usePredictiveAnalytics } from '../hooks/usePredictiveAnalytics';
import { useIntegrationWithEHR } from '../hooks/useIntegrationWithEHR';
import { useRemoteMonitoring } from '../hooks/useRemoteMonitoring';
import { useSecurityAudits } from '../hooks/useSecurityAudits';
import { useAccessibilityFeatures } from '../hooks/useAccessibilityFeatures';
import { useEducationalResources } from '../hooks/useEducationalResources';
import { useSupportAndTroubleshooting } from '../hooks/useSupportAndTroubleshooting';

const Index = () => {
  // State variables
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 98,
    pressure: '120/80',
    arrhythmiaStatus: 'Normal',
    glucose: 90,
    lipids: { totalCholesterol: 180, triglycerides: 150 },
    hemoglobin: 13.5,
  });
  const [ppgData, setPpgData] = useState<number[]>([]);
  const [rrIntervals, setRrIntervals] = useState<number[]>([]);
  const [arrhythmiaData, setArrhythmiaData] = useState<{ timestamp: number; rmssd: number; rrVariation: number } | null>(null);
  const [arrhythmiaStatus, setArrhythmiaStatus] = useState<string>('Normal');
  const [calibrationProgress, setCalibrationProgress] = useState<{ isCalibrating: boolean; progress: number }>({ isCalibrating: false, progress: 0 });
  const [respiratoryRate, setRespiratoryRate] = useState<number>(16);
  const [motionLevel, setMotionLevel] = useState<string>('Stationary');
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  const [showPredictiveAnalysis, setShowPredictiveAnalysis] = useState<boolean>(false);
  const [showEHRIntegration, setShowEHRIntegration] = useState<boolean>(false);
  const [showRemoteMonitoring, setShowRemoteMonitoring] = useState<boolean>(false);
  const [showSecurityAudits, setShowSecurityAudits] = useState<boolean>(false);
  const [showAccessibilityOptions, setShowAccessibilityOptions] = useState<boolean>(false);
  const [showSupportResources, setShowSupportResources] = useState<boolean>(false);

  // Ref for VitalSignsProcessor
  const processorRef = useRef<VitalSignsProcessor | null>(null);

  // Context hooks
  const { patient } = usePatientContext();
  const { theme, fontSize, contrast } = useUIPreferences();

  // Custom hooks
  const { playSound } = useAudio();
  const { sendNotification } = useNotifications();
  const { getPreference, savePreference } = useUserPreferences();
  const { getSetting, saveSetting } = useVitalSignsSettings();
  const { sensorValue } = useSensorData();
  const { startCalibration, completeCalibration, isCalibrating, getCalibrationProgress } = useCalibration();
  const { triggerEmergency } = useEmergencySystem();
  const { assessRisk } = useRiskAssessment();
  const { logData } = useDataLogging();
  const { analyzeRealTimeData } = useRealTimeAnalysis();
  const { isSimulationEnabled, toggleSimulation } = useSimulationMode();
  const { enableAdvancedMonitoring, disableAdvancedMonitoring } = useAdvancedMonitoring();
  const { runPredictiveAnalysis } = usePredictiveAnalytics();
  const { integrateWithEHR, disconnectFromEHR } = useIntegrationWithEHR();
  const { startRemoteMonitoring, stopRemoteMonitoring } = useRemoteMonitoring();
  const { runSecurityAudit } = useSecurityAudits();
  const { enableAccessibilityFeatures, disableAccessibilityFeatures } = useAccessibilityFeatures();
  const { accessEducationalResources } = useEducationalResources();
  const { troubleshootIssues } = useSupportAndTroubleshooting();

  // Initialize VitalSignsProcessor
  useEffect(() => {
    processorRef.current = new VitalSignsProcessor(patient?.age);
    return () => {
      processorRef.current?.fullReset();
      processorRef.current = null;
    };
  }, [patient?.age]);

  // Socket.IO setup
  useEffect(() => {
    const socket = io('http://localhost:3002');

    socket.on('ppg_data', (data: number) => {
      setPpgData(prevData => [...prevData.slice(-99), data]);
    });

    socket.on('rr_interval', (interval: number) => {
      setRrIntervals(prevIntervals => [...prevIntervals.slice(-9), interval]);
    });

    socket.on('respiratory_rate', (rate: number) => {
      setRespiratoryRate(rate);
    });

    socket.on('motion_level', (level: string) => {
      setMotionLevel(level);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const processVitalSigns = useCallback(async (ppgValue: number, rrIntervals?: number[]) => {
    if (!vitalSignsProcessor) return;

    try {
      const rrData = rrIntervals ? {
        intervals: rrIntervals,
        lastPeakTime: Date.now()
      } : undefined;

      // Await the Promise to get the actual result
      const result = await vitalSignsProcessor.processSignal(ppgValue, rrData);
      
      setVitalSigns(result);
      
      if (result.lastArrhythmiaData) {
        setArrhythmiaData(result.lastArrhythmiaData);
        setArrhythmiaStatus(result.arrhythmiaStatus);
      }

    } catch (error) {
      console.error('Error processing vital signs:', error);
    }
  }, [vitalSignsProcessor]);

  // Process vital signs when PPG data changes
  useEffect(() => {
    if (ppgData.length > 0 && processorRef.current) {
      const lastPpgValue = ppgData[ppgData.length - 1];
      processVitalSigns(lastPpgValue, rrIntervals);
    }
  }, [ppgData, rrIntervals, processVitalSigns]);

  // Calibration handlers
  const handleStartCalibration = useCallback(() => {
    vitalSignsProcessor?.startCalibration();
  }, [vitalSignsProcessor]);

  const handleCompleteCalibration = useCallback(() => {
    vitalSignsProcessor?.forceCalibrationCompletion();
  }, [vitalSignsProcessor]);

  const handleCalibrationProgress = useCallback((progress: number) => {
    if (vitalSignsProcessor) {
      // Get the calibration object and update just the progress
      const currentCalibration = {
        isCalibrating: vitalSignsProcessor.isCurrentlyCalibrating(),
        progress: progress
      };
      setCalibrationProgress(currentCalibration);
    }
  }, [vitalSignsProcessor]);

  // Emergency system handler
  const handleEmergencyTrigger = useCallback(() => {
    triggerEmergency(vitalSigns, patient);
  }, [vitalSigns, patient, triggerEmergency]);

  // Risk assessment handler
  const handleRiskAssessment = useCallback(() => {
    assessRisk(vitalSigns, patient);
  }, [vitalSigns, patient, assessRisk]);

  // Data logging handler
  const handleDataLogging = useCallback(() => {
    logData(vitalSigns, patient);
  }, [vitalSigns, patient, logData]);

  // Real-time analysis handler
  const handleRealTimeAnalysis = useCallback(() => {
    analyzeRealTimeData(ppgData, rrIntervals);
  }, [ppgData, rrIntervals, analyzeRealTimeData]);

  // Predictive analysis handler
  const handlePredictiveAnalysis = useCallback(() => {
    runPredictiveAnalysis(vitalSigns, patient);
  }, [vitalSigns, patient, runPredictiveAnalysis]);

  // EHR integration handlers
  const handleEHRIntegration = useCallback(() => {
    integrateWithEHR(patient, vitalSigns);
  }, [patient, vitalSigns, integrateWithEHR]);

  const handleEHRDisconnection = useCallback(() => {
    disconnectFromEHR();
  }, [disconnectFromEHR]);

  // Remote monitoring handlers
  const handleStartRemoteMonitoring = useCallback(() => {
    startRemoteMonitoring(patient, vitalSigns);
  }, [patient, vitalSigns, startRemoteMonitoring]);

  const handleStopRemoteMonitoring = useCallback(() => {
    stopRemoteMonitoring();
  }, [stopRemoteMonitoring]);

  // Security audit handler
  const handleSecurityAudit = useCallback(() => {
    runSecurityAudit();
  }, [runSecurityAudit]);

  // Accessibility features handlers
  const handleEnableAccessibility = useCallback(() => {
    enableAccessibilityFeatures();
  }, [enableAccessibilityFeatures]);

  const handleDisableAccessibility = useCallback(() => {
    disableAccessibilityFeatures();
  }, [disableAccessibilityFeatures]);

  // Educational resources handler
  const handleAccessEducationalResources = useCallback(() => {
    accessEducationalResources();
  }, [accessEducationalResources]);

  // Support and troubleshooting handler
  const handleTroubleshooting = useCallback(() => {
    troubleshootIssues();
  }, [troubleshootIssues]);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', fontSize: fontSize, backgroundColor: theme === 'dark' ? '#333' : '#fff', color: theme === 'dark' ? '#fff' : '#333', contrast: contrast }}>
      <h1>Vital Signs Monitoring</h1>
      <p>Patient: {patient?.name || 'N/A'}, Age: {patient?.age || 'N/A'}</p>

      <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '20px' }}>
        <div>
          <h2>Real-Time Data</h2>
          <RealTimeGraph data={ppgData} label="PPG Signal" color="blue" />
          <RealTimeGraph data={rrIntervals} label="RR Intervals" color="green" />
        </div>

        <div>
          <h2>Vital Signs</h2>
          <p>SpO2: {vitalSigns.spo2}%</p>
          <p>Pressure: {vitalSigns.pressure}</p>
          <p>Glucose: {vitalSigns.glucose} mg/dL</p>
          <p>Hemoglobin: {vitalSigns.hemoglobin} g/dL</p>
          <p>Arrhythmia Status: {vitalSigns.arrhythmiaStatus}</p>
          <p>Respiratory Rate: {respiratoryRate} breaths/min</p>
          <p>Motion Level: {motionLevel}</p>
          <p>Confidence: {vitalSigns.confidence}%</p>
          <p>Quality: {vitalSigns.quality}</p>
        </div>

        <div>
          <h2>Arrhythmia Analysis</h2>
          <ArrhythmiaDisplay data={arrhythmiaData} status={arrhythmiaStatus} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '20px' }}>
        <CalibrationControls
          isCalibrating={calibrationProgress.isCalibrating}
          progress={calibrationProgress.progress}
          onStart={handleStartCalibration}
          onComplete={handleCompleteCalibration}
          onProgress={handleCalibrationProgress}
        />
        <RespiratoryRate rate={respiratoryRate} />
        <MotionLevel level={motionLevel} />
        <AudioFeedback spo2={vitalSigns.spo2} pressure={vitalSigns.pressure} playSound={playSound} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '20px' }}>
        <button onClick={handleEmergencyTrigger}>Trigger Emergency</button>
        <button onClick={handleRiskAssessment}>Assess Risk</button>
        <button onClick={handleDataLogging}>Log Data</button>
        <button onClick={handleRealTimeAnalysis}>Analyze Real-Time Data</button>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label>
          Simulation Mode:
          <input type="checkbox" checked={isSimulationEnabled} onChange={toggleSimulation} />
        </label>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}>
          {showAdvancedSettings ? 'Hide Advanced Settings' : 'Show Advanced Settings'}
        </button>
        {showAdvancedSettings && (
          <div>
            <button onClick={handleEnableAccessibility}>Enable Advanced Monitoring</button>
            <button onClick={handleDisableAccessibility}>Disable Advanced Monitoring</button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setShowPredictiveAnalysis(!showPredictiveAnalysis)}>
          {showPredictiveAnalysis ? 'Hide Predictive Analysis' : 'Show Predictive Analysis'}
        </button>
        {showPredictiveAnalysis && (
          <div>
            <button onClick={handlePredictiveAnalysis}>Run Predictive Analysis</button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setShowEHRIntegration(!showEHRIntegration)}>
          {showEHRIntegration ? 'Hide EHR Integration' : 'Show EHR Integration'}
        </button>
        {showEHRIntegration && (
          <div>
            <button onClick={handleEHRIntegration}>Integrate with EHR</button>
            <button onClick={handleEHRDisconnection}>Disconnect from EHR</button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setShowRemoteMonitoring(!showRemoteMonitoring)}>
          {showRemoteMonitoring ? 'Hide Remote Monitoring' : 'Show Remote Monitoring'}
        </button>
        {showRemoteMonitoring && (
          <div>
            <button onClick={handleStartRemoteMonitoring}>Start Remote Monitoring</button>
            <button onClick={handleStopRemoteMonitoring}>Stop Remote Monitoring</button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setShowSecurityAudits(!showSecurityAudits)}>
          {showSecurityAudits ? 'Hide Security Audits' : 'Show Security Audits'}
        </button>
        {showSecurityAudits && (
          <div>
            <button onClick={handleSecurityAudit}>Run Security Audit</button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setShowAccessibilityOptions(!showAccessibilityOptions)}>
          {showAccessibilityOptions ? 'Hide Accessibility Options' : 'Show Accessibility Options'}
        </button>
        {showAccessibilityOptions && (
          <div>
            <button onClick={handleEnableAccessibility}>Enable Accessibility Features</button>
            <button onClick={handleDisableAccessibility}>Disable Accessibility Features</button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setShowSupportResources(!showSupportResources)}>
          {showSupportResources ? 'Hide Support Resources' : 'Show Support Resources'}
        </button>
        {showSupportResources && (
          <div>
            <button onClick={handleAccessEducationalResources}>Access Educational Resources</button>
            <button onClick={handleTroubleshooting}>Troubleshoot Issues</button>
          </div>
        )}
      </div>

      <footer>
        <p>&copy; 2024 Vital Signs Monitoring System</p>
      </footer>
    </div>
  );
};

export default Index;
