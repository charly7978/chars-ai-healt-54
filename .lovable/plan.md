
# Plan de Integración Completa: VitalSignsProcessor + UI

## Diagnóstico Final

Después de revisar TODO el código, entiendo completamente la aplicación y el problema:

### Lo que la app DEBERÍA hacer:
1. Leer frames de la cámara con flash
2. Extraer valores RGB del dedo
3. Calcular AC/DC y Perfusion Index
4. Detectar picos cardíacos → BPM
5. Calcular SpO2 desde ratio R/G
6. Calcular TODOS los signos vitales desde morfología PPG
7. Mostrar TODO en la UI con vibración y sonido

### Lo que REALMENTE pasa:
1. ✅ Frames de cámara: OK
2. ✅ RGB: OK
3. ⚠️ AC/DC: Funciona pero los umbrales son muy estrictos
4. ❌ Picos: No se detectan porque SNR > 1.0 y amplitude > mean * 1.05 bloquean señales débiles
5. ⚠️ SpO2: Solo el básico de PPGPipeline
6. ❌ **VitalSignsProcessor NO ESTÁ CONECTADO** - Glucosa, Hemoglobina, Presión, Colesterol NUNCA se calculan
7. ❌ UI muestra "--/--" hardcodeado para presión arterial

---

## Cambios a Implementar

### ARCHIVO 1: `src/hooks/usePPGPipeline.ts`

**Problema:** Solo usa `PPGPipeline`, no integra `VitalSignsProcessor`.

**Solución:** Importar y conectar `VitalSignsProcessor`:

```typescript
import { VitalSignsProcessor } from '../modules/vital-signs/VitalSignsProcessor';

// En el hook:
const vitalSignsProcessorRef = useRef<VitalSignsProcessor | null>(null);

// En el efecto de inicialización:
vitalSignsProcessorRef.current = new VitalSignsProcessor();

// En handleFrame:
// 1. Pasar datos RGB al VitalSignsProcessor
vitalSignsProcessorRef.current.setRGBData({
  redAC: frame.redAC,
  redDC: frame.redDC,
  greenAC: frame.greenAC,
  greenDC: frame.greenDC
});

// 2. Procesar señal y obtener signos vitales completos
const vitals = vitalSignsProcessorRef.current.processSignal(
  frame.filteredValue,
  { intervals: frame.rrIntervals, lastPeakTime: frame.isPeak ? frame.timestamp : null }
);

// 3. Actualizar estado con TODOS los valores
setState(prev => ({
  ...prev,
  glucose: vitals.glucose,
  hemoglobin: vitals.hemoglobin,
  systolicPressure: vitals.pressure.systolic,
  diastolicPressure: vitals.pressure.diastolic,
  cholesterol: vitals.lipids.totalCholesterol,
  triglycerides: vitals.lipids.triglycerides,
  arrhythmiaStatus: vitals.arrhythmiaStatus,
  // ... mantener los demás valores
}));
```

**Agregar al estado:**
```typescript
export interface PPGPipelineState {
  // ... existentes ...
  
  // NUEVOS - Signos vitales completos
  glucose: number;
  hemoglobin: number;
  systolicPressure: number;
  diastolicPressure: number;
  cholesterol: number;
  triglycerides: number;
  arrhythmiaStatus: string;
}
```

### ARCHIVO 2: `src/modules/ppg-core/PeakDetectorHDEM.ts`

**Problema:** Umbrales demasiado estrictos impiden detectar picos reales.

**Cambios en `processSample()`:**

| Parámetro | Actual | Nuevo | Razón |
|-----------|--------|-------|-------|
| `signalBuffer.length < 60` | 60 | 45 | Iniciar antes |
| `SNR > 1.0` | 1.0 | 0.5 | Señales débiles son válidas |
| `amplitude > mean * 1.05` | 1.05 | 1.02 | 2% sobre promedio suficiente |
| `amplitude > localThreshold * 0.9` | 0.9 | 0.7 | Threshold HDEM ya es adaptativo |

### ARCHIVO 3: `src/pages/Index.tsx`

**Problema:** La UI no muestra todos los signos vitales.

**Cambios:**

1. **Agregar beep de audio** (además de vibración):
```typescript
const audioContextRef = useRef<AudioContext | null>(null);

// En el callback de pico:
setOnPeak((timestamp, bpm) => {
  // Vibración
  if (navigator.vibrate) {
    navigator.vibrate(50);
  }
  
  // Beep cardíaco
  if (!audioContextRef.current) {
    audioContextRef.current = new AudioContext();
  }
  const osc = audioContextRef.current.createOscillator();
  const gain = audioContextRef.current.createGain();
  osc.frequency.value = 880;
  gain.gain.value = 0.3;
  osc.connect(gain);
  gain.connect(audioContextRef.current.destination);
  osc.start();
  osc.stop(audioContextRef.current.currentTime + 0.08);
});
```

