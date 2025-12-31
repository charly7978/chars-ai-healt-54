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
    <div className="fixed top-20 right-2 z-30 flex flex-col items-end gap-1">
      {/* Ventana de previsualización pequeña - esquina superior derecha */}
      <div 
        className={`relative rounded-md overflow-hidden shadow-lg transition-all duration-300 ${getStatusColor()} ${getStatusBg()} border`}
        style={{ width: '56px', height: '56px' }}
      >
        {/* Video de la cámara */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover opacity-75"
        />
        
        {/* Overlay de estado minimalista */}
        {showGuide && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="text-white text-[6px] font-semibold text-center leading-tight">
              {getStatusText()}
            </span>
          </div>
        )}

        {/* Barra de calidad mini */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/50">
          <div 
            className={`h-full transition-all duration-300 ${
              signalQuality >= 70 ? 'bg-green-400' :
              signalQuality >= 40 ? 'bg-yellow-400' : 'bg-red-400'
            }`}
            style={{ width: `${Math.min(100, signalQuality)}%` }}
          />
        </div>
      </div>

      {/* Texto de ayuda breve solo si no hay dedo */}
      {!isFingerDetected && (
        <div className="bg-black/60 rounded px-1.5 py-0.5">
          <p className="text-white text-[6px] leading-tight">
            Cubra cámara
          </p>
        </div>
      )}
    </div>
  );
};

export default CameraPreview;
