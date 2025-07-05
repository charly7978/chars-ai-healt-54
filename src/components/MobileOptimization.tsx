import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Battery, Wifi, WifiOff, BatteryCharging, AlertTriangle, ZapOff } from 'lucide-react';
import { Button } from './ui/button';

type PowerMode = 'performance' | 'balanced' | 'power-saver';

interface MobileOptimizationProps {
  onPowerModeChange?: (mode: PowerMode) => void;
  onOptimize?: () => void;
  className?: string;
}

const MobileOptimization: React.FC<MobileOptimizationProps> = ({
  onPowerModeChange,
  onOptimize,
  className = ''
}) => {
  const [powerMode, setPowerMode] = useState<PowerMode>('balanced');
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState<boolean>(false);
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline' | 'slow'>('online');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [optimizationComplete, setOptimizationComplete] = useState(false);

  // Efecto para monitorear el estado de la batería
  useEffect(() => {
    const updateBatteryStatus = async () => {
      if ('getBattery' in navigator) {
        try {
          const battery = await (navigator as any).getBattery();
          
          const updateBatteryInfo = () => {
            setBatteryLevel(Math.round(battery.level * 100));
            setIsCharging(battery.charging);
          };
          
          // Actualizar el estado inicial
          updateBatteryInfo();
          
          // Escuchar cambios
          battery.addEventListener('levelchange', updateBatteryInfo);
          battery.addEventListener('chargingchange', updateBatteryInfo);
          
          return () => {
            battery.removeEventListener('levelchange', updateBatteryInfo);
            battery.removeEventListener('chargingchange', updateBatteryInfo);
          };
        } catch (error) {
          console.warn('No se pudo acceder a la información de la batería:', error);
        }
      }
    };
    
    updateBatteryStatus();
    
    // Monitorear conexión de red
    const handleOnline = () => setNetworkStatus('online');
    const handleOffline = () => setNetworkStatus('offline');
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Verificar calidad de red
    const checkConnection = () => {
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      
      if (connection) {
        // Si la conexión es lenta (menos de 1Mbps)
        if (connection.downlink < 1) {
          setNetworkStatus('slow');
        } else {
          setNetworkStatus('online');
        }
      }
    };
    
    // Verificar conexión al cargar
    checkConnection();
    
    // Configurar evento para cambios en la conexión
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', checkConnection);
    }
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      
      if (connection) {
        connection.removeEventListener('change', checkConnection);
      }
    };
  }, []);

  // Efecto para ajustar automáticamente el modo de energía según el estado de la batería
  useEffect(() => {
    if (batteryLevel !== null) {
      if (batteryLevel < 20 && !isCharging) {
        handlePowerModeChange('power-saver');
      } else if (batteryLevel > 80 || isCharging) {
        handlePowerModeChange('performance');
      } else {
        handlePowerModeChange('balanced');
      }
    }
  }, [batteryLevel, isCharging]);

  const handlePowerModeChange = (mode: PowerMode) => {
    setPowerMode(mode);
    if (onPowerModeChange) {
      onPowerModeChange(mode);
    }
  };

  const handleOptimize = useCallback(() => {
    // Simular proceso de optimización
    setOptimizationComplete(false);
    
    setTimeout(() => {
      if (onOptimize) {
        onOptimize();
      }
      setOptimizationComplete(true);
      
      // Ocultar el mensaje después de 3 segundos
      setTimeout(() => {
        setOptimizationComplete(false);
      }, 3000);
    }, 1500);
  }, [onOptimize]);

  // Obtener configuración de optimización según el modo de energía
  const optimizationSettings = useMemo(() => {
    switch (powerMode) {
      case 'performance':
        return {
          title: 'Rendimiento Máximo',
          description: 'Prioriza la velocidad sobre el consumo de batería',
          icon: <ZapOff className="w-5 h-5 text-yellow-500" />,
          settings: [
            'Máxima frecuencia de muestreo',
            'Procesamiento en tiempo real',
            'Actualizaciones frecuentes de la interfaz',
            'Máxima precisión de modelos'
          ]
        };
      case 'power-saver':
        return {
          title: 'Ahorro de Energía',
          description: 'Reduce el consumo de batería limitando el rendimiento',
          icon: <BatteryCharging className="w-5 h-5 text-green-500" />,
          settings: [
            'Frecuencia de muestreo reducida',
            'Procesamiento por lotes',
            'Actualizaciones limitadas de la interfaz',
            'Modelos optimizados para eficiencia'
          ]
        };
      default: // balanced
        return {
          title: 'Equilibrado',
          description: 'Balance entre rendimiento y consumo de batería',
          icon: <Battery className="w-5 h-5 text-blue-500" />,
          settings: [
            'Frecuencia de muestreo estándar',
            'Procesamiento en tiempo real con límites',
            'Actualizaciones de interfaz optimizadas',
            'Modelos equilibrados'
          ]
        };
    }
  }, [powerMode]);

  // Verificar si hay problemas de rendimiento
  const hasPerformanceIssues = useMemo(() => {
    // Simular detección de problemas de rendimiento
    const isLowEndDevice = /(android|iphone|ipod|ipad).*mobile.*(arm|aarch64|arm64)/i.test(navigator.userAgent);
    const isOldDevice = /(android|iphone|ipod|ipad).*mobile.*(7|8|9|10|11|12|13|14|15|16|17|18|19|20)/i.test(navigator.userAgent);
    
    return isLowEndDevice || isOldDevice || batteryLevel !== null && batteryLevel < 30 || networkStatus === 'slow';
  }, [batteryLevel, networkStatus]);

  return (
    <div className={`bg-gray-800/80 backdrop-blur-sm rounded-xl p-4 ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">Optimización Móvil</h3>
        
        <div className="flex items-center space-x-2">
          {/* Indicador de batería */}
          {batteryLevel !== null && (
            <div className="flex items-center text-sm text-gray-300">
              <Battery className="w-5 h-5 mr-1" />
              {batteryLevel}% {isCharging && '⚡'}
            </div>
          )}
          
          {/* Indicador de red */}
          <div className="flex items-center text-sm text-gray-300">
            {networkStatus === 'online' ? (
              <Wifi className="w-5 h-5 text-green-500" />
            ) : networkStatus === 'offline' ? (
              <WifiOff className="w-5 h-5 text-red-500" />
            ) : (
              <Wifi className="w-5 h-5 text-yellow-500" />
            )}
          </div>
        </div>
      </div>
      
      {/* Alerta de problemas de rendimiento */}
      {hasPerformanceIssues && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start p-3 mb-4 bg-yellow-900/30 border border-yellow-800 rounded-lg"
        >
          <AlertTriangle className="w-5 h-5 mt-0.5 mr-2 text-yellow-500 flex-shrink-0" />
          <div className="text-sm text-yellow-300">
            <p className="font-medium">Se detectaron posibles problemas de rendimiento</p>
            <p className="text-xs text-yellow-400 mt-1">
              {batteryLevel !== null && batteryLevel < 30 && !isCharging && 'Batería baja • '}
              {networkStatus === 'slow' && 'Conexión lenta • '}
              Se recomienda usar el modo de ahorro de energía.
            </p>
          </div>
        </motion.div>
      )}
      
      {/* Selector de modo de energía */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { id: 'performance', label: 'Rendimiento', color: 'bg-blue-600' },
          { id: 'balanced', label: 'Equilibrado', color: 'bg-green-600' },
          { id: 'power-saver', label: 'Ahorro', color: 'bg-purple-600' }
        ].map((mode) => (
          <button
            key={mode.id}
            onClick={() => handlePowerModeChange(mode.id as PowerMode)}
            className={`py-2 px-1 rounded-lg text-sm font-medium transition-colors ${
              powerMode === mode.id
                ? `${mode.color} text-white`
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>
      
      {/* Configuración actual */}
      <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
        <div className="flex items-center mb-2">
          {optimizationSettings.icon}
          <div className="ml-2">
            <h4 className="font-medium text-white">{optimizationSettings.title}</h4>
            <p className="text-xs text-gray-400">{optimizationSettings.description}</p>
          </div>
        </div>
        
        <ul className="mt-2 space-y-1 text-sm text-gray-300">
          {optimizationSettings.settings.map((setting, index) => (
            <li key={index} className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>{setting}</span>
            </li>
          ))}
        </ul>
      </div>
      
      {/* Optimización avanzada */}
      <div className="mt-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-blue-400 hover:text-blue-300 flex items-center"
        >
          {showAdvanced ? 'Ocultar opciones avanzadas' : 'Mostrar opciones avanzadas'}
          <svg
            className={`ml-1 w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-gray-700">
                <div className="space-y-3">
                  <div>
                    <label className="flex items-center text-sm text-gray-300 mb-1">
                      <input 
                        type="checkbox" 
                        className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 mr-2"
                        defaultChecked
                      />
                      Reducir calidad de gráficos
                    </label>
                  </div>
                  
                  <div>
                    <label className="flex items-center text-sm text-gray-300 mb-1">
                      <input 
                        type="checkbox" 
                        className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 mr-2"
                        defaultChecked={powerMode === 'power-saver'}
                        onChange={(e) => {
                          if (e.target.checked) {
                            handlePowerModeChange('power-saver');
                          } else {
                            handlePowerModeChange('balanced');
                          }
                        }}
                      />
                      Limitar frecuencia de actualización
                    </label>
                  </div>
                  
                  <div>
                    <label className="flex items-center text-sm text-gray-300">
                      <input 
                        type="checkbox" 
                        className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 mr-2"
                        defaultChecked
                      />
                      Optimizar para conexiones lentas
                    </label>
                  </div>
                </div>
                
                <Button 
                  onClick={handleOptimize}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-700"
                >
                  Aplicar optimizaciones
                </Button>
                
                <AnimatePresence>
                  {optimizationComplete && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="mt-3 text-center text-sm text-green-400"
                    >
                      Optimización aplicada correctamente
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default MobileOptimization;
