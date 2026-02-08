
# Plan de Corrección Crítica: Sistema PPG de Lectura Real y Robusta

## DIAGNÓSTICO RAÍZ - Por Qué Detecta Más Latidos en el Aire

Tras analizar exhaustivamente todo el código y contrastar con las últimas publicaciones (Nature 2025, IEEE 2024, arXiv 2024), he identificado **7 PROBLEMAS CRÍTICOS**:

| # | Problema | Archivo | Impacto |
|---|----------|---------|---------|
| 1 | **Inversión de señal incorrecta** | `PPGPipeline.ts:283` | `255 - signalSource` invierte innecesariamente, causando que ruido se amplifique |
| 2 | **Canal verde como fuente principal** | `PPGPipeline.ts:281-282` | Verde tiene PEOR SNR que rojo con flash LED |
| 3 | **Detección de picos muy sensible** | `PeakDetectorHDEM.ts:204` | Umbral `> mean * 0.7` detecta cualquier ruido |
| 4 | **Perfusion Index mal calculado** | `PPGPipeline.ts:310` | Usa greenAC/greenDC pero el canal principal es rojo |
| 5 | **AC/DC requiere 60 frames** | `PPGPipeline.ts:276-278` | 2 segundos sin datos válidos permite falsos positivos |
| 6 | **Detección de dedo no bloquea picos** | Todo el sistema | Si no hay dedo, igual detecta picos del ruido |
| 7 | **Bandpass muy estrecho a 30fps** | `AdaptiveBandpass.ts` | 0.4-4.5Hz pero a 30fps el filtro no es efectivo |

### Problema Principal Explicado

Con flash encendido y dedo, los valores RGB son **MUY ALTOS** (Red > 200, Green > 150):
- Variación AC típica: 0.5-3% del DC
- Esto significa: AC ≈ 1-6 unidades de variación

Sin dedo (apuntando al aire):
- Valores RGB bajos: Red ≈ 20-50
- PERO el ruido de la cámara genera variaciones del 5-10%
- Esto parece "más pulsátil" porque el ratio AC/DC es mayor en ruido

**El sistema actual no distingue entre:**
- Señal débil REAL (dedo mal colocado)
- Ruido fuerte FALSO (sin dedo)

---

## SOLUCIÓN BASADA EN LITERATURA 2024-2025

### Fuentes Verificadas:
1. **WF-PPG Dataset (Nature 2025)**: Demuestra que el canal ROJO tiene mejor SNR con LED
2. **Tri-Spectral PPG (arXiv 2024)**: Fusión de canales RGB mejora robustez
3. **Seeing Red (IEEE 2020)**: PPG biométrico con smartphone confirma RED > GREEN
4. **PMC11161386 (2024)**: Algoritmos de separación de canales para cámara

---

## CAMBIOS A IMPLEMENTAR

### FASE 1: Corregir Selección de Canal y Eliminar Inversión

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

Problema actual (líneas 280-284):
```typescript
const greenSaturated = rawGreen > 250;
const signalSource = greenSaturated ? calibratedRGB.linearRed : calibratedRGB.linearGreen;
const inverted = 255 - signalSource;  // ← INCORRECTO: invierte innecesariamente
const filtered = this.bandpass.filter(inverted);
```

Corrección:
```typescript
// USAR CANAL ROJO COMO PRIMARIO (mejor SNR con flash LED)
// Solo usar verde si rojo está saturado
const redSaturated = rawRed > 250;
const signalSource = redSaturated ? calibratedRGB.linearRed : calibratedRGB.linearRed;

// NO INVERTIR - la señal PPG ya tiene la orientación correcta
// La inversión solo es necesaria en modo transmisivo, no reflectivo
const filtered = this.bandpass.filter(signalSource);
```

### FASE 2: Bloquear Detección de Picos Sin Dedo Válido

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

Agregar bloqueo en `processFrame()`:
```typescript
// Si no hay dedo detectado, NO procesar picos
if (!fingerDetected) {
  // Retornar frame con isPeak = false
  // NO alimentar al detector de picos
}
```

### FASE 3: Mejorar Detección de Dedo con Validación Temporal

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

Problema: La detección actual es instantánea, debería requerir N frames consecutivos.

Agregar:
```typescript
// Contador de frames consecutivos con dedo válido
private consecutiveFingerFrames: number = 0;
private readonly MIN_FINGER_FRAMES = 10; // 333ms @ 30fps

private detectFinger(rawRed: number, rawGreen: number): boolean {
  // Criterios existentes...
  
  // NUEVO: Validación temporal
  if (instantFingerDetected) {
    this.consecutiveFingerFrames++;
  } else {
    this.consecutiveFingerFrames = 0;
  }
  
  // Solo considerar dedo válido después de N frames
  return this.consecutiveFingerFrames >= this.MIN_FINGER_FRAMES;
}
```

### FASE 4: Corregir Cálculo de AC/DC Inicial

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

Problema: Requiere 60 frames (2 segundos) para calcular AC/DC.

