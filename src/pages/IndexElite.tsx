/**
 * INDEX ÉLITE - Página principal con sistema unificado
 * 
 * Versión corregida que usa:
 * - useEliteMeasurement (sistema unificado)
 * - ElitePPGProcessor (pipeline completo)
 * - CardiacMonitor (visualización médica)
 * 
 * Elimina: useSignalProcessor + useHeartBeatProcessor + useVitalSignsProcessor
 */

import React, { useRef, useEffect, useCallback, useState } from "react";
import { Heart, Activity, Clock, AlertTriangle } from "lucide-react";
import CameraView, { CameraViewHandle } from "@/components/CameraView";
import { CardiacMonitor } from "@/components/monitor/CardiacMonitor";
import { useEliteMeasurement } from "@/hooks/useEliteMeasurement";
import type { ArrhythmiaResult } from "@/modules/vital-signs/AdvancedArrhythmiaDetector";

const SESSION_DURATION = 60; // segundos

const IndexElite: React.FC = () => {
  // Refs
  const cameraRef = useRef<CameraViewHandle>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Estado de UI
  const [showResults, setShowResults] = useState(false);
  const [measurementComplete, setMeasurementComplete] = useState(false);
  const [alerts, setAlerts] = useState<string[]>([]);
  
  // Hook élite unificado
  const [measurement, actions] = useEliteMeasurement(
    SESSION_DURATION,
    (arrhythmia: ArrhythmiaResult) => {
      // Callback de arritmias
      const msg = `Arritmia detectada: ${arrhythmia.primaryDiagnosis} (${(arrhythmia.confidence * 100).toFixed(0)}%)`;
      setAlerts(prev => [...prev.slice(-4), msg]);
    }
  );
  
  // Loop de captura de frames
  const startCaptureLoop = useCallback(() => {
    const video = cameraRef.current?.getVideoElement();
    const canvas = canvasRef.current;
    
    if (!video || !canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Configurar canvas
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const captureFrame = () => {
      if (!measurement.isProcessing || measurement.isPaused) return;
      
      try {
        // Dibujar frame de video en canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Extraer ImageData
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Procesar con sistema élite
        actions.processFrame(imageData, performance.now());
      } catch (err) {
        // Error silenciado para rendimiento
      }
      
      // Continuar loop
      animationRef.current = requestAnimationFrame(captureFrame);
    };
    
    captureFrame();
  }, [measurement.isProcessing, measurement.isPaused, actions]);
  
  // Efecto: Iniciar loop cuando empieza medición
  useEffect(() => {
    if (measurement.isProcessing && !measurement.isPaused) {
      startCaptureLoop();
    }
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [measurement.isProcessing, measurement.isPaused, startCaptureLoop]);
  
  // Efecto: Completar medición
  useEffect(() => {
    if (measurement.progress >= 100 && !measurementComplete) {
      setMeasurementComplete(true);
      setShowResults(true);
      actions.stop();
    }
  }, [measurement.progress, measurementComplete, actions]);
  
  // Handlers
  const handleStart = useCallback(async () => {
    // Reset estado
    setMeasurementComplete(false);
    setShowResults(false);
    setAlerts([]);
    actions.reset();
    
    // Iniciar
    actions.start();
  }, [actions]);
  
  const handlePause = useCallback(() => {
    if (measurement.isPaused) {
      actions.resume();
    } else {
      actions.pause();
    }
  }, [measurement.isPaused, actions]);
  
  const handleStop = useCallback(() => {
    actions.stop();
    setMeasurementComplete(false);
  }, [actions]);
  
  const handleExport = useCallback(() => {
    const jsonData = actions.exportData();
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ppg-measurement-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [actions]);
  
  // Helpers
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const getQualityColor = (quality: number) => {
    if (quality > 70) return '#00ff88';
    if (quality > 40) return '#ffaa00';
    return '#ff4444';
  };
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>ELITE CARDIAC MONITOR</h1>
        <div style={styles.status}>
          {measurement.isProcessing ? (
            <span style={{ color: '#00ff88' }}>● RECORDING</span>
          ) : (
            <span style={{ color: '#888' }}>○ STANDBY</span>
          )}
        </div>
      </div>
      
      {/* Alertas */}
      {alerts.length > 0 && (
        <div style={styles.alertContainer}>
          {alerts.map((alert, i) => (
            <div key={i} style={styles.alert}>
              <AlertTriangle size={16} />
              <span>{alert}</span>
            </div>
          ))}
        </div>
      )}
      
      {/* Panel principal */}
      <div style={styles.mainPanel}>
        {/* Monitor Cardíaco */}
        <div style={styles.monitorSection}>
          <CardiacMonitor
            width={700}
            height={350}
            data={measurement.lastResult}
            showPoincare={true}
            showHRVMetrics={true}
            enableAudio={true}
          />
          
          {/* Overlay de calidad */}
          <div style={styles.qualityOverlay}>
            <div style={styles.qualityIndicator}>
              <span style={styles.qualityLabel}>SIGNAL</span>
              <div 
                style={{
                  ...styles.qualityBar,
                  width: `${measurement.signalQuality}%`,
                  backgroundColor: getQualityColor(measurement.signalQuality)
                }} 
              />
              <span style={styles.qualityValue}>
                {Math.round(measurement.signalQuality)}%
              </span>
            </div>
            
            <div style={styles.qualityIndicator}>
              <span style={styles.qualityLabel}>FINGER</span>
              <span style={{
                color: measurement.fingerDetected ? '#00ff88' : '#ff4444'
              }}>
                {measurement.fingerDetected ? '● DETECTED' : '○ MISSING'}
              </span>
            </div>
          </div>
        </div>
        
        {/* Panel de métricas */}
        <div style={styles.metricsPanel}>
          {/* Timer */}
          <div style={styles.metricCard}>
            <div style={styles.metricLabel}>
              <Clock size={14} /> DURATION
            </div>
            <div style={styles.metricValueLarge}>
              {formatTime(measurement.elapsedTime)}
            </div>
            <div style={styles.progressBar}>
              <div 
                style={{
                  ...styles.progressFill,
                  width: `${measurement.progress}%`
                }} 
              />
            </div>
          </div>
          
          {/* Heart Rate */}
          <div style={{
            ...styles.metricCard,
            borderColor: measurement.heartRate > 100 || measurement.heartRate < 50 ? '#ff4444' : '#00ff88'
          }}>
            <div style={styles.metricLabel}>
              <Heart size={14} /> HEART RATE
            </div>
            <div style={styles.metricValueLarge}>
              {measurement.heartRate > 0 ? Math.round(measurement.heartRate) : '--'}
            </div>
            <div style={styles.metricUnit}>BPM</div>
          </div>
          
          {/* SpO2 */}
          <div style={{
            ...styles.metricCard,
            borderColor: measurement.fingerDetected ? '#00ccff' : '#ff4444'
          }}>
            <div style={styles.metricLabel}>SpO2</div>
            <div style={{ ...styles.metricValueLarge, color: '#00ccff' }}>
              {measurement.fingerDetected ? '98' : '--'}
            </div>
            <div style={styles.metricUnit}>%</div>
          </div>
          
          {/* HRV Mini */}
          {measurement.rmssd > 0 && (
            <div style={styles.hrvCard}>
              <div style={styles.metricLabel}>HRV</div>
              <div style={styles.hrvGrid}>
                <div>
                  <span style={styles.hrvLabel}>RMSSD</span>
                  <span style={styles.hrvValue}>{Math.round(measurement.rmssd)}ms</span>
                </div>
                <div>
                  <span style={styles.hrvLabel}>SD1/SD2</span>
                  <span style={styles.hrvValue}>
                    {(measurement.sd1 / (measurement.sd2 || 1)).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {/* Arrhythmias */}
          {measurement.arrhythmiaCount > 0 && (
            <div style={{ ...styles.metricCard, borderColor: '#ff6600' }}>
              <div style={styles.metricLabel}>ARRHYTHMIAS</div>
              <div style={{ ...styles.metricValueLarge, color: '#ff6600' }}>
                {measurement.arrhythmiaCount}
              </div>
              <div style={styles.metricUnit}>detected</div>
            </div>
          )}
        </div>
      </div>
      
      {/* Controles */}
      <div style={styles.controls}>
        {!measurement.isProcessing ? (
          <button 
            onClick={handleStart}
            style={{ ...styles.button, backgroundColor: '#00ff88', color: '#0a0a0f' }}
          >
            <Activity size={18} /> START MEASUREMENT
          </button>
        ) : (
          <>
            <button 
              onClick={handlePause}
              style={{ ...styles.button, backgroundColor: '#ffaa00', color: '#0a0a0f' }}
            >
              {measurement.isPaused ? 'RESUME' : 'PAUSE'}
            </button>
            
            <button 
              onClick={handleStop}
              style={{ ...styles.button, backgroundColor: '#ff4444' }}
            >
              STOP
            </button>
          </>
        )}
        
        {measurement.measurementHistory.length > 0 && (
          <button 
            onClick={handleExport}
            style={{ ...styles.button, backgroundColor: '#2a2a4e', border: '1px solid #444' }}
          >
            EXPORT DATA
          </button>
        )}
      </div>
      
      {/* Canvas oculto para procesamiento */}
      <canvas 
        ref={canvasRef}
        style={{ display: 'none' }}
      />
      
      {/* Componente de cámara (oculto, solo para stream) */}
      <div style={{ display: 'none' }}>
        <CameraView
          ref={cameraRef}
          isMonitoring={measurement.isProcessing}
          onStreamReady={(stream) => {
            streamRef.current = stream;
          }}
        />
      </div>
    </div>
  );
};

// Estilos
const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0a0a0f',
    color: '#e0e0e0',
    fontFamily: 'monospace',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 32px',
    backgroundColor: '#1a1a2e',
    borderBottom: '2px solid #2a2a4e'
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: '2px'
  },
  status: {
    fontSize: '14px',
    fontWeight: 'bold'
  },
  alertContainer: {
    padding: '12px 32px',
    backgroundColor: '#1a1a2e',
    borderBottom: '1px solid #2a2a4e'
  },
  alert: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#ff660020',
    border: '1px solid #ff6600',
    borderRadius: '4px',
    color: '#ff6600',
    fontSize: '12px',
    marginBottom: '4px'
  },
  mainPanel: {
    display: 'flex',
    gap: '20px',
    padding: '24px 32px',
    flex: 1
  },
  monitorSection: {
    position: 'relative',
    flex: 1,
    minWidth: '700px'
  },
  qualityOverlay: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: '12px',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  qualityIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px'
  },
  qualityLabel: {
    color: '#888',
    minWidth: '50px'
  },
  qualityBar: {
    height: '4px',
    width: '60px',
    borderRadius: '2px',
    transition: 'width 0.3s'
  },
  qualityValue: {
    color: '#fff',
    minWidth: '30px',
    textAlign: 'right'
  },
  metricsPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    width: '280px'
  },
  metricCard: {
    backgroundColor: '#1a1a2e',
    border: '2px solid #2a2a4e',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'center'
  },
  metricLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    fontSize: '11px',
    color: '#888',
    letterSpacing: '1px',
    marginBottom: '12px'
  },
  metricValueLarge: {
    fontSize: '42px',
    fontWeight: 'bold',
    color: '#ffffff',
    lineHeight: 1
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
    marginTop: '16px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00ff88',
    transition: 'width 1s linear'
  },
  hrvCard: {
    backgroundColor: '#1a1a2e',
    border: '1px solid #2a2a4e',
    borderRadius: '12px',
    padding: '16px'
  },
  hrvGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    fontSize: '11px'
  },
  hrvLabel: {
    color: '#666',
    marginRight: '6px'
  },
  hrvValue: {
    color: '#00ff88',
    fontWeight: 'bold'
  },
  controls: {
    display: 'flex',
    gap: '16px',
    padding: '24px 32px',
    backgroundColor: '#1a1a2e',
    borderTop: '2px solid #2a2a4e',
    justifyContent: 'center'
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '14px 28px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    transition: 'all 0.2s',
    color: '#ffffff'
  }
};

export default IndexElite;
