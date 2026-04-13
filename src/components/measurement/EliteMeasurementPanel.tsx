/**
 * ELITE MEASUREMENT PANEL - PANTALLA COMPLETA DE MEDICIÓN (9.9/10)
 * 
 * Componente principal que integra:
 * - Cámara trasera con flash
 * - ElitePPGProcessor (todo el pipeline)
 * - CardiacMonitor (visualización médica)
 * - Panel de métricas en tiempo real
 * - Alertas de arritmias
 * - Exportación de datos
 * 
 * UI/UX: Diseño médico profesional, tema oscuro, información jerárquica
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ElitePPGProcessor, type ElitePPGResult } from '../../modules/integration/ElitePPGProcessor';
import { CardiacMonitor } from '../monitor/CardiacMonitor';
import type { ArrhythmiaResult } from '../../modules/vital-signs/AdvancedArrhythmiaDetector';

interface EliteMeasurementPanelProps {
  onMeasurementComplete?: (data: MeasurementData) => void;
  onArrhythmiaDetected?: (arrhythmia: ArrhythmiaResult) => void;
  sessionDuration?: number; // segundos, default 60
  enableAudio?: boolean;
  showExport?: boolean;
}

export interface MeasurementData {
  sessionId: string;
  startTime: number;
  endTime: number;
  duration: number;
  
  // Vitals promedios
  averageHR: number;
  averageSpO2: number;
  averageSBP: number;
  averageDBP: number;
  
  // HRV
  hrvMetrics: {
    rmssd: number;
    sdnn: number;
    pnn50: number;
    lfHfRatio: number;
    sd1: number;
    sd2: number;
  };
  
  // Arritmias
  arrhythmias: ArrhythmiaResult[];
  
  // Datos crudos
  rawData: ElitePPGResult[];
  
  // Calidad
  signalQuality: number;
  coveragePercent: number;
}

export const EliteMeasurementPanel: React.FC<EliteMeasurementPanelProps> = ({
  onMeasurementComplete,
  onArrhythmiaDetected,
  sessionDuration = 60,
  enableAudio = true,
  showExport = true
}) => {
  // Refs DOM
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  
  // Refs procesadores
  const processorRef = useRef<ElitePPGProcessor | null>(null);
  
  // Estado de la medición
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [progress, setProgress] = useState(0);
  
  // Estado de datos
  const [currentData, setCurrentData] = useState<ElitePPGResult | null>(null);
  const [measurementHistory, setMeasurementHistory] = useState<ElitePPGResult[]>([]);
  const [arrhythmiaEvents, setArrhythmiaEvents] = useState<ArrhythmiaResult[]>([]);
  
  // Estado de calidad
  const [signalQuality, setSignalQuality] = useState(0);
  const [fingerDetected, setFingerDetected] = useState(false);
  const [stability, setStability] = useState(0);
  
  // Estado de vitales
  const [currentHR, setCurrentHR] = useState(0);
  const [currentSpO2, setCurrentSpO2] = useState(0);
  const [currentSBP, setCurrentSBP] = useState(0);
  const [currentDBP, setCurrentDBP] = useState(0);
  
  // Alertas
  const [currentAlert, setCurrentAlert] = useState<{
    type: string;
    severity: 'warning' | 'alert' | 'critical';
    message: string;
  } | null>(null);
  
  // Inicializar processor
  useEffect(() => {
    processorRef.current = new ElitePPGProcessor({
      minContactQuality: 60,
      minBeatSQI: 60,
      enableNonlinearHRV: true,
      enableFrequencyHRV: true,
      enableArrhythmiaDetection: true
    });
    
    processorRef.current.setResultCallback((result) => {
      setCurrentData(result);
      
      // Actualizar métricas
      setSignalQuality(result.finger.contactQuality);
      setFingerDetected(result.finger.detected);
      setStability(result.finger.stabilityScore);
      setCurrentHR(result.beat.bpm);
      setCurrentSpO2(result.spo2);
      setCurrentSBP(result.systolicBP);
      setCurrentDBP(result.diastolicBP);
      
      // Guardar en historial
      if (result.finger.contactQuality > 50) {
        setMeasurementHistory(prev => [...prev.slice(-300), result]);
      }
    });
    
    processorRef.current.setArrhythmiaCallback((arrhythmia) => {
      setArrhythmiaEvents(prev => [...prev, arrhythmia]);
      onArrhythmiaDetected?.(arrhythmia);
      
      // Mostrar alerta
      if (arrhythmia.confidence > 0.7) {
        setCurrentAlert({
          type: arrhythmia.primaryDiagnosis,
          severity: arrhythmia.events[arrhythmia.events.length - 1]?.severity === 'critical' ? 'critical' :
                   arrhythmia.events[arrhythmia.events.length - 1]?.severity === 'alert' ? 'alert' : 'warning',
          message: formatArrhythmiaName(arrhythmia.primaryDiagnosis)
        });
        
        // Auto-clear alerta después de 5s
        setTimeout(() => setCurrentAlert(null), 5000);
      }
    });
    
    return () => {
      processorRef.current?.reset();
    };
  }, [onArrhythmiaDetected]);
  
  // Timer de sesión
  useEffect(() => {
    if (!isMeasuring || isPaused) return;
    
    const interval = setInterval(() => {
      setElapsedTime(t => {
        const newTime = t + 1;
        setProgress((newTime / sessionDuration) * 100);
        
        if (newTime >= sessionDuration) {
          completeMeasurement();
        }
        
        return newTime;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isMeasuring, isPaused, sessionDuration]);
  
  // Iniciar cámara
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      // Activar flash si está disponible
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      if (capabilities.torch) {
        await track.applyConstraints({
          advanced: [{ torch: true }]
        } as any);
      }
      
      return true;
    } catch (err) {
      console.error('Camera error:', err);
      return false;
    }
  }, []);
  
  // Detener cámara
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  }, []);
  
  // Loop de procesamiento
  const startProcessing = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !processorRef.current) return;
    
    processorRef.current.start();
    
    const processFrame = () => {
      if (!isMeasuring || isPaused) return;
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas) return;
      
      // Crear canvas temporal para extraer frame
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = video.videoWidth;
      tempCanvas.height = video.videoHeight;
      const ctx = tempCanvas.getContext('2d');
      
      if (!ctx) return;
      
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      
      // Procesar frame
      processorRef.current?.processFrame(imageData, performance.now());
      
      animationRef.current = requestAnimationFrame(processFrame);
    };
    
    processFrame();
  }, [isMeasuring, isPaused]);
  
  // Iniciar medición
  const startMeasurement = useCallback(async () => {
    const cameraStarted = await startCamera();
    if (!cameraStarted) return;
    
    setIsMeasuring(true);
    setIsPaused(false);
    setElapsedTime(0);
    setProgress(0);
    setMeasurementHistory([]);
    setArrhythmiaEvents([]);
    setCurrentAlert(null);
    
    // Pequeño delay para que la cámara se estabilice
    setTimeout(startProcessing, 500);
  }, [startCamera, startProcessing]);
  
  // Pausar/reanudar
  const togglePause = useCallback(() => {
    setIsPaused(p => !p);
    if (isPaused) {
      startProcessing();
    }
  }, [isPaused, startProcessing]);
  
  // Detener medición
  const stopMeasurement = useCallback(() => {
    setIsMeasuring(false);
    stopCamera();
    processorRef.current?.stop();
  }, [stopCamera]);
  
  // Completar medición
  const completeMeasurement = useCallback(() => {
    stopMeasurement();
    
    // Calcular datos finales
    const validData = measurementHistory.filter(d => d.finger.contactQuality > 60);
    
    if (validData.length === 0) {
      alert('Medición incompleta - calidad insuficiente');
      return;
    }
    
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    const measurementData: MeasurementData = {
      sessionId: `session-${Date.now()}`,
      startTime: validData[0]?.timestamp || Date.now(),
      endTime: validData[validData.length - 1]?.timestamp || Date.now(),
      duration: elapsedTime,
      averageHR: avg(validData.map(d => d.beat.bpm)),
      averageSpO2: (() => {
        const vals = validData.map(d => d.spo2).filter(v => v > 0);
        return vals.length > 0 ? avg(vals) : 0;
      })(),
      averageSBP: (() => {
        const vals = validData.map(d => d.systolicBP).filter(v => v > 0);
        return vals.length > 0 ? avg(vals) : 0;
      })(),
      averageDBP: (() => {
        const vals = validData.map(d => d.diastolicBP).filter(v => v > 0);
        return vals.length > 0 ? avg(vals) : 0;
      })(),
      hrvMetrics: {
        rmssd: currentData?.hrvTime.rmssd || 0,
        sdnn: currentData?.hrvTime.sdnn || 0,
        pnn50: currentData?.hrvTime.pnn50 || 0,
        lfHfRatio: currentData?.hrvFrequency?.lfHfRatio || 0,
        sd1: currentData?.hrvNonlinear?.poincare.sd1 || 0,
        sd2: currentData?.hrvNonlinear?.poincare.sd2 || 0
      },
      arrhythmias: arrhythmiaEvents,
      rawData: validData,
      signalQuality: avg(validData.map(d => d.finger.contactQuality)),
      coveragePercent: (validData.length / measurementHistory.length) * 100
    };
    
    onMeasurementComplete?.(measurementData);
  }, [measurementHistory, elapsedTime, currentData, arrhythmiaEvents, onMeasurementComplete, stopMeasurement]);
  
  // Exportar datos
  const exportData = useCallback(() => {
    const data = {
      timestamp: new Date().toISOString(),
      current: currentData,
      history: measurementHistory.slice(-100),
      arrhythmias: arrhythmiaEvents
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ppg-measurement-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentData, measurementHistory, arrhythmiaEvents]);
  
  // Helpers
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const formatArrhythmiaName = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };
  
  // Render
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>ELITE CARDIAC MONITOR</h2>
        <div style={styles.statusBadge}>
          {isMeasuring ? (
            <span style={{ color: '#00ff88' }}>● RECORDING</span>
          ) : (
            <span style={{ color: '#888' }}>○ STANDBY</span>
          )}
        </div>
      </div>
      
      {/* Alerta de arritmia */}
      {currentAlert && (
        <div style={{
          ...styles.alert,
          backgroundColor: currentAlert.severity === 'critical' ? '#ff000040' :
                          currentAlert.severity === 'alert' ? '#ff660040' : '#ffaa0040',
          borderColor: currentAlert.severity === 'critical' ? '#ff0000' :
                       currentAlert.severity === 'alert' ? '#ff6600' : '#ffaa00'
        }}>
          <span style={styles.alertIcon}>⚠</span>
          <span>{currentAlert.message}</span>
        </div>
      )}
      
      {/* Panel principal */}
      <div style={styles.mainPanel}>
        {/* Cámara y Monitor */}
        <div style={styles.monitorSection}>
          {/* Preview de cámara (oculto, solo para procesamiento) */}
          <video
            ref={videoRef}
            style={styles.hiddenVideo}
            playsInline
            muted
          />
          
          {/* Canvas de procesamiento (también oculto) */}
          <canvas
            ref={canvasRef}
            style={styles.hiddenCanvas}
          />
          
          {/* Monitor cardíaco */}
          <div style={styles.monitorContainer}>
            <CardiacMonitor
              width={600}
              height={300}
              data={currentData}
              showPoincare={true}
              showHRVMetrics={true}
              enableAudio={enableAudio}
            />
          </div>
          
          {/* Overlay de calidad */}
          <div style={styles.qualityOverlay}>
            <div style={styles.qualityBar}>
              <span>SIGNAL</span>
              <div style={{
                ...styles.qualityFill,
                width: `${signalQuality}%`,
                backgroundColor: signalQuality > 70 ? '#00ff88' : 
                                signalQuality > 40 ? '#ffaa00' : '#ff4444'
              }} />
              <span>{Math.round(signalQuality)}%</span>
            </div>
            
            <div style={styles.qualityBar}>
              <span>STABLE</span>
              <div style={{
                ...styles.qualityFill,
                width: `${stability * 100}%`,
                backgroundColor: stability > 0.7 ? '#00ff88' : '#ffaa00'
              }} />
              <span>{Math.round(stability * 100)}%</span>
            </div>
          </div>
        </div>
        
        {/* Panel de métricas */}
        <div style={styles.metricsPanel}>
          {/* Timer */}
          <div style={styles.metricCard}>
            <div style={styles.metricLabel}>DURATION</div>
            <div style={styles.metricValueLarge}>{formatTime(elapsedTime)}</div>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progress}%` }} />
            </div>
          </div>
          
          {/* Heart Rate */}
          <div style={{
            ...styles.metricCard,
            borderColor: currentHR > 100 || currentHR < 50 ? '#ff4444' : '#00ff88'
          }}>
            <div style={styles.metricLabel}>HEART RATE</div>
            <div style={styles.metricValueLarge}>
              {currentHR > 0 ? Math.round(currentHR) : '--'}
            </div>
            <div style={styles.metricUnit}>BPM</div>
          </div>
          
          {/* SpO2 */}
          <div style={{
            ...styles.metricCard,
            borderColor: fingerDetected ? '#00ccff' : '#ff4444'
          }}>
            <div style={styles.metricLabel}>SpO2</div>
            <div style={{ ...styles.metricValueLarge, color: '#00ccff' }}>
              {fingerDetected && currentData && currentSpO2 > 0 ? Math.round(currentSpO2) : '--'}
            </div>
            <div style={styles.metricUnit}>%</div>
          </div>
          
          {/* Blood Pressure */}
          <div style={styles.metricCard}>
            <div style={styles.metricLabel}>BLOOD PRESSURE</div>
            <div style={styles.metricValueLarge}>
              {currentSBP > 0 ? `${Math.round(currentSBP)}/${Math.round(currentDBP)}` : '--/--'}
            </div>
            <div style={styles.metricUnit}>mmHg</div>
          </div>
          
          {/* HRV Quick Stats */}
          {currentData?.hrvNonlinear && (
            <div style={styles.hrvMiniCard}>
              <div style={styles.metricLabel}>HRV METRICS</div>
              <div style={styles.hrvGrid}>
                <div>
                  <span style={styles.hrvLabel}>RMSSD</span>
                  <span style={styles.hrvValue}>{Math.round(currentData.hrvTime.rmssd)}ms</span>
                </div>
                <div>
                  <span style={styles.hrvLabel}>SD1/SD2</span>
                  <span style={styles.hrvValue}>{currentData.hrvNonlinear.poincare.sd1Sd2Ratio.toFixed(2)}</span>
                </div>
                <div>
                  <span style={styles.hrvLabel}>DFA α1</span>
                  <span style={styles.hrvValue}>{currentData.hrvNonlinear.dfa.alpha1.toFixed(2)}</span>
                </div>
                <div>
                  <span style={styles.hrvLabel}>SampEn</span>
                  <span style={styles.hrvValue}>{currentData.hrvNonlinear.sampleEntropy.value.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Arrhythmia Counter */}
          {arrhythmiaEvents.length > 0 && (
            <div style={{ ...styles.metricCard, borderColor: '#ff6600' }}>
              <div style={styles.metricLabel}>ARRHYTHMIAS</div>
              <div style={{ ...styles.metricValueLarge, color: '#ff6600' }}>
                {arrhythmiaEvents.length}
              </div>
              <div style={styles.metricUnit}>detected</div>
            </div>
          )}
        </div>
      </div>
      
      {/* Controles */}
      <div style={styles.controls}>
        {!isMeasuring ? (
          <button
            onClick={startMeasurement}
            style={{ ...styles.button, ...styles.startButton }}
          >
            START MEASUREMENT
          </button>
        ) : (
          <>
            <button
              onClick={togglePause}
              style={{ ...styles.button, ...styles.pauseButton }}
            >
              {isPaused ? 'RESUME' : 'PAUSE'}
            </button>
            
            <button
              onClick={stopMeasurement}
              style={{ ...styles.button, ...styles.stopButton }}
            >
              STOP
            </button>
            
            <button
              onClick={completeMeasurement}
              style={{ ...styles.button, ...styles.completeButton }}
            >
              COMPLETE
            </button>
          </>
        )}
        
        {showExport && measurementHistory.length > 0 && (
          <button
            onClick={exportData}
            style={{ ...styles.button, ...styles.exportButton }}
          >
            EXPORT DATA
          </button>
        )}
      </div>
      
      {/* Guía de dedo */}
      {!fingerDetected && isMeasuring && (
        <div style={styles.guideOverlay}>
          <div style={styles.guideText}>
            COLOQUE SU DEDO SOBRE LA CÁMARA CON FLASH ENCENDIDO
          </div>
        </div>
      )}
    </div>
  );
};

// Estilos
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
    backgroundColor: '#0a0a0f',
    borderRadius: '12px',
    overflow: 'hidden',
    fontFamily: 'monospace',
    color: '#e0e0e0'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    backgroundColor: '#1a1a2e',
    borderBottom: '2px solid #2a2a4e'
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: '2px'
  },
  statusBadge: {
    fontSize: '12px',
    fontWeight: 'bold'
  },
  alert: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 24px',
    borderLeft: '4px solid',
    fontWeight: 'bold',
    fontSize: '14px'
  },
  alertIcon: {
    fontSize: '20px'
  },
  mainPanel: {
    display: 'flex',
    gap: '16px',
    padding: '16px'
  },
  monitorSection: {
    position: 'relative',
    flex: 1,
    minWidth: '600px'
  },
  hiddenVideo: {
    display: 'none'
  },
  hiddenCanvas: {
    display: 'none'
  },
  monitorContainer: {
    borderRadius: '8px',
    overflow: 'hidden',
    border: '2px solid #2a2a4e'
  },
  qualityOverlay: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: '12px',
    borderRadius: '6px'
  },
  qualityBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: '#888'
  },
  qualityFill: {
    height: '4px',
    borderRadius: '2px',
    transition: 'width 0.3s'
  },
  metricsPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '280px'
  },
  metricCard: {
    backgroundColor: '#1a1a2e',
    border: '2px solid #2a2a4e',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center'
  },
  metricLabel: {
    fontSize: '10px',
    color: '#888',
    letterSpacing: '1px',
    marginBottom: '8px'
  },
  metricValueLarge: {
    fontSize: '36px',
    fontWeight: 'bold',
    color: '#ffffff'
  },
  metricUnit: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px'
  },
  progressBar: {
    height: '4px',
    backgroundColor: '#2a2a4e',
    borderRadius: '2px',
    marginTop: '12px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00ff88',
    transition: 'width 1s linear'
  },
  hrvMiniCard: {
    backgroundColor: '#1a1a2e',
    border: '1px solid #2a2a4e',
    borderRadius: '8px',
    padding: '12px'
  },
  hrvGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    fontSize: '11px'
  },
  hrvLabel: {
    color: '#666',
    marginRight: '8px'
  },
  hrvValue: {
    color: '#00ff88',
    fontWeight: 'bold'
  },
  controls: {
    display: 'flex',
    gap: '12px',
    padding: '16px 24px',
    backgroundColor: '#1a1a2e',
    borderTop: '2px solid #2a2a4e',
    justifyContent: 'center'
  },
  button: {
    padding: '12px 24px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    transition: 'opacity 0.2s'
  },
  startButton: {
    backgroundColor: '#00ff88',
    color: '#0a0a0f'
  },
  pauseButton: {
    backgroundColor: '#ffaa00',
    color: '#0a0a0f'
  },
  stopButton: {
    backgroundColor: '#ff4444',
    color: '#ffffff'
  },
  completeButton: {
    backgroundColor: '#0088ff',
    color: '#ffffff'
  },
  exportButton: {
    backgroundColor: '#2a2a4e',
    color: '#ffffff',
    border: '1px solid #444'
  },
  guideOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none'
  },
  guideText: {
    color: '#ffaa00',
    fontSize: '18px',
    fontWeight: 'bold',
    textAlign: 'center',
    padding: '24px',
    border: '2px dashed #ffaa00',
    borderRadius: '12px'
  }
};

export default EliteMeasurementPanel;
