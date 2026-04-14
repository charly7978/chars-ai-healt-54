# GUÍA DE INTEGRACIÓN RÁPIDA - MÓDULOS AVANZADOS

## Instalación

Los nuevos módulos ya están creados y listos para usar:

```
src/modules/signal-processing/
  ├── AdvancedFingerTracker.ts    ← NUEVO
  ├── PPGSignalProcessor.ts       ← EXISTENTE
  └── index.ts                    ← ACTUALIZADO

src/modules/vital-signs/
  ├── AdvancedArrhythmiaDetector.ts  ← NUEVO
  ├── RhythmClassifier.ts             ← EXISTENTE
  └── index.ts                        ← ACTUALIZADO

src/modules/visualization/
  └── AdvancedPPGVisualizer.ts    ← NUEVO
```

## Uso Básico

### 1. Importar en tu componente

```typescript
import { 
  AdvancedFingerTracker, 
  type FingerTrackingResult 
} from '@/modules/signal-processing';

import { 
  AdvancedArrhythmiaDetector, 
  type ArrhythmiaResult,
  type ArrhythmiaType 
} from '@/modules/vital-signs';

import { 
  AdvancedPPGVisualizer, 
  type PPGSignal 
} from '@/modules/visualization';
```

### 2. Inicializar en useEffect

```typescript
const MeasurementComponent = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fingerTracker = useRef<AdvancedFingerTracker | null>(null);
  const arrhythmiaDetector = useRef<AdvancedArrhythmiaDetector | null>(null);
  const visualizer = useRef<AdvancedPPGVisualizer | null>(null);
  
  useEffect(() => {
    // Inicializar módulos
    fingerTracker.current = new AdvancedFingerTracker();
    arrhythmiaDetector.current = new AdvancedArrhythmiaDetector();
    
    if (canvasRef.current) {
      visualizer.current = new AdvancedPPGVisualizer({
        canvas: canvasRef.current,
        width: 800,
        height: 400,
        bufferSize: 300,
        showPoincare: true,
        showSpectrum: false,
        showMorphology: true,
        colorTheme: 'medical'
      });
    }
    
    return () => {
      fingerTracker.current?.reset();
      arrhythmiaDetector.current?.reset();
      visualizer.current?.destroy();
    };
  }, []);
  
  // ...
};
```

### 3. Procesar frames de video

```typescript
const processVideoFrame = useCallback((
  imageData: ImageData, 
  timestamp: number
) => {
  // 1. Tracker avanzado de dedo
  const tracking = fingerTracker.current!.processFrame(imageData);
  
  // Mostrar guía al usuario
  if (tracking.contactQuality < 50) {
    showGuidance("Ajuste su dedo - calidad insuficiente");
    return;
  }
  
  if (tracking.stabilityScore < 0.7) {
    showGuidance("Mantenga el dedo quieto");
  }
  
  // 2. Procesar con PPGSignalProcessor existente
  ppgProcessor.processFrame(imageData, timestamp);
  
  // 3. Detectar arritmias cuando hay latidos
  if (beatResult.isPeak && beatResult.rrData.intervals.length > 0) {
    const rrInterval = beatResult.rrData.intervals[
      beatResult.rrData.intervals.length - 1
    ];
    
    // Obtener señal PPG para morfología
    const ppgSignal = getRecentSignalWindow();
    
    const arrhythmiaResult = arrhythmiaDetector.current!.processBeat(
      rrInterval,
      timestamp,
      ppgSignal,
      ppgSignal.length - 1,
      beatResult.beatSQI
    );
    
    if (arrhythmiaResult) {
      handleArrhythmiaDetection(arrhythmiaResult);
    }
  }
  
  // 4. Visualizar
  visualizer.current!.addSample({
    timestamp,
    value: tracking.roiMeanR,
    filteredValue: filteredSignal,
    quality: tracking.contactQuality,
    isPeak: beatResult.isPeak,
    beatSQI: beatResult.beatSQI
  });
}, []);
```

### 4. Manejar resultados de arritmias

