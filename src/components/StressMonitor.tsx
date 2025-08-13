import React, { useEffect, useRef, useState } from 'react';
import { StressAnalyzer, StressMetrics } from '../analyzers/StressAnalyzer';
import { StressVisualizer } from '../visualization/StressVisualizer';

interface StressMonitorProps {
  /**
   * Tasa de muestreo de la señal PPG en Hz
   * @default 30
   */
  samplingRate?: number;
  
  /**
   * Tamaño del búfer circular (número de puntos)
   * @default 300
   */
  bufferSize?: number;
  
  /**
   * Duración de la calibración en segundos
   * @default 180
   */
  calibrationDuration?: number;
  
  /**
   * Intervalo de actualización de la interfaz en milisegundos
   * @default 10000
   */
  updateInterval?: number;
  
  /**
   * Función llamada cuando se actualizan las métricas de estrés
   */
  onStressUpdate?: (metrics: StressMetrics) => void;
  
  /**
   * Clases CSS personalizadas
   */
  className?: string;
  
  /**
   * Estilos en línea
   */
  style?: React.CSSProperties;
}

/**
 * Componente para monitorear y visualizar el estrés en tiempo real
 * basado en el análisis de la señal PPG.
 */
const StressMonitor: React.FC<StressMonitorProps> = ({
  samplingRate = 30,
  bufferSize = 300,
  calibrationDuration = 180,
  updateInterval = 10000,
  onStressUpdate,
  className = '',
  style = {}
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<StressAnalyzer | null>(null);
  const visualizerRef = useRef<StressVisualizer | null>(null);
  const animationFrameRef = useRef<number>();
  const [isCalibrating, setIsCalibrating] = useState<boolean>(true);
  const [calibrationProgress, setCalibrationProgress] = useState<number>(0);
  const [currentMetrics, setCurrentMetrics] = useState<StressMetrics | null>(null);
  
  // Inicializar analizador y visualizador
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // Inicializar analizador
    analyzerRef.current = new StressAnalyzer(bufferSize, samplingRate);
    
    // Inicializar visualizador
    visualizerRef.current = new StressVisualizer(canvasRef.current.id);
    
    // Manejar redimensionamiento de la ventana
    const handleResize = () => {
      visualizerRef.current?.handleResize();
    };
    
    window.addEventListener('resize', handleResize);
    
    // Iniciar calibración
    startCalibration();
    
    return () => {
      // Limpiar al desmontar
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [bufferSize, samplingRate]);
  
  // Iniciar calibración
  const startCalibration = () => {
    if (!analyzerRef.current) return;
    
    setIsCalibrating(true);
    setCalibrationProgress(0);
    
    const startTime = Date.now();
    const calibrationMs = calibrationDuration * 1000;
    
    // Actualizar progreso de calibración
    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, (elapsed / calibrationMs) * 100);
      setCalibrationProgress(progress);
      
      if (progress < 100) {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      } else {
        setIsCalibrating(false);
        startMonitoring();
      }
    };
    
    // Iniciar actualización de progreso
    animationFrameRef.current = requestAnimationFrame(updateProgress);
    
    // Iniciar calibración en el analizador
    analyzerRef.current.calibrate();
  };
  
  // Iniciar monitoreo continuo
  const startMonitoring = () => {
    if (!analyzerRef.current) return;
    
    // Configurar temporizador para actualizaciones periódicas
    const timer = setInterval(() => {
      if (!analyzerRef.current) {
        clearInterval(timer);
        return;
      }
      
      // Aquí se procesarían los datos de la señal PPG
      // En una implementación real, esto vendría de un sensor o fuente de datos en tiempo real
      // Por ahora, simulamos datos de ejemplo
      simulatePPGData();
      
    }, 1000 / samplingRate);
    
    return () => clearInterval(timer);
  };
  
  // Simular datos PPG para demostración
  const simulatePPGData = () => {
    if (!analyzerRef.current) return;
    
    // Simular un punto de datos PPG
    const time = Date.now();
    const value = Math.random() * 0.5 + 0.5; // Valor entre 0.5 y 1.0
    
    // Procesar el punto de datos
    analyzerRef.current.processDataPoint({
      time,
      value,
      isArrhythmia: false,
      rawRed: Math.random() * 1000 + 50000, // Valores simulados para SpO2
      rawIr: Math.random() * 1000 + 40000   // Valores simulados para SpO2
    });
    
    // Actualizar visualización periódicamente
    if (time % updateInterval < 1000 / samplingRate) {
      const metrics = analyzerRef.current.getMetrics();
      if (metrics) {
        setCurrentMetrics(metrics);
        visualizerRef.current?.addData(metrics);
        onStressUpdate?.(metrics);
      }
    }
  };
  
  // Renderizar interfaz de calibración
  if (isCalibrating) {
    return (
      <div 
        className={`stress-monitor calibration ${className}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          borderRadius: '8px',
          backgroundColor: '#1e293b',
          color: '#f8fafc',
          ...style
        }}
      >
        <h3 style={{ marginBottom: '20px' }}>Calibrando...</h3>
        <div 
          style={{
            width: '100%',
            height: '20px',
            backgroundColor: '#334155',
            borderRadius: '10px',
            overflow: 'hidden',
            marginBottom: '10px'
          }}
        >
          <div 
            style={{
              width: `${calibrationProgress}%`,
              height: '100%',
              backgroundColor: '#3b82f6',
              transition: 'width 0.5s ease'
            }}
          />
        </div>
        <p>{Math.round(calibrationProgress)}% completado</p>
        <p style={{ marginTop: '20px', fontSize: '0.9em', opacity: 0.8 }}>
          Por favor, mantén la calma y permanece quieto durante la calibración.
        </p>
      </div>
    );
  }
  
  // Renderizar monitor de estrés
  return (
    <div 
      className={`stress-monitor ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        overflow: 'hidden',
        color: '#f8fafc',
        ...style
      }}
    >
      {/* Encabezado */}
      <div 
        style={{
          padding: '15px 20px',
          borderBottom: '1px solid #334155',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <h3 style={{ margin: 0 }}>Monitor de Estrés</h3>
        {currentMetrics && (
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <span>Calidad: {Math.round((currentMetrics.confidence || 0) * 100)}%</span>
            <button 
              onClick={startCalibration}
              style={{
                padding: '5px 10px',
                backgroundColor: '#334155',
                border: 'none',
                borderRadius: '4px',
                color: '#f8fafc',
                cursor: 'pointer',
                fontSize: '0.8em'
              }}
            >
              Recalibrar
            </button>
          </div>
        )}
      </div>
      
      {/* Gráfico */}
      <div 
        style={{
          flex: 1,
          minHeight: '300px',
          position: 'relative'
        }}
      >
        <canvas
          id="stress-canvas"
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block'
          }}
        />
      </div>
      
      {/* Leyenda */}
      <div 
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '15px',
          padding: '10px 20px',
          borderTop: '1px solid #334155',
          fontSize: '0.8em',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#10b981', borderRadius: '2px' }} />
          <span>Muy Bajo</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#a3e635', borderRadius: '2px' }} />
          <span>Bajo</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#f59e0b', borderRadius: '2px' }} />
          <span>Moderado</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#f97316', borderRadius: '2px' }} />
          <span>Alto</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#ef4444', borderRadius: '2px' }} />
          <span>Muy Alto</span>
        </div>
      </div>
    </div>
  );
};

export default StressMonitor;
