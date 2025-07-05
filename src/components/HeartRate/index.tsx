import React from 'react';

type HeartRateProps = {
  bpm: number;
  confidence?: number;
  animated?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

export const HeartRate = ({ 
  bpm, 
  confidence = 1, 
  animated = false,
  size = 'md'
}: HeartRateProps) => {
  const isReliable = confidence > 0.5;
  
  // Tamaños y estilos
  const sizeClasses = {
    sm: "w-20 h-20 text-xl",
    md: "w-28 h-28 text-2xl",
    lg: "w-36 h-36 text-3xl"
  };

  return (
    <div className={`${sizeClasses[size]} bg-black/40 backdrop-blur-sm rounded-lg p-3 text-center`}>
      <h3 className="text-gray-400/90 text-sm mb-1">Heart Rate</h3>
      
      <div className="flex items-baseline justify-center gap-1">
        <span className={`font-bold ${isReliable ? 'text-white/90' : 'text-gray-500'}`}>
          {bpm > 0 ? bpm : '--'}
        </span>
        <span className="text-gray-400/90 text-xs">BPM</span>
      </div>
      
      {animated && (
        <div className="mt-2">
          {/* Animación de corazón podría agregarse aquí */}
        </div>
      )}
    </div>
  );
};