```typescript
const handleArrhythmiaDetection = (result: ArrhythmiaResult) => {
  const { primaryDiagnosis, confidence, allProbabilities } = result;
  
  // Solo alertar si confianza > 70%
  if (confidence > 0.7) {
    switch (primaryDiagnosis) {
      case 'ATRIAL_FIBRILLATION':
        alertUser('⚠️ Fibrilación auricular detectada', 'critical');
        break;
      case 'VENTRICULAR_TACHYCARDIA':
        alertUser('🚨 Taquicardia ventricular', 'critical');
        break;
      case 'BIGEMINY':
      case 'TRIGEMINY':
        alertUser('⚡ Ritmo bigemínico/trigemínico', 'warning');
        break;
      case 'PREMATURE_VENTRICULAR_CONTRACTION':
        alertUser('💓 Extra-sístole ventricular', 'info');
        break;
      default:
        console.log(`Ritmo: ${primaryDiagnosis} (${(confidence * 100).toFixed(0)}%)`);
    }
  }
  
  // Mostrar probabilidades en UI debug
  updateDebugPanel({
    rhythm: primaryDiagnosis,
    confidence: (confidence * 100).toFixed(1),
    probabilities: Object.entries(allProbabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, prob]) => `${type}: ${(prob * 100).toFixed(1)}%`)
  });
};
```

### 5. Componente de visualización

```typescript
return (
  <div className="measurement-container">
    {/* Video preview */}
    <video 
      ref={videoRef}
      className="camera-feed"
      playsInline
      muted
    />
    
    {/* Canvas PPG avanzado */}
    <canvas 
      ref={canvasRef}
      className="ppg-visualizer"
    />
    
    {/* Info de tracking */}
    {tracking && (
      <div className="tracking-info">
        <div>Calidad: {tracking.contactQuality}/100</div>
        <div>Stabilidad: {(tracking.stabilityScore * 100).toFixed(0)}%</div>
        <div>Perfusion: {tracking.perfusionIndex.toFixed(2)}%</div>
        <div>SNR: {tracking.signalToNoiseRatio.toFixed(1)} dB</div>
      </div>
    )}
    
    {/* Alertas de arritmias */}
    {currentArrhythmia && (
      <AlertBanner 
        type={currentArrhythmia.severity}
        message={formatArrhythmiaName(currentArrhythmia.type)}
      />
    )}
  </div>
);
```

## API Reference

### AdvancedFingerTracker

```typescript
class AdvancedFingerTracker {
  processFrame(imageData: ImageData): FingerTrackingResult
  reset(): void
}

interface FingerTrackingResult {
  centerX: number;           // Centro del dedo (Kalman-filtrado)
  centerY: number;
  stabilityScore: number;     // 0-1 (1 = perfectamente estable)
  driftVelocity: number;      // px/frame (0 = sin movimiento)
  contactQuality: number;     // 0-100 (calidad de contacto)
  pressureEstimate: number;   // 0-1 (0.5 = óptimo)
  coverageUniformity: number; // 0-1 (uniformidad del contacto)
  roiMeanR: number;          // Valor medio Rojo ROI
  roiMeanG: number;          // Valor medio Verde ROI
  roiMeanB: number;          // Valor medio Azul ROI
  perfusionIndex: number;    // AC/DC ratio * 100
  signalToNoiseRatio: number; // SNR en dB
  trackedFeatures: number;   // Número de features trackeadas
  opticalFlowMagnitude: number; // Magnitud del flujo óptico
  segmentationConfidence: number; // 0-1 confianza segmentación
}
```

### AdvancedArrhythmiaDetector

```typescript
class AdvancedArrhythmiaDetector {
  processBeat(
    rrInterval: number,        // ms entre latidos
    timestamp: number,         // ms desde epoch
    ppgSignal: number[],       // Ventana de señal PPG
    beatPeakIndex: number,     // Índice del pico en señal
    signalQuality: number     // 0-100 calidad
  ): ArrhythmiaResult | null
  
  reset(): void
}

type ArrhythmiaType = 
  | 'NORMAL_SINUS_RHYTHM'
  | 'SINUS_BRADYCARDIA'
  | 'SINUS_TACHYCARDIA'
  | 'ATRIAL_FIBRILLATION'
  | 'PREMATURE_ATRIAL_CONTRACTION'
  | 'PREMATURE_VENTRICULAR_CONTRACTION'
  | 'VENTRICULAR_TACHYCARDIA'
  | 'BIGEMINY'
  | 'TRIGEMINY'
  | 'HEART_BLOCK'
  | 'UNDETERMINED'
  | 'ARTIFACT';

interface ArrhythmiaResult {
  primaryDiagnosis: ArrhythmiaType;
  confidence: number;           // 0-1 probabilidad
  allProbabilities: Record<ArrhythmiaType, number>;
  events: ArrhythmiaEvent[];    // Histórico de eventos
  currentFeatures: ArrhythmiaFeatures;  // Métricas HRV
  qualityMetrics: {
    signalQuality: number;
    coverageSeconds: number;
    validBeats: number;
    artifactRatio: number;
  };
}

interface ArrhythmiaFeatures {
  // Time domain
  rrIntervals: number[];
  rmssd: number;              // Root mean square of successive differences
  sdnn: number;               // Standard deviation of NN intervals
  pnn50: number;             // % of successive RR intervals differing >50ms
  heartRate: number;         // BPM
  hrVariability: number;      // Coeficiente de variación HR
  
  // Frequency domain (estimado)
  lfPower: number;           // Low frequency (0.04-0.15 Hz)
  hfPower: number;          // High frequency (0.15-0.4 Hz)
  lfHfRatio: number;         // Balance sympathovagal
  
  // Non-linear
  sd1: number;               // Poincaré short-term variability
  sd2: number;               // Poincaré long-term variability
  sd1Sd2Ratio: number;      // >0.8 sugiere AF
  shannonEntropy: number;   // Complejidad de distribución RR
  sampleEntropy: number;    // Regularidad de patrón
  approximateEntropy: number;
  dfaAlpha1: number;        // Short-term fractal scaling
  dfaAlpha2: number;        // Long-term fractal scaling
  
  irregularityScore: number;
  complexityIndex: number;
  templateCorrelation: number;  // Similaridad con template normal
  morphologyVariability: number; // Variación de morfología PPG
}
```

