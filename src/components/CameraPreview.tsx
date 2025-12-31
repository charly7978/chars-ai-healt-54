/**
 * @file CameraPreview.tsx
 * @description Ventana pequeña de previsualización de cámara para guiar al usuario
 * Ubicada en esquina inferior izquierda para no tapar indicadores superiores
 */

import React, { useRef, useEffect, useState } from "react";

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
  const [showGuide, setShowGuide] = useState(true);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Ocultar guía después de detección exitosa estable
  useEffect(() => {
    if (isFingerDetected && signalQuality > 60) {
      const timer = setTimeout(() => setShowGuide(false), 4000);
      return () => clearTimeout(timer);
    } else {
      setShowGuide(true);
    }
  }, [isFingerDetected, signalQuality]);

  if (!isVisible) return null;

  // Determinar estado visual
  const getStatusColor = () => {
    if (!isFingerDetected) return "border-red-500";
    if (signalQuality < 40) return "border-yellow-500";
    if (signalQuality < 70) return "border-blue-400";
    return "border-green-500";
  };

  const getStatusBg = () => {
    if (!isFingerDetected) return "bg-red-900/40";
    if (signalQuality < 40) return "bg-yellow-900/40";
    if (signalQuality < 70) return "bg-blue-900/40";
    return "bg-green-900/40";
  };

  const getStatusText = () => {
    if (!isFingerDetected) return "SIN DEDO";
    if (signalQuality < 40) return "AJUSTE";
    if (signalQuality < 70) return "LEYENDO...";
    return "ÓPTIMO";
  };

  return (
    <div className="fixed bottom-28 left-3 z-40 flex flex-col items-start gap-1">
      {/* Ventana de previsualización compacta */}
      <div 
        className={`relative rounded-lg overflow-hidden shadow-xl transition-all duration-300 ${getStatusColor()} ${getStatusBg()} border-2`}
        style={{ width: '80px', height: '80px' }}
      >
        {/* Video de la cámara */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover opacity-80"
        />
        
        {/* Overlay de estado */}
        {showGuide && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
            <span className="text-white text-[8px] font-bold text-center px-1 leading-tight">
              {getStatusText()}
            </span>
          </div>
        )}

        {/* Barra de calidad */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
          <div 
            className={`h-full transition-all duration-300 ${
              signalQuality >= 70 ? 'bg-green-400' :
              signalQuality >= 40 ? 'bg-yellow-400' : 'bg-red-400'
            }`}
            style={{ width: `${Math.min(100, signalQuality)}%` }}
          />
        </div>

        {/* Pulso indicador cuando detecta bien */}
        {isFingerDetected && signalQuality > 50 && (
          <div className="absolute top-1 right-1">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>
        )}
      </div>

      {/* Texto de ayuda breve */}
      {!isFingerDetected && (
        <div className="bg-black/70 rounded px-2 py-1 max-w-[90px]">
          <p className="text-white text-[7px] leading-tight">
            Cubra cámara con dedo
          </p>
        </div>
      )}
    </div>
  );
};

export default CameraPreview;
