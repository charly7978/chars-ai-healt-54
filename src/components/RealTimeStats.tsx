import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ConfidenceMeter from './ConfidenceMeter';

interface StatItem {
  label: string;
  value: string | number;
  unit?: string;
  confidence?: number;
  trend?: 'up' | 'down' | 'stable';
}

interface RealTimeStatsProps {
  stats: StatItem[];
  title?: string;
  className?: string;
  showConfidence?: boolean;
}

const RealTimeStats: React.FC<RealTimeStatsProps> = ({
  stats,
  title = 'Estadísticas en Tiempo Real',
  className = '',
  showConfidence = true
}) => {
  // Animación para los elementos de la lista
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: i * 0.1,
        duration: 0.3
      }
    })
  };

  // Función para obtener el ícono de tendencia
  const getTrendIcon = (trend: 'up' | 'down' | 'stable' | undefined) => {
    switch (trend) {
      case 'up':
        return '↑';
      case 'down':
        return '↓';
      case 'stable':
        return '→';
      default:
        return null;
    }
  };

  // Función para obtener el color de la tendencia
  const getTrendColor = (trend: 'up' | 'down' | 'stable' | undefined) => {
    switch (trend) {
      case 'up':
        return 'text-green-400';
      case 'down':
        return 'text-red-400';
      case 'stable':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className={`bg-gray-800/80 backdrop-blur-sm rounded-xl p-4 ${className}`}>
      {title && (
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
          <span className="mr-2">📊</span> {title}
        </h3>
      )}
      
      <div className="space-y-4">
        <AnimatePresence>
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              custom={index}
              initial="hidden"
              animate="visible"
              variants={itemVariants}
              className="bg-gray-700/50 rounded-lg p-3"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm font-medium text-gray-300">
                    {stat.label}
                  </div>
                  <div className="flex items-baseline mt-1">
                    <span className="text-2xl font-bold text-white">
                      {stat.value}
                    </span>
                    {stat.unit && (
                      <span className="ml-1 text-sm text-gray-400">
                        {stat.unit}
                      </span>
                    )}
                    {stat.trend && (
                      <span className={`ml-2 text-sm font-medium ${getTrendColor(stat.trend)}`}>
                        {getTrendIcon(stat.trend)}
                      </span>
                    )}
                  </div>
                </div>
                
                {showConfidence && stat.confidence !== undefined && (
                  <div className="w-24">
                    <ConfidenceMeter 
                      confidence={stat.confidence} 
                      label="" 
                      size="sm"
                      showPercentage={false}
                    />
                  </div>
                )}
              </div>
              
              {showConfidence && stat.confidence !== undefined && (
                <div className="mt-2">
                  <ConfidenceMeter 
                    confidence={stat.confidence} 
                    label="Confianza" 
                    size="sm"
                    showPercentage={true}
                  />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default RealTimeStats;