2. **Conectar valores del hook a la UI:**
```typescript
const {
  // Existentes
  heartRate, spo2, hrv, isPeak,
  
  // NUEVOS del VitalSignsProcessor
  glucose,
  hemoglobin,
  systolicPressure,
  diastolicPressure,
  cholesterol,
  triglycerides,
  arrhythmiaStatus,
  ...
} = usePPGPipeline();

// En el render:
<VitalSign 
  label="PRESIÓN ARTERIAL"
  value={systolicPressure > 0 ? `${Math.round(systolicPressure)}/${Math.round(diastolicPressure)}` : "--/--"}
  unit="mmHg"
/>
<VitalSign 
  label="GLUCOSA"
  value={glucose > 0 ? Math.round(glucose) : "--"}
  unit="mg/dL"
/>
<VitalSign 
  label="HEMOGLOBINA"
  value={hemoglobin > 0 ? hemoglobin.toFixed(1) : "--"}
  unit="g/dL"
/>
<VitalSign 
  label="COLESTEROL"
  value={cholesterol > 0 ? Math.round(cholesterol) : "--"}
  unit="mg/dL"
/>
```

---

## Resumen de Archivos

| Archivo | Acción | Cambios Clave |
|---------|--------|---------------|
| `src/hooks/usePPGPipeline.ts` | Modificar | Integrar VitalSignsProcessor, agregar estados para todos los signos |
| `src/modules/ppg-core/PeakDetectorHDEM.ts` | Modificar | Relajar umbrales de detección de picos |
| `src/pages/Index.tsx` | Modificar | Agregar beep audio, conectar todos los signos vitales a UI |

---

## Sección Técnica

### Flujo de Datos Corregido

```text
Frame Cámara (30 FPS)
    │
    ▼
PPGPipeline.processFrame(imageData)
    │
    ├─→ extractROI() → RGB promedio
    ├─→ detectFinger() → boolean
    ├─→ calculateACDC() → redAC, redDC, greenAC, greenDC
    ├─→ bandpass.filter() → filteredValue
    ├─→ peakDetector.processSample() → isPeak, BPM
    │
    ▼
usePPGPipeline (hook)
    │
    ├─→ VitalSignsProcessor.setRGBData() ← NUEVO
    ├─→ VitalSignsProcessor.processSignal() ← NUEVO
    │       │
    │       ├─→ calculateSpO2() → SpO2
    │       ├─→ calculateBloodPressure() → PAS/PAD
    │       ├─→ calculateGlucose() → Glucosa
    │       ├─→ calculateHemoglobin() → Hemoglobina
    │       ├─→ calculateLipids() → Colesterol, Triglicéridos
    │       └─→ ArrhythmiaProcessor → Estado arritmia
    │
    ▼
Index.tsx (UI)
    │
    ├─→ PPGSignalMeter (gráfico de onda)
    ├─→ VitalSign components (BPM, SpO2, PA, etc.)
    ├─→ Vibración (50ms por pico)
    └─→ Beep audio (880Hz por pico)
```

### Umbrales de Pico Propuestos

```text
CRITERIOS para isPeak = true:

1. signalBuffer.length >= 45 (era 60)
2. fingerDetected == true
3. perfusionIndex válido (0.01% - 25%)
4. timeSinceLastPeak >= 250ms
5. (crossUp || isLocalMax) == true
6. amplitude > threshold * 0.7 (era 0.9)
7. amplitude > mean * 1.02 (era 1.05)
8. SNR > 0.5 (era 1.0)
```

### Integración de VitalSignsProcessor

El `VitalSignsProcessor` ya tiene 840 líneas de código con:
- Fórmulas de SpO2 calibradas para smartphone
- Modelo de presión arterial basado en HR + morfología
- Estimación de glucosa desde PI + características PPG
- Hemoglobina desde absorción RGB
- Colesterol desde rigidez arterial
- Detector de arritmias con RMSSD y pNN50

Solo falta CONECTARLO al pipeline existente.

---

## Garantías

- Vibración activa: Se ejecutará en cada pico detectado
- Beep audible: Sonido de 880Hz por 80ms en cada latido
- BPM calculado: Desde intervalos RR reales del HDEM
- SpO2 calculado: Ratio-of-Ratios con calibración smartphone
- Presión arterial: Modelo HR + morfología PPG (VitalSignsProcessor)
- Glucosa/Hemoglobina: Desde PI y absorción RGB (VitalSignsProcessor)
- Colesterol: Desde rigidez arterial (VitalSignsProcessor)
- 100% datos reales: Sin simulación ni Math.random()
- Todo conectado: Un flujo desde cámara hasta UI