### AdvancedPPGVisualizer

```typescript
class AdvancedPPGVisualizer {
  constructor(config: VisualizationConfig)
  
  addSample(sample: PPGSignal): void
  updateFFT(fftData: { freq: number; magnitude: number }[]): void
  setTheme(theme: 'medical' | 'dark' | 'light'): void
  setDisplayOptions(options: {
    showPoincare?: boolean;
    showSpectrum?: boolean;
    showMorphology?: boolean;
  }): void
  exportSignalData(): {
    signal: PPGSignal[];
    poincare: { x: number; y: number }[];
    morphologies: number[][];
  }
  destroy(): void
}

interface VisualizationConfig {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  bufferSize: number;        // Muestras a mantener (300 = 10s @ 30fps)
  showPoincare: boolean;      // Mostrar plot Poincaré
  showSpectrum: boolean;      // Mostrar espectro FFT
  showMorphology: boolean;     // Mostrar morfología de latidos
  colorTheme: 'medical' | 'dark' | 'light';
}

interface PPGSignal {
  timestamp: number;
  value: number;             // Valor raw
  filteredValue: number;      // Valor filtrado
  quality: number;           // 0-100 calidad
  isPeak: boolean;           // Es un pico?
  beatSQI: number;          // Calidad del latido específico
}
```

## Performance Tips

### 1. Subsampleo inteligente

```typescript
// En processVideoFrame, solo procesar cada 2do frame si CPU > 80%
const skipFrame = cpuUsage > 0.8 && frameCount % 2 === 0;
if (skipFrame) return;
```

### 2. Web Worker para análisis pesado

```typescript
// Mover análisis de arritmias a Worker
const arrhythmiaWorker = new Worker('arrhythmia.worker.js');

arrhythmiaWorker.postMessage({
  type: 'PROCESS_BEAT',
  data: { rrInterval, ppgSignal, signalQuality }
});

arrhythmiaWorker.onmessage = (e) => {
  handleArrhythmiaResult(e.data);
};
```

### 3. Memoización de cálculos

```typescript
const memoizedFFT = useMemo(() => {
  return computeFFT(signalBuffer);
}, [signalBuffer.length > 60 && signalBuffer.length % 30 === 0]);
```

## Troubleshooting

### WebGL no disponible
El visualizador automáticamente fallback a Canvas 2D. No requiere acción.

### FPS bajo
- Reducir `bufferSize` en visualizador
- Subsamplear frames de video
- Usar Web Worker para análisis

### Falsos positivos en arritmias
- Aumentar threshold de confianza a 0.8
- Verificar `qualityMetrics.artifactRatio` < 0.2
- Extender período de calibración inicial

### Tracking inestable
- Verificar iluminación (flash encendido)
- Ajustar dedo completamente sobre cámara
- Evitar movimiento durante medición

## Ejemplos Completos

Ver `examples/` para:
- `basic-integration.tsx` - Integración mínima
- `advanced-dashboard.tsx` - Dashboard completo con todos los módulos
- `arrhythmia-alert.tsx` - Sistema de alertas médicas

---

**Nota:** Estos módulos son 100% TypeScript, sin dependencias externas, funcionan en cualquier navegador moderno con WebGL y Web Workers.
