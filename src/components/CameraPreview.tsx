import React, { useRef, useEffect } from 'react';

interface CameraPreviewProps {
  stream: MediaStream | null;
  signalQuality: number;
  fingerDetected: boolean;
}

/**
 * Vista previa de la cámara con indicador de calidad real
 */
const CameraPreview: React.FC<CameraPreviewProps> = ({
  stream,
  signalQuality,
  fingerDetected
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (stream) {
      video.srcObject = stream;
      video.play().catch(e => console.log('Video preview play error:', e));
    } else {
      video.srcObject = null;
    }
    
    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [stream]);
  
  // Si no hay stream, mostrar placeholder
  if (!stream) {
    return (
      <div className="absolute top-4 right-4 z-20">
        <div className="w-24 h-32 rounded-lg bg-gray-900 border-2 border-white/20 flex items-center justify-center">
          <div className="text-white/50 text-xs text-center p-2">
            Sin cámara
          </div>
        </div>
      </div>
    );
  }
  
  const getQualityColor = () => {
    if (signalQuality > 60) return 'bg-emerald-500';
    if (signalQuality > 30) return 'bg-yellow-500';
    return 'bg-red-500';
  };
  
  const getQualityLabel = () => {
    if (!fingerDetected) return 'Sin dedo';
    if (signalQuality > 60) return 'Excelente';
    if (signalQuality > 30) return 'Regular';
    return 'Baja';
  };
  
  const getQualityBarColor = () => {
    if (signalQuality > 60) return 'bg-emerald-400';
    if (signalQuality > 30) return 'bg-yellow-400';
    return 'bg-red-400';
  };
  
  return (
    <div className="absolute top-4 right-4 z-20">
      <div className="relative w-28 h-36 rounded-xl overflow-hidden border-2 border-white/30 shadow-xl bg-black">
        {/* Video preview - sin espejo para cámara trasera */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
        />
        
        {/* Overlay con gradiente */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
        
        {/* Indicador de calidad */}
        <div className="absolute bottom-0 left-0 right-0 p-2">
          {/* Barra de progreso de calidad */}
          <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden mb-1">
            <div 
              className={`h-full transition-all duration-300 ${getQualityBarColor()}`}
              style={{ width: `${Math.max(5, signalQuality)}%` }}
            />
          </div>
          
          {/* Datos de calidad */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${getQualityColor()} ${fingerDetected ? 'animate-pulse' : ''}`} />
              <span className="text-white text-[10px] font-medium">
                {Math.round(signalQuality)}%
              </span>
            </div>
            <span className="text-white/80 text-[9px]">
              {getQualityLabel()}
            </span>
          </div>
        </div>
        
        {/* Indicador de dedo detectado */}
        {fingerDetected && (
          <div className="absolute top-1 left-1 w-3 h-3 rounded-full bg-emerald-500 border border-white/50 animate-pulse" />
        )}
      </div>
    </div>
  );
};

export default CameraPreview;