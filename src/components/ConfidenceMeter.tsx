import React from 'react';

interface ConfidenceMeterProps {
  confidence: number; // 0-100
  label: string;
  size?: 'sm' | 'md' | 'lg';
  showPercentage?: boolean;
  className?: string;
}

const ConfidenceMeter: React.FC<ConfidenceMeterProps> = ({
  confidence,
  label,
  size = 'md',
  showPercentage = true,
  className = ''
}) => {
  // Asegurar que la confianza esté entre 0 y 100
  const normalizedConfidence = Math.min(100, Math.max(0, confidence));
  
  // Determinar el color basado en el nivel de confianza
  const getColor = (value: number) => {
    if (value < 30) return 'bg-red-500';
    if (value < 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  // Tamaños del medidor
  const sizeClasses = {
    sm: 'h-2',
    md: 'h-3',
    lg: 'h-4'
  };

  // Tamaños del texto
  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between items-center mb-1">
        <span className={`${textSizeClasses[size]} font-medium text-gray-300`}>
          {label}
        </span>
        {showPercentage && (
          <span className={`${textSizeClasses[size]} font-semibold text-white`}>
            {Math.round(normalizedConfidence)}%
          </span>
        )}
      </div>
      
      <div className={`w-full ${sizeClasses[size]} bg-gray-700/50 rounded-full overflow-hidden`}>
        <div 
          className={`h-full rounded-full transition-all duration-500 ${getColor(normalizedConfidence)}`}
          style={{ width: `${normalizedConfidence}%` }}
        />
      </div>
      
      {/* Indicadores de calidad */}
      <div className="flex justify-between mt-1">
        <span className={`${textSizeClasses[size]} text-gray-400`}>Baja</span>
        <span className={`${textSizeClasses[size]} text-gray-400`}>Media</span>
        <span className={`${textSizeClasses[size]} text-gray-400`}>Alta</span>
      </div>
    </div>
  );
};

export default ConfidenceMeter;
