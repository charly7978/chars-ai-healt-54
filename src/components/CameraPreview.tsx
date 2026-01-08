import React, { useRef, useEffect } from 'react';

interface CameraPreviewProps {
  stream: MediaStream | null;
  signalQuality: number;
  fingerDetected: boolean;
}

/**
 * Vista previa de la cámara con indicador de calidad
 */
const CameraPreview: React.FC<CameraPreviewProps> = ({
  stream,
  signalQuality,
  fingerDetected
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
    
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);
  
  if (!stream) return null;
  
  const getQualityColor = () => {
    if (signalQuality > 60) return 'bg-green-500';
    if (signalQuality > 30) return 'bg-yellow-500';
    return 'bg-red-500';
  };
  
  const getQualityLabel = () => {
    if (signalQuality > 60) return 'Buena';
    if (signalQuality > 30) return 'Regular';
    return 'Baja';
  };
  
  return (
    <div className="absolute top-4 right-4 z-20">
      <div className="relative w-24 h-32 rounded-lg overflow-hidden border-2 border-white/30 shadow-lg">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        
        {/* Indicador de calidad */}
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${getQualityColor()}`} />
            <span className="text-white text-xs">{Math.round(signalQuality)}%</span>
          </div>
          <div className="text-white/70 text-[10px]">
            {fingerDetected ? getQualityLabel() : 'Sin dedo'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CameraPreview;
