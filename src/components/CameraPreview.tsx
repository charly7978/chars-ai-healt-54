/**
 * @file CameraPreview.tsx
 * @description Ventana pequeña de previsualización de cámara para guiar al usuario
 * Muestra el estado de detección de dedo en tiempo real
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

  // Ocultar guía después de detección exitosa por 3 segundos
  useEffect(() => {
    if (isFingerDetected && signalQuality > 50) {
      const timer = setTimeout(() => setShowGuide(false), 3000);
      return () => clearTimeout(timer);
    } else {
      setShowGuide(true);
    }
  }, [isFingerDetected, signalQuality]);

  if (!isVisible) return null;

  // Determinar estado visual
  const getStatusColor = () => {
    if (!isFingerDetected) return "border-red-500 bg-red-500/20";
    if (signalQuality < 40) return "border-yellow-500 bg-yellow-500/20";
    if (signalQuality < 70) return "border-blue-500 bg-blue-500/20";
    return "border-green-500 bg-green-500/20";
  };

  const getStatusText = () => {
    if (!isFingerDetected) return "Coloque el dedo";
    if (signalQuality < 40) return "Ajuste posición";
    if (signalQuality < 70) return "Mejorando...";
    return "¡Señal óptima!";
  };

  const getStatusIcon = () => {
    if (!isFingerDetected) return "👆";
    if (signalQuality < 40) return "⚠️";
    if (signalQuality < 70) return "📶";
    return "✅";
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Ventana de previsualización */}
      <div 
        className={`relative rounded-xl overflow-hidden shadow-2xl transition-all duration-300 ${getStatusColor()} border-4`}
        style={{ width: '120px', height: '120px' }}
      >
        {/* Video de la cámara */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        
        {/* Overlay de guía cuando no hay dedo detectado */}
        {showGuide && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="text-3xl mb-1 animate-bounce">
              {getStatusIcon()}
            </div>
            <span className="text-white text-[10px] font-bold text-center px-2 leading-tight">
              {getStatusText()}
            </span>
          </div>
        )}

        {/* Indicador de calidad */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-black/50">
          <div 
            className={`h-full transition-all duration-300 ${
              signalQuality >= 70 ? 'bg-green-500' :
              signalQuality >= 40 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${Math.min(100, signalQuality)}%` }}
          />
        </div>

        {/* Indicador de pulso cuando detecta */}
        {isFingerDetected && signalQuality > 50 && (
          <div className="absolute top-1 right-1">
            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          </div>
        )}
      </div>

      {/* Instrucciones adicionales */}
      {!isFingerDetected && (
        <div className="bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 max-w-[160px]">
          <p className="text-white text-[9px] leading-tight text-center">
            Cubra completamente la cámara trasera con su dedo índice. 
            Active el flash para mejor detección.
          </p>
        </div>
      )}
    </div>
  );
};

export default CameraPreview;
