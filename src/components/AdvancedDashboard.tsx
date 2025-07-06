import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Activity, 
  Heart, 
  Droplets, 
  Gauge, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Zap,
  BarChart3
} from 'lucide-react';

interface AdvancedMetrics {
  heartRate: number;
  spo2: number;
  bloodPressure: {
    systolic: number;
    diastolic: number;
    map: number;
  };
  hrvMetrics: {
    rmssd: number;
    sdnn: number;
    pnn50: number;
    lfHfRatio: number;
  };
  arrhythmiaStatus: {
    isDetected: boolean;
    type: string;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  };
  signalQuality: number;
  perfusionIndex: number;
  algorithmsUsed: string[];
  processingLatency: number;
  confidence: {
    overall: number;
    heartRate: number;
    spo2: number;
    bloodPressure: number;
  };
}

interface AdvancedDashboardProps {
  metrics: AdvancedMetrics;
  isMonitoring: boolean;
  elapsedTime: number;
  onAlgorithmToggle?: (algorithm: string, enabled: boolean) => void;
  onQualityThresholdChange?: (threshold: number) => void;
}

export const AdvancedDashboard: React.FC<AdvancedDashboardProps> = ({
  metrics,
  isMonitoring,
  elapsedTime,
  onAlgorithmToggle,
  onQualityThresholdChange
}) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [showAdvancedMetrics, setShowAdvancedMetrics] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  // Configuración de algoritmos
  const [algorithms, setAlgorithms] = useState({
    CHROM: true,
    FastICA: true,
    Eulerian: true,
    AdvancedSpO2: true,
    AdvancedArrhythmia: true
  });

  // Umbral de calidad
  const [qualityThreshold, setQualityThreshold] = useState(60);

  useEffect(() => {
    if (canvasRef.current && isMonitoring) {
      drawRealTimeChart();
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isMonitoring, metrics]);

  const drawRealTimeChart = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Limpiar canvas
    ctx.clearRect(0, 0, width, height);

    // Dibujar grid médico
    drawMedicalGrid(ctx, width, height);

    // Dibujar señal PPG simulada (basada en métricas reales)
    drawPPGSignal(ctx, width, height);

    // Dibujar marcadores de latidos
    drawHeartbeatMarkers(ctx, width, height);

    animationRef.current = requestAnimationFrame(drawRealTimeChart);
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
  };

  const drawPPGSignal = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const centerY = height / 2;
    const amplitude = height * 0.3;
    const frequency = (metrics.heartRate / 60) * 2 * Math.PI; // Convertir BPM a rad/s

    for (let x = 0; x < width; x++) {
      const time = (Date.now() / 1000) + (x / 50); // Escala de tiempo
      const signal = Math.sin(frequency * time) * amplitude * (metrics.signalQuality / 100);
      const y = centerY + signal;
      
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  };

  const drawHeartbeatMarkers = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (metrics.arrhythmiaStatus.isDetected) {
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#f59e0b';
    } else {
      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#10b981';
    }

    // Dibujar marcadores de latidos
    const beatInterval = 60000 / metrics.heartRate; // ms entre latidos
    const beatPosition = (Date.now() % beatInterval) / beatInterval * width;

    ctx.beginPath();
    ctx.arc(beatPosition, height - 20, 4, 0, 2 * Math.PI);
    ctx.fill();
  };

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'low': return 'bg-green-500';
      case 'medium': return 'bg-yellow-500';
      case 'high': return 'bg-orange-500';
      case 'critical': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-400';
    if (confidence >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const handleAlgorithmToggle = (algorithm: string) => {
    const newState = !algorithms[algorithm as keyof typeof algorithms];
    setAlgorithms(prev => ({ ...prev, [algorithm]: newState }));
    onAlgorithmToggle?.(algorithm, newState);
  };

  const handleQualityThresholdChange = (value: number) => {
    setQualityThreshold(value);
    onQualityThresholdChange?.(value);
  };

  return (
    <div className="w-full h-full bg-black/95 text-white p-4 space-y-4 overflow-auto">
      {/* Header con métricas principales */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-gray-900/50 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Heart className="h-5 w-5 text-red-400" />
              <div>
                <p className="text-sm text-gray-400">Frecuencia Cardíaca</p>
                <p className="text-2xl font-bold text-white">{metrics.heartRate || '--'}</p>
                <p className="text-xs text-gray-500">BPM</p>
              </div>
            </div>
            <div className="mt-2">
              <Progress 
                value={metrics.confidence.heartRate} 
                className="h-1 bg-gray-700"
              />
              <p className="text-xs text-gray-400 mt-1">
                Confianza: {Math.round(metrics.confidence.heartRate)}%
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900/50 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Droplets className="h-5 w-5 text-blue-400" />
              <div>
                <p className="text-sm text-gray-400">SpO2</p>
                <p className="text-2xl font-bold text-white">{metrics.spo2 || '--'}</p>
                <p className="text-xs text-gray-500">%</p>
              </div>
            </div>
            <div className="mt-2">
              <Progress 
                value={metrics.confidence.spo2} 
                className="h-1 bg-gray-700"
              />
              <p className="text-xs text-gray-400 mt-1">
                Confianza: {Math.round(metrics.confidence.spo2)}%
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900/50 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Gauge className="h-5 w-5 text-purple-400" />
              <div>
                <p className="text-sm text-gray-400">Presión Arterial</p>
                <p className="text-xl font-bold text-white">
                  {metrics.bloodPressure.systolic}/{metrics.bloodPressure.diastolic}
                </p>
                <p className="text-xs text-gray-500">mmHg</p>
              </div>
            </div>
            <div className="mt-2">
              <Progress 
                value={metrics.confidence.bloodPressure} 
                className="h-1 bg-gray-700"
              />
              <p className="text-xs text-gray-400 mt-1">
                Confianza: {Math.round(metrics.confidence.bloodPressure)}%
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900/50 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Activity className="h-5 w-5 text-green-400" />
              <div>
                <p className="text-sm text-gray-400">Calidad de Señal</p>
                <p className="text-2xl font-bold text-white">{Math.round(metrics.signalQuality)}</p>
                <p className="text-xs text-gray-500">%</p>
              </div>
            </div>
            <div className="mt-2">
              <Progress 
                value={metrics.signalQuality} 
                className="h-1 bg-gray-700"
              />
              <p className="text-xs text-gray-400 mt-1">
                Umbral: {qualityThreshold}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs para diferentes vistas */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-gray-800">
          <TabsTrigger value="overview" className="text-white">Resumen</TabsTrigger>
          <TabsTrigger value="signals" className="text-white">Señales</TabsTrigger>
          <TabsTrigger value="algorithms" className="text-white">Algoritmos</TabsTrigger>
          <TabsTrigger value="advanced" className="text-white">Avanzado</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Estado de arritmia */}
          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-white">
                <AlertTriangle className="h-5 w-5" />
                <span>Estado de Arritmia</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <Badge className={`${getRiskColor(metrics.arrhythmiaStatus.riskLevel)} text-white`}>
                    {metrics.arrhythmiaStatus.isDetected ? 'DETECTADA' : 'NORMAL'}
                  </Badge>
                  <p className="text-sm text-gray-400 mt-2">
                    Tipo: {metrics.arrhythmiaStatus.type}
                  </p>
                  <p className="text-sm text-gray-400">
                    Confianza: {Math.round(metrics.arrhythmiaStatus.confidence * 100)}%
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-white">{elapsedTime}s</p>
                  <p className="text-sm text-gray-400">Tiempo de medición</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Métricas HRV */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-gray-900/50 border-gray-700">
              <CardContent className="p-4">
                <p className="text-sm text-gray-400">RMSSD</p>
                <p className="text-xl font-bold text-white">{Math.round(metrics.hrvMetrics.rmssd)}</p>
                <p className="text-xs text-gray-500">ms</p>
              </CardContent>
            </Card>
            <Card className="bg-gray-900/50 border-gray-700">
              <CardContent className="p-4">
                <p className="text-sm text-gray-400">pNN50</p>
                <p className="text-xl font-bold text-white">{Math.round(metrics.hrvMetrics.pnn50)}</p>
                <p className="text-xs text-gray-500">%</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="signals" className="space-y-4">
          {/* Visualización de señal en tiempo real */}
          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-white">
                <TrendingUp className="h-5 w-5" />
                <span>Señal PPG en Tiempo Real</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <canvas
                ref={canvasRef}
                width={800}
                height={200}
                className="w-full h-48 bg-black border border-gray-700 rounded"
              />
              <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-400">Frecuencia</p>
                  <p className="text-white font-semibold">{(metrics.heartRate / 60).toFixed(2)} Hz</p>
                </div>
                <div>
                  <p className="text-gray-400">Amplitud</p>
                  <p className="text-white font-semibold">{(metrics.signalQuality / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-400">Latencia</p>
                  <p className="text-white font-semibold">{metrics.processingLatency}ms</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="algorithms" className="space-y-4">
          {/* Control de algoritmos */}
          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-white">
                <Zap className="h-5 w-5" />
                <span>Algoritmos Activos</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(algorithms).map(([name, enabled]) => (
                  <div key={name} className="flex items-center justify-between p-3 bg-gray-800 rounded">
                    <span className="text-white">{name}</span>
                    <Button
                      size="sm"
                      variant={enabled ? "default" : "secondary"}
                      onClick={() => handleAlgorithmToggle(name)}
                    >
                      {enabled ? 'Activo' : 'Inactivo'}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Algoritmos utilizados */}
          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Algoritmos Utilizados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {metrics.algorithmsUsed.map((algorithm, index) => (
                  <Badge key={index} variant="secondary" className="bg-blue-500/20 text-blue-300">
                    {algorithm}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          {/* Configuración avanzada */}
          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Configuración Avanzada</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400">Umbral de Calidad</label>
                  <div className="flex items-center space-x-4 mt-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={qualityThreshold}
                      onChange={(e) => handleQualityThresholdChange(Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-white w-12">{qualityThreshold}%</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-400">Índice de Perfusión</p>
                    <p className="text-xl font-bold text-white">{metrics.perfusionIndex.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Confianza General</p>
                    <p className={`text-xl font-bold ${getConfidenceColor(metrics.confidence.overall)}`}>
                      {Math.round(metrics.confidence.overall)}%
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Métricas HRV avanzadas */}
          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Métricas HRV Avanzadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400">SDNN</p>
                  <p className="text-lg font-bold text-white">{Math.round(metrics.hrvMetrics.sdnn)} ms</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Ratio LF/HF</p>
                  <p className="text-lg font-bold text-white">{metrics.hrvMetrics.lfHfRatio.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}; 