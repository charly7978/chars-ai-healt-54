/**
 * Ejemplo Básico de Integración - Componente React
 * 
 * Este ejemplo muestra cómo integrar los módulos avanzados
 * en un componente de medición existente.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useSignalProcessor } from '@/hooks/useSignalProcessor';
import { useHeartBeatProcessor } from '@/hooks/useHeartBeatProcessor';
import { 
  AdvancedFingerTracker, 
  type FingerTrackingResult 
} from '@/modules/signal-processing';
import { 
  AdvancedArrhythmiaDetector, 
  type ArrhythmiaResult,
  type ArrhythmiaType 
} from '@/modules/vital-signs';
import { 
  AdvancedPPGVisualizer 
} from '@/modules/visualization';

interface MeasurementState {
  isMeasuring: boolean;
  fingerDetected: boolean;
  contactQuality: number;
  currentBPM: number;
  arrhythmiaType: ArrhythmiaType | null;
  arrhythmiaConfidence: number;
  signalQuality: number;
}

export const BasicMeasurementWithAdvancedTracking: React.FC = () => {
  // Refs para elementos DOM
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Refs para módulos avanzados
  const fingerTracker = useRef<AdvancedFingerTracker | null>(null);
  const arrhythmiaDetector = useRef<AdvancedArrhythmiaDetector | null>(null);
  const visualizer = useRef<AdvancedPPGVisualizer | null>(null);
  
  // Hooks existentes del sistema
  const signalProcessor = useSignalProcessor();
  const heartProcessor = useHeartBeatProcessor();
  
  // Estado local
  const [state, setState] = useState<MeasurementState>({
    isMeasuring: false,
    fingerDetected: false,
    contactQuality: 0,
    currentBPM: 0,
    arrhythmiaType: null,
    arrhythmiaConfidence: 0,
    signalQuality: 0
  });
  
  const [tracking, setTracking] = useState<FingerTrackingResult | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  // Inicialización
  useEffect(() => {
    // Crear instancias de módulos avanzados
    fingerTracker.current = new AdvancedFingerTracker();
    arrhythmiaDetector.current = new AdvancedArrhythmiaDetector();
    
    if (canvasRef.current) {
      visualizer.current = new AdvancedPPGVisualizer({
        canvas: canvasRef.current,
        width: canvasRef.current.clientWidth,
        height: 300,
        bufferSize: 300,
        showPoincare: true,
        showSpectrum: false,
        showMorphology: true,
        colorTheme: 'medical'
      });
    }
    
    return () => {
      // Cleanup
      fingerTracker.current?.reset();
      arrhythmiaDetector.current?.reset();
      visualizer.current?.destroy();
      stopCamera();
    };
  }, []);

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
      
      addDebug('Cámara iniciada correctamente');
      
      // Iniciar procesamiento de frames
      startFrameProcessing();
      
    } catch (err) {
      addDebug(`Error cámara: ${err}`);
    }
  }, []);

  // Detener cámara
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    signalProcessor.stopProcessing();
    
    setState(prev => ({ ...prev, isMeasuring: false }));
    addDebug('Medición detenida');
  }, []);

  // Procesamiento de frames
  const startFrameProcessing = useCallback(() => {
    if (!videoRef.current) return;
    
    setState(prev => ({ ...prev, isMeasuring: true }));
    signalProcessor.startProcessing();
    
    const processFrame = () => {
      if (!videoRef.current || !state.isMeasuring) return;
      
      const video = videoRef.current;
      
      // Crear canvas temporal para capturar frame
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = video.videoWidth;
      tempCanvas.height = video.videoHeight;
      const ctx = tempCanvas.getContext('2d');
      
      if (!ctx) return;
      
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const timestamp = performance.now();
      
      // 1. TRACKER AVANZADO DE DEDO
      const trackingResult = fingerTracker.current!.processFrame(imageData);
      setTracking(trackingResult);
      
      // Actualizar estado
      setState(prev => ({
        ...prev,
        fingerDetected: trackingResult.contactQuality > 40,
        contactQuality: Math.round(trackingResult.contactQuality),
        signalQuality: Math.round(trackingResult.signalToNoiseRatio * 5) // Escala a 0-100
      }));
      
      // Solo procesar PPG si calidad es suficiente
      if (trackingResult.contactQuality > 50) {
        // 2. PROCESADOR PPG EXISTENTE
        signalProcessor.processFrame(imageData, timestamp);
        
        // 3. DETECTOR DE LATIDOS
        const beatResult = heartProcessor.processBeat(
          signalProcessor.lastSignal?.filteredValue || 0,
          timestamp,
          {
            quality: trackingResult.contactQuality,
            contactState: trackingResult.stabilityScore > 0.7 ? 'STABLE_CONTACT' : 'UNSTABLE_CONTACT',
            motionArtifact: trackingResult.driftVelocity > 5
          }
        );
        
        setState(prev => ({
          ...prev,
          currentBPM: Math.round(beatResult.bpm)
        }));
        
        // 4. DETECTOR AVANZADO DE ARRITMIAS
        if (beatResult.isPeak && beatResult.rrData.intervals.length > 0) {
          const rrInterval = beatResult.rrData.intervals[beatResult.rrData.intervals.length - 1];
          
          // Obtener ventana de señal PPG
          const ppgWindow = getSignalWindow();
          
          const arrhythmiaResult = arrhythmiaDetector.current!.processBeat(
            rrInterval,
            timestamp,
            ppgWindow,
            ppgWindow.length - 1,
            beatResult.beatSQI
          );
          
          if (arrhythmiaResult && arrhythmiaResult.confidence > 0.6) {
            setState(prev => ({
              ...prev,
              arrhythmiaType: arrhythmiaResult.primaryDiagnosis,
              arrhythmiaConfidence: arrhythmiaResult.confidence
            }));
            
            addDebug(`Arritmia: ${arrhythmiaResult.primaryDiagnosis} (${(arrhythmiaResult.confidence * 100).toFixed(0)}%)`);
          }
        }
        
        // 5. VISUALIZADOR AVANZADO
        visualizer.current!.addSample({
          timestamp,
          value: trackingResult.roiMeanR,
          filteredValue: signalProcessor.lastSignal?.filteredValue || 0,
          quality: trackingResult.contactQuality,
          isPeak: beatResult.isPeak,
          beatSQI: beatResult.beatSQI
        });
      }
      
      // Continuar loop
      requestAnimationFrame(processFrame);
    };
    
    requestAnimationFrame(processFrame);
  }, [state.isMeasuring]);

  // Helper para obtener ventana de señal
  const getSignalWindow = (): number[] => {
    // Simulación - en implementación real, obtener del historial
    return Array(25).fill(0).map(() => Math.random() * 100);
  };

  // Debug logging
  const addDebug = (msg: string) => {
    setDebugInfo(prev => [...prev.slice(-20), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Formatear nombre de arritmia
  const formatArrhythmia = (type: ArrhythmiaType | null): string => {
    if (!type) return 'Sin arritmias detectadas';
    
    const names: Record<ArrhythmiaType, string> = {
      'NORMAL_SINUS_RHYTHM': 'Ritmo sinusal normal',
      'SINUS_BRADYCARDIA': 'Bradicardia sinusal',
      'SINUS_TACHYCARDIA': 'Taquicardia sinusal',
      'ATRIAL_FIBRILLATION': 'Fibrilación auricular',
      'PREMATURE_ATRIAL_CONTRACTION': 'Contracción auricular prematura',
      'PREMATURE_VENTRICULAR_CONTRACTION': 'Contracción ventricular prematura',
      'VENTRICULAR_TACHYCARDIA': 'Taquicardia ventricular',
      'BIGEMINY': 'Bigeminismo',
      'TRIGEMINY': 'Trigeminismo',
      'HEART_BLOCK': 'Bloqueo cardíaco',
      'UNDETERMINED': 'Indeterminado',
      'ARTIFACT': 'Artefacto'
    };
    
    return names[type] || type;
  };

  return (
    <div className="measurement-container" style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Medición PPG con Tracking Avanzado</h2>
      
      {/* Controles */}
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={startCamera}
          disabled={state.isMeasuring}
          style={{ 
            padding: '10px 20px', 
            marginRight: '10px',
            backgroundColor: state.isMeasuring ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: state.isMeasuring ? 'not-allowed' : 'pointer'
          }}
        >
          Iniciar Medición
        </button>
        
        <button 
          onClick={stopCamera}
          disabled={!state.isMeasuring}
          style={{ 
            padding: '10px 20px',
            backgroundColor: !state.isMeasuring ? '#ccc' : '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: !state.isMeasuring ? 'not-allowed' : 'pointer'
          }}
        >
          Detener
        </button>
      </div>
      
      {/* Preview de cámara */}
      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <video
          ref={videoRef}
          className="camera-feed"
          playsInline
          muted
          style={{ 
            width: '100%', 
            maxWidth: '400px',
            borderRadius: '8px',
            backgroundColor: '#000'
          }}
        />
        
        {/* Overlay de tracking */}
        {tracking && state.isMeasuring && (
          <div style={{
            position: 'absolute',
            top: 10,
            left: 10,
            backgroundColor: 'rgba(0,0,0,0.7)',
            color: 'white',
            padding: '10px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            <div>Contacto: {tracking.contactQuality.toFixed(0)}%</div>
            <div>Stabilidad: {(tracking.stabilityScore * 100).toFixed(0)}%</div>
            <div>Perfusion: {tracking.perfusionIndex.toFixed(2)}%</div>
            <div>SNR: {tracking.signalToNoiseRatio.toFixed(1)} dB</div>
          </div>
        )}
      </div>
      
      {/* Visualizador PPG */}
      <div style={{ marginBottom: '20px' }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '300px',
            backgroundColor: '#0a1628',
            borderRadius: '8px'
          }}
        />
      </div>
      
      {/* Panel de métricas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '10px',
        marginBottom: '20px'
      }}>
        <MetricCard 
          label="BPM"
          value={state.currentBPM || '--'}
          color="#00ff88"
        />
        <MetricCard 
          label="Calidad"
          value={`${state.contactQuality}%`}
          color={state.contactQuality > 70 ? '#00ff88' : state.contactQuality > 40 ? '#ffcc00' : '#ff4444'}
        />
        <MetricCard 
          label="Señal"
          value={`${state.signalQuality}%`}
          color="#00ccff"
        />
        <MetricCard 
          label="Arritmia"
          value={state.arrhythmiaType ? `${(state.arrhythmiaConfidence * 100).toFixed(0)}%` : '--'}
          color={state.arrhythmiaConfidence > 0.7 ? '#ff4444' : '#888'}
        />
      </div>
      
      {/* Alerta de arritmia */}
      {state.arrhythmiaType && state.arrhythmiaConfidence > 0.7 && (
        <div style={{
          padding: '15px',
          backgroundColor: '#ff4444',
          color: 'white',
          borderRadius: '8px',
          marginBottom: '20px',
          textAlign: 'center',
          fontWeight: 'bold'
        }}>
          ⚠️ {formatArrhythmia(state.arrhythmiaType)}
          <div style={{ fontSize: '12px', marginTop: '5px', opacity: 0.9 }}>
            Confianza: {(state.arrhythmiaConfidence * 100).toFixed(1)}%
          </div>
        </div>
      )}
      
      {/* Debug log */}
      <div style={{
        backgroundColor: '#1a1a1a',
        color: '#00ff00',
        padding: '10px',
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: 'monospace',
        height: '150px',
        overflow: 'auto'
      }}>
        {debugInfo.map((msg, i) => (
          <div key={i}>{msg}</div>
        ))}
      </div>
    </div>
  );
};

// Componente MetricCard
const MetricCard: React.FC<{ label: string; value: string; color: string }> = ({ 
  label, value, color 
}) => (
  <div style={{
    backgroundColor: '#1a1a2e',
    padding: '15px',
    borderRadius: '8px',
    textAlign: 'center',
    border: `2px solid ${color}`
  }}>
    <div style={{ fontSize: '24px', fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: '12px', color: '#888', marginTop: '5px' }}>{label}</div>
  </div>
);

export default BasicMeasurementWithAdvancedTracking;
