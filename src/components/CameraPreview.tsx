/**
 * @file CameraPreview.tsx
 * @description ÚNICO INDICADOR DE CALIDAD DE SEÑAL
 * Muestra valores graduales reales (0-100) con suavizado para evitar saltos bruscos
 */

import React, { useRef, useEffect, useState, useMemo } from "react";

interface CameraPreviewProps {
  stream: MediaStream | null;
  isFingerDetected: boolean;
  signalQuality: number;
  isVisible: boolean;
}

const CameraPreview: React.FC<CameraPreviewProps> = ({
  stream,
  isFingerDetected,
  signalQuality,
  isVisible
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // SUAVIZADO DE CALIDAD - evita saltos bruscos de 0 a 100
  const smoothedQualityRef = useRef<number>(0);
  const [displayQuality, setDisplayQuality] = useState(0);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Suavizar calidad con interpolación exponencial
  useEffect(() => {
    const targetQuality = isFingerDetected ? signalQuality : 0;
    
    // Factor de suavizado: 0.15 = suave pero responsivo
    const SMOOTHING_FACTOR = 0.15;
    
    const animate = () => {
      const current = smoothedQualityRef.current;
      const diff = targetQuality - current;
      
      // Si la diferencia es menor a 1, llegamos al objetivo
      if (Math.abs(diff) < 1) {
        smoothedQualityRef.current = targetQuality;
        setDisplayQuality(Math.round(targetQuality));
        return;
      }
      
      // Interpolar suavemente
      smoothedQualityRef.current = current + diff * SMOOTHING_FACTOR;
      setDisplayQuality(Math.round(smoothedQualityRef.current));
    };
    
    const interval = setInterval(animate, 50); // 20 updates/sec
    return () => clearInterval(interval);
  }, [signalQuality, isFingerDetected]);

  if (!isVisible) return null;

  // Determinar color basado en calidad GRADUAL
  const getQualityColor = () => {
    if (displayQuality < 15) return { border: "border-red-500", bg: "bg-red-500", text: "text-red-400" };
    if (displayQuality < 30) return { border: "border-orange-500", bg: "bg-orange-500", text: "text-orange-400" };
    if (displayQuality < 50) return { border: "border-yellow-500", bg: "bg-yellow-500", text: "text-yellow-400" };
    if (displayQuality < 70) return { border: "border-blue-400", bg: "bg-blue-400", text: "text-blue-400" };
    return { border: "border-green-500", bg: "bg-green-500", text: "text-green-400" };
  };

  // Texto descriptivo basado en rangos graduales
  const getStatusText = () => {
    if (displayQuality < 15) return "Sin señal";
    if (displayQuality < 30) return "Muy débil";
    if (displayQuality < 50) return "Débil";
    if (displayQuality < 70) return "Aceptable";
    if (displayQuality < 85) return "Buena";
    return "Óptima";
  };

  const colors = getQualityColor();

  return (
    <div className="fixed top-20 right-2 z-30 flex flex-col items-end gap-1">
      {/* Ventana de previsualización */}
      <div 
        className={`relative rounded-lg overflow-hidden shadow-lg transition-all duration-300 ${colors.border} bg-black/60 border-2`}
        style={{ width: '120px', height: '90px' }}
      >
        {/* Video de la cámara */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover opacity-80"
        />
        
        {/* Overlay con calidad numérica */}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
          <span className={`text-2xl font-bold ${colors.text}`}>
            {displayQuality}%
          </span>
          <span className="text-white text-[10px] font-medium mt-0.5">
            {getStatusText()}
          </span>
        </div>

        {/* Barra de calidad gradual */}
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/70">
          <div 
            className={`h-full transition-all duration-200 ${colors.bg}`}
            style={{ width: `${displayQuality}%` }}
          />
        </div>
      </div>

      {/* Instrucción solo si calidad muy baja */}
      {displayQuality < 30 && (
        <div className="bg-black/70 rounded px-2 py-1 max-w-[120px]">
          <p className="text-white text-[9px] leading-tight text-center">
            {displayQuality < 15 
              ? "Cubra la cámara y flash con el dedo"
              : "Ajuste la posición del dedo"
            }
          </p>
        </div>
      )}
    </div>
  );
};

export default CameraPreview;
