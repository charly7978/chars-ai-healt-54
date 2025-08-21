# Módulo PPG optimizado — Integración rápida

## Archivos implementados (reemplazados)
- ✅ `src/types.ts` - Nuevos tipos compartidos
- ✅ `src/components/CameraView.tsx` - CameraView optimizado
- ✅ `src/modules/signal-processing/SavitzkyGolayFilter.ts` - Filtro SG simplificado
- ✅ `src/modules/signal-processing/Biquad.ts` - Filtro IIR pasabanda
- ✅ `src/modules/signal-processing/Goertzel.ts` - Análisis espectral eficiente
- ✅ `src/modules/signal-processing/SignalQualityAnalyzer.ts` - Cálculo de SNR
- ✅ `src/modules/signal-processing/TimeDomainPeak.ts` - Detector de picos temporal
- ✅ `src/modules/signal-processing/PPGChannel.ts` - Canal PPG avanzado
- ✅ `src/modules/signal-processing/MultiChannelManager.ts` - Manager multicanal
- ✅ `src/hooks/useSignalProcessor.ts` - Hook integrador
- ✅ `src/index.ts` - Exportaciones del módulo
- ✅ `src/pages/Index.tsx` - Página principal actualizada

## Cómo funciona el nuevo sistema

### 1. **CameraView optimizado**
- Captura video trasero con ROI reducido para rendimiento
- Activa linterna automáticamente si está disponible
- Calcula estadísticas por canal (R, G, B) + coverage ratio
- Detecta movimiento entre frames para estabilidad

### 2. **Procesamiento multicanal (6 canales)**
- Cada canal tiene gain inicial ligeramente diferente (diversidad)
- Alimentación con ratio G/(R+G+B) para robustez
- Filtrado pasabanda IIR centrado en 0.7-3.5 Hz
- Suavizado con Savitzky-Golay

### 3. **Detección robusta de dedo**
- **Coverage ratio**: Requiere ≥35% de píxeles brillantes en ROI
- **Estabilidad**: Bajo movimiento entre frames (<8 unidades de brillo)
- **Consenso**: Mayoría de canales deben detectar dedo
- **Debounce**: 6 frames consecutivos para confirmar/desconfirmar

### 4. **Análisis espectral con Goertzel**
- Análisis eficiente en frecuencias específicas (0.7-3.5 Hz)
- Cálculo de SNR para calidad de señal
- Detección de picos en dominio temporal para intervalos RR

### 5. **Feedback adaptativo**
- Ajuste automático de gain por canal según calidad
- Si detecta dedo pero baja calidad → aumenta gain (+2%)
- Si no detecta dedo y gain alto → reduce gain (-3%)

## Uso en la aplicación

### Integración básica
```tsx
import { CameraView, useSignalProcessor } from '@/modules/ppg';

export default function App() {
  const { handleSample, lastResult } = useSignalProcessor(8, 6);

  return (
    <div>
      <CameraView 
        isMonitoring={true} 
        onSample={handleSample}
        targetFps={30}
        roiSize={200}
        enableTorch={true}
        coverageThresholdPixelBrightness={30}
      />
      <pre>{JSON.stringify(lastResult, null, 2)}</pre>
    </div>
  );
}
```

### Resultado del sistema
```typescript
interface MultiChannelResult {
  timestamp: number;
  channels: ChannelResult[];        // 6 canales individuales
  aggregatedBPM: number | null;     // BPM agregado por voto ponderado
  aggregatedQuality: number;        // Calidad promedio de todos los canales
  fingerDetected: boolean;          // Estado final de detección de dedo
}
```

## Parámetros ajustables

### CameraView
- `roiSize`: Tamaño del ROI (px) - por defecto 200
- `coverageThresholdPixelBrightness`: Umbral de brillo para coverage - por defecto 30
- `targetFps`: FPS objetivo - por defecto 30
- `enableTorch`: Activar linterna - por defecto true

### MultiChannelManager
- `fingerEnableFramesToConfirm`: Frames para confirmar dedo - por defecto 6
- `fingerDisableFramesToConfirm`: Frames para desconfirmar dedo - por defecto 6

### PPGChannel
- `minRMeanForFinger`: Umbral mínimo de R para detectar dedo - por defecto 20
- `windowSec`: Ventana temporal de análisis - por defecto 8 segundos

## Ventajas del nuevo sistema

### 🚫 **Eliminación de falsos positivos**
1. **Baseline dinámico**: Distingue brillo ambiente vs dedo
2. **Coverage ratio**: Requiere cobertura mínima del ROI
3. **Frame diff**: Detecta movimientos bruscos
4. **Consenso multicanal**: Evita detecciones individuales erróneas
5. **Debounce temporal**: Previene toggles rápidos

### 🔬 **Mejoras técnicas**
1. **Canal base G/(R+G+B)**: Más robusto que R puro
2. **Filtro pasabanda IIR**: Reduce ruido preservando PPG
3. **Análisis espectral Goertzel**: Eficiente para frecuencias específicas
4. **Feedback adaptativo**: Auto-sintonía de parámetros
5. **Voto ponderado**: BPM agregado por calidad de canal

### 📱 **Optimizaciones de rendimiento**
1. **ROI reducido**: Procesamiento más rápido
2. **FPS controlado**: Evita sobrecarga del dispositivo
3. **Buffers circulares**: Gestión eficiente de memoria
4. **Análisis asíncrono**: No bloquea la UI

## Calibración por dispositivo

### Ajustes recomendados
- **Dispositivos con cámara débil**: Aumentar `coverageThresholdPixelBrightness` a 40-50
- **Dispositivos con linterna fuerte**: Reducir `roiSize` a 150-180
- **Entornos muy brillantes**: Aumentar `fingerEnableFramesToConfirm` a 8-10
- **Señales PPG débiles**: Reducir `minRMeanForFinger` a 15-18

### Monitoreo de calidad
- **Calidad < 30**: Señal muy débil, revisar cobertura
- **Calidad 30-50**: Señal aceptable, puede mejorar
- **Calidad 50-80**: Señal buena, mediciones confiables
- **Calidad > 80**: Señal excelente, máxima precisión

## Próximos pasos recomendados

1. **Validación en dispositivos reales**: Probar en Android/iOS
2. **Ajuste de parámetros**: Calibrar según hardware específico
3. **UI de ajustes**: Controles en runtime para parámetros
4. **Detector de arritmias**: Integrar análisis avanzado de HRV
5. **Logging avanzado**: Métricas de rendimiento y calidad

## Notas importantes

⚠️ **Validación clínica**: Este software procesa señales reales, pero requiere validación en hardware real y tests clínicos antes de uso médico.

🔧 **Compatibilidad**: El sistema mantiene compatibilidad con el procesador de signos vitales existente mediante simulación de señal PPG.

📊 **Debug**: Usar el panel de debug para monitorear el estado de los 6 canales y ajustar parámetros según sea necesario.
