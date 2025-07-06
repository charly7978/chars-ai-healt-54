import React, { useRef, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Activity, 
  TrendingUp, 
  Heart, 
  Zap,
  BarChart3,
  Gauge
} from 'lucide-react';

interface SignalData {
  timestamp: number;
  red: number;
  green: number;
  blue: number;
  filtered: number;
  quality: number;
  isPeak: boolean;
}

interface RealTimeSignalViewerProps {
  signalData: SignalData[];
  isMonitoring: boolean;
  heartRate: number;
  signalQuality: number;
  algorithmsUsed: string[];
  className?: string;
}

export const RealTimeSignalViewer: React.FC<RealTimeSignalViewerProps> = ({
  signalData,
  isMonitoring,
  heartRate,
  signalQuality,
  algorithmsUsed,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (canvasRef.current && isMonitoring) {
      drawSignal();
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [signalData, isMonitoring]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const drawSignal = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Limpiar canvas
    ctx.clearRect(0, 0, width, height);

    // Dibujar fondo
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, width, height);

    // Dibujar grid médico
    drawMedicalGrid(ctx, width, height);

    // Dibujar señales
    if (signalData.length > 0) {
      drawPPGSignal(ctx, width, height);
      drawPeakMarkers(ctx, width, height);
      drawQualityIndicator(ctx, width, height);
    }

    // Dibujar información en tiempo real
    drawRealTimeInfo(ctx, width, height);

    animationRef.current = requestAnimationFrame(drawSignal);
  };

  const drawMedicalGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Grid vertical (cada 50ms)
    for (let x = 0; x < width; x += 25) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Grid horizontal (cada 0.1 unidades)
    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Línea central
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  };

  const drawPPGSignal = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (signalData.length < 2) return;

    const centerY = height / 2;
    const scaleY = height * 0.4;
    const timeScale = width / (signalData.length - 1);

    // Señal roja (PPG principal)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();

    signalData.forEach((data, index) => {
      const x = index * timeScale;
      const y = centerY - (data.red * scaleY);
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Señal filtrada (verde)
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    signalData.forEach((data, index) => {
      const x = index * timeScale;
      const y = centerY - (data.filtered * scaleY);
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Señal azul (referencia)
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();

    signalData.forEach((data, index) => {
      const x = index * timeScale;
      const y = centerY - (data.blue * scaleY);
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const drawPeakMarkers = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const timeScale = width / (signalData.length - 1);

    signalData.forEach((data, index) => {
      if (data.isPeak) {
        const x = index * timeScale;
        const y = height / 2 - (data.red * height * 0.4);

        // Marcador de pico
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fill();

        // Línea vertical
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, height / 2);
        ctx.stroke();
      }
    });
  };

  const drawQualityIndicator = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const barWidth = 4;
    const barHeight = height * 0.3;
    const barX = width - 20;
    const barY = height / 2 - barHeight / 2;

    // Fondo del indicador
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Indicador de calidad
    const qualityHeight = (signalQuality / 100) * barHeight;
    const qualityColor = signalQuality > 80 ? '#10b981' : 
                        signalQuality > 60 ? '#f59e0b' : '#ef4444';
    
    ctx.fillStyle = qualityColor;
    ctx.fillRect(barX, barY + barHeight - qualityHeight, barWidth, qualityHeight);
  };

  const drawRealTimeInfo = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, 200, 80);

    // Frecuencia cardíaca
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`HR: ${heartRate} BPM`, 20, 30);

    // Calidad de señal
    ctx.font = '14px Arial';
    ctx.fillText(`Calidad: ${Math.round(signalQuality)}%`, 20, 50);

    // Algoritmos activos
    ctx.font = '12px Arial';
    ctx.fillText(`Algoritmos: ${algorithmsUsed.length}`, 20, 70);

    // Tiempo de medición
    const elapsedSeconds = Math.floor((currentTime - (signalData[0]?.timestamp || currentTime)) / 1000);
    ctx.fillText(`Tiempo: ${elapsedSeconds}s`, 20, 90);
  };

  const getQualityColor = (quality: number) => {
    if (quality >= 80) return 'text-green-400';
    if (quality >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <Card className={`bg-gray-900/50 border-gray-700 ${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2 text-white">
          <TrendingUp className="h-5 w-5 text-blue-400" />
          <span>Señal PPG en Tiempo Real</span>
          {isMonitoring && (
            <Badge className="bg-green-500/20 text-green-300">
              <Activity className="h-3 w-3 mr-1" />
              En Vivo
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Canvas para visualización */}
          <div className="relative">
            <canvas
              ref={canvasRef}
              width={800}
              height={300}
              className="w-full h-64 bg-black border border-gray-700 rounded"
            />
            
            {/* Overlay de información */}
            <div className="absolute top-2 right-2 space-y-2">
              <div className="flex items-center space-x-2 text-white text-sm">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <span>Señal PPG</span>
              </div>
              <div className="flex items-center space-x-2 text-white text-sm">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span>Filtrada</span>
              </div>
              <div className="flex items-center space-x-2 text-white text-sm">
                <div className="w-3 h-3 bg-blue-500 rounded-full opacity-60"></div>
                <span>Referencia</span>
              </div>
            </div>
          </div>

          {/* Métricas en tiempo real */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center space-x-2 mb-2">
                <Heart className="h-4 w-4 text-red-400" />
                <span className="text-white font-semibold">Frecuencia</span>
              </div>
              <p className="text-2xl font-bold text-white">{heartRate}</p>
              <p className="text-xs text-gray-400">BPM</p>
            </div>

            <div className="text-center">
              <div className="flex items-center justify-center space-x-2 mb-2">
                <Gauge className="h-4 w-4 text-blue-400" />
                <span className="text-white font-semibold">Calidad</span>
              </div>
              <p className={`text-2xl font-bold ${getQualityColor(signalQuality)}`}>
                {Math.round(signalQuality)}
              </p>
              <p className="text-xs text-gray-400">%</p>
            </div>

            <div className="text-center">
              <div className="flex items-center justify-center space-x-2 mb-2">
                <Zap className="h-4 w-4 text-yellow-400" />
                <span className="text-white font-semibold">Algoritmos</span>
              </div>
              <p className="text-2xl font-bold text-white">{algorithmsUsed.length}</p>
              <p className="text-xs text-gray-400">Activos</p>
            </div>
          </div>

          {/* Barra de progreso de calidad */}
          <div>
            <div className="flex justify-between text-sm text-gray-400 mb-1">
              <span>Calidad de Señal</span>
              <span>{Math.round(signalQuality)}%</span>
            </div>
            <Progress 
              value={signalQuality} 
              className="h-2 bg-gray-700"
            />
          </div>

          {/* Algoritmos utilizados */}
          <div>
            <p className="text-sm text-gray-400 mb-2">Algoritmos Activos:</p>
            <div className="flex flex-wrap gap-2">
              {algorithmsUsed.map((algorithm, index) => (
                <Badge key={index} variant="secondary" className="bg-blue-500/20 text-blue-300">
                  {algorithm}
                </Badge>
              ))}
            </div>
          </div>

          {/* Estadísticas de señal */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Muestras</p>
              <p className="text-white font-semibold">{signalData.length}</p>
            </div>
            <div>
              <p className="text-gray-400">Picos Detectados</p>
              <p className="text-white font-semibold">
                {signalData.filter(d => d.isPeak).length}
              </p>
            </div>
            <div>
              <p className="text-gray-400">Amplitud Promedio</p>
              <p className="text-white font-semibold">
                {signalData.length > 0 
                  ? (signalData.reduce((sum, d) => sum + d.red, 0) / signalData.length).toFixed(3)
                  : '0.000'
                }
              </p>
            </div>
            <div>
              <p className="text-gray-400">Variabilidad</p>
              <p className="text-white font-semibold">
                {signalData.length > 1 
                  ? this.calculateVariability(signalData).toFixed(3)
                  : '0.000'
                }
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // Método auxiliar para calcular variabilidad
  private calculateVariability(data: SignalData[]): number {
    if (data.length < 2) return 0;
    
    const values = data.map(d => d.red);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    
    return Math.sqrt(variance);
  }
}; 