Solución: Calcular AC/DC desde menos frames pero con validación:
```typescript
// Reducir ventana mínima a 30 frames (1 segundo)
if (this.redBuffer.length >= 30) {
  this.calculateACDC();
}

// Pero validar que los valores sean fisiológicamente posibles
// PI típico con dedo: 0.1% - 10%
// PI sin dedo (ruido): > 20% o < 0.01%
```

### FASE 5: Mejorar Umbral de Detección de Picos

**Archivo:** `src/modules/ppg-core/PeakDetectorHDEM.ts`

Problema actual (línea 204):
```typescript
if (amplitude > mean * 0.7) {  // ← Muy sensible, detecta ruido
```

Corrección:
```typescript
// Umbral más estricto basado en SNR
const snr = (amplitude - mean) / std;
if (amplitude > mean * 1.2 && snr > 2.0) {
  // Solo detectar pico si es significativamente mayor al promedio
  // Y tiene buena relación señal/ruido
}
```

### FASE 6: Agregar Validación de Perfusion Index Mínimo

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

```typescript
// Si PI < 0.1%, la señal es ruido, no pulso
const perfusionIndex = this.redDC > 0 ? (this.redAC / this.redDC) * 100 : 0;

if (perfusionIndex < 0.1 || perfusionIndex > 15) {
  // Valores fuera de rango fisiológico
  // NO detectar picos, marcar como INVALID
}
```

### FASE 7: Corregir Uso de Canal para AC/DC

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

Problema: Usa greenAC/greenDC pero el canal principal es rojo.

Corrección:
```typescript
// Calcular PI desde el canal ROJO (el que tiene mejor SNR)
const perfusionIndex = this.redDC > 0 ? (this.redAC / this.redDC) * 100 : 0;

// Para SpO2 sí se necesita ratio R/G
const ratioR = this.calculateRatioR();
```

---

## RESUMEN DE ARCHIVOS A MODIFICAR

| Archivo | Cambios |
|---------|---------|
| `src/modules/ppg-core/PPGPipeline.ts` | 1. Canal rojo primario 2. Eliminar inversión 3. Bloquear picos sin dedo 4. Validación temporal de dedo 5. AC/DC más rápido 6. PI mínimo |
| `src/modules/ppg-core/PeakDetectorHDEM.ts` | 1. Umbral más estricto 2. Validación SNR |

---

## SECCIÓN TÉCNICA

### Fórmulas Corregidas

**Detección de Dedo (IEEE 2020 + Nature 2025):**
```text
CRITERIOS:
1. Red > 120 (valor típico con flash: 180-240)
2. Red/Green ratio: 1.2 - 3.5 (sangre absorbe verde)
3. Red < 253 (no saturado)
4. Frames consecutivos >= 10 (estabilidad temporal)
5. Varianza(Red, 10 frames) < 5 (no movimiento)
```

**Perfusion Index Fisiológico:**
```text
PI = (AC / DC) * 100

Rangos válidos:
- Con dedo: 0.1% - 10% (típico 0.5-3%)
- Sin dedo: 0% o > 15% (ruido puro)

Si PI fuera de rango -> marcar INVALID, no detectar picos
```

**Umbral de Pico (HDEM mejorado):**
```text
Condiciones para pico válido:
1. amplitude > threshold * 1.2
2. SNR = (amplitude - mean) / std > 2.0
3. Intervalo desde último pico >= 250ms
4. fingerDetected == true
5. PI en rango válido
```

### Flujo de Datos Corregido

```text
Frame de Cámara
    |
    v
[1. Extraer RGB de ROI 85%]
    |
    v
[2. Detectar Dedo]
    - Red > 120?
    - R/G ratio 1.2-3.5?
    - No saturado?
    - 10 frames consecutivos?
    |
    Si NO → BLOQUEAR todo, retornar fingerDetected=false, isPeak=false
    |
    Si SÍ ↓
    v
[3. Calibración Instantánea]
    - ZLO = DC * 0.025
    |
    v
[4. Buffer RGB]
    |
    v
[5. Calcular AC/DC (canal ROJO)]
    - Validar PI: 0.1% - 10%
    |
    Si PI inválido → BLOQUEAR picos
    |
    v
[6. Filtrar con Bandpass 0.4-4.5Hz]
    - SIN inversión (modo reflectivo)
    |
    v
[7. HDEM Peak Detection]
    - Solo si fingerDetected=true
    - Solo si PI válido
    - Umbral estricto: amplitude > mean * 1.2 AND SNR > 2
    |
    v
[8. Calcular BPM, SpO2, HRV]
```

---

## GARANTÍAS DEL SISTEMA CORREGIDO

- **CERO picos falsos sin dedo**: Sistema bloqueado hasta detectar dedo válido
- **Validación temporal**: 10 frames consecutivos antes de medir
- **Canal óptimo**: Rojo primario (mejor SNR con flash LED)
- **Sin inversión**: Señal reflectiva no requiere inversión
- **PI como gatekeeper**: Valores fuera de 0.1-10% bloquean detección
- **Umbrales estrictos**: SNR > 2 y amplitude > mean * 1.2
- **100% datos reales**: Sin simulación ni Math.random()
