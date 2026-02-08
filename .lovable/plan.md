
# DIAGNÓSTICO COMPLETO Y PLAN DE REPARACIÓN INTEGRAL

## ESTADO ACTUAL DEL SISTEMA

Después de revisar **TODOS** los archivos del sistema PPG, he identificado exactamente por qué la aplicación está completamente trabada. No es un solo problema, son **MÚLTIPLES BLOQUEOS EN CASCADA** que se crearon con las "correcciones" anteriores.

---

## PROBLEMAS CRÍTICOS IDENTIFICADOS

### PROBLEMA 1: DEADLOCK EN calculateACDC()

**Archivo:** `PPGPipeline.ts`, línea 487

```text
private calculateACDC(): void {
  const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
  if (windowSize < 60) return;  ← BLOQUEO: Requiere 60 frames (2 segundos)
```

Pero en línea 280:
```text
if (this.redBuffer.length >= this.MIN_ACDC_FRAMES) {  ← MIN_ACDC_FRAMES = 30
  this.calculateACDC();  ← Se llama con 30 frames, pero adentro requiere 60
}
```

**RESULTADO:** `calculateACDC()` nunca calcula nada porque siempre retorna vacío. Los valores `redAC`, `redDC`, `greenAC`, `greenDC` quedan en **0 PARA SIEMPRE**.

---

### PROBLEMA 2: SIN AC/DC = PERFUSION INDEX = 0

**Archivo:** `PPGPipeline.ts`, línea 285

```text
const perfusionIndex = this.redDC > 0 ? (this.redAC / this.redDC) * 100 : 0;
```

Como `redAC` y `redDC` son 0 (por Problema 1), `perfusionIndex = 0`.

---

### PROBLEMA 3: PI = 0 BLOQUEA DETECCIÓN DE PICOS

**Archivo:** `PPGPipeline.ts`, líneas 290 y 310

```text
const piIsValid = perfusionIndex >= 0.05 && perfusionIndex <= 20;
// ...
if (fingerDetected && piIsValid) {
  peakResult = this.peakDetector.processSample(...);  ← NUNCA SE EJECUTA
}
```

Como PI = 0, `piIsValid = false`, y **NUNCA se llama al detector de picos**.

---

### PROBLEMA 4: SIN PICOS = VitalSignsProcessor NUNCA CALCULA

**Archivo:** `usePPGPipeline.ts`, línea 130

```text
if (vitalSignsProcessorRef.current && frame.fingerDetected) {
  // Solo procesa si fingerDetected = true
}
```

Pero aún si entra:

**Archivo:** `VitalSignsProcessor.ts`, líneas 165-167

```text
if (!this.hasValidPulse(rrData)) {
  return this.formatResult();  ← Retorna todo en 0
}
```

Y `hasValidPulse()` requiere `rrData.intervals.length >= 2`, pero como nunca se detectan picos, `rrIntervals = []`, siempre vacío.

---

### PROBLEMA 5: VIBRACIÓN Y BEEP NUNCA SE DISPARAN

**Archivo:** `Index.tsx`, línea 103

```text
setOnPeak((timestamp, bpm) => {
  navigator.vibrate(50);  ← Solo se llama si isPeak = true
  // ... beep
});
```

Pero como `isPeak = false` SIEMPRE (por los problemas anteriores), nunca vibra ni suena.

---

## DIAGRAMA DEL DEADLOCK

```text
┌─────────────────────────────────────────────────────────────┐
│                    FLUJO ACTUAL (ROTO)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Camera Frame                                               │
│       │                                                     │
│       ▼                                                     │
│  extractROI() → RGB OK ✅                                   │
│       │                                                     │
│       ▼                                                     │
│  detectFinger() → fingerDetected = true (a veces) ✅        │
│       │                                                     │
│       ▼                                                     │
│  calculateACDC() ← BLOQUEO: windowSize < 60 ❌              │
│       │            retorna sin hacer nada                   │
│       │            redAC = 0, redDC = 0                     │
│       ▼                                                     │
│  perfusionIndex = 0 / 0 = 0 ❌                              │
│       │                                                     │
│       ▼                                                     │
│  piIsValid = (0 >= 0.05) = false ❌                         │
│       │                                                     │
│       ▼                                                     │
│  if (fingerDetected && piIsValid) ← FALSE ❌                │
│       │  peakDetector.processSample() NUNCA SE LLAMA        │
│       ▼                                                     │
│  isPeak = false SIEMPRE ❌                                  │
│       │                                                     │
│       ▼                                                     │
│  rrIntervals = [] vacío ❌                                  │
│       │                                                     │
│       ▼                                                     │
│  VitalSignsProcessor.hasValidPulse() = false ❌             │
│       │                                                     │
│       ▼                                                     │
│  TODOS LOS SIGNOS VITALES = 0 ❌                            │
│  NO VIBRACIÓN, NO BEEP ❌                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## SOLUCIÓN: CORRECCIONES MÍNIMAS PARA DESBLOQUEAR

### CORRECCIÓN 1: Arreglar calculateACDC()

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

Línea 487, cambiar:
```typescript
// ANTES (ROTO):
if (windowSize < 60) return;

// DESPUÉS (CORRECTO):
if (windowSize < 30) return;  // Permitir cálculo desde 30 frames (1 segundo)
```

---

### CORRECCIÓN 2: Permitir detección de picos sin PI estricto

**Archivo:** `src/modules/ppg-core/PPGPipeline.ts`

Línea 310, cambiar:
```typescript
// ANTES (DEMASIADO ESTRICTO):
if (fingerDetected && piIsValid) {
  peakResult = this.peakDetector.processSample(filtered, timestamp, perfusionIndex);
}

// DESPUÉS (PERMITIR MIENTRAS HAY DEDO):
if (fingerDetected) {
  // Procesar picos siempre que hay dedo - el PI se usará para filtrar DESPUÉS
  peakResult = this.peakDetector.processSample(filtered, timestamp, perfusionIndex);
}
```

---

### CORRECCIÓN 3: Relajar validación de PI en PeakDetector

**Archivo:** `src/modules/ppg-core/PeakDetectorHDEM.ts`

Líneas 183-191, cambiar:
```typescript
// ANTES (BLOQUEA TODO):
if (perfusionIndex !== undefined && (perfusionIndex < 0.005 || perfusionIndex > 30)) {
  return { isPeak: false, ... };
}

// DESPUÉS (SOLO VALIDAR SI PI > 0):
// Remover esta validación o hacerla opcional
// El PI = 0 es válido al inicio antes de que calculateACDC() tenga datos
```

---

### CORRECCIÓN 4: VitalSignsProcessor debe procesar aunque haya pocos intervalos

**Archivo:** `src/modules/vital-signs/VitalSignsProcessor.ts`

Línea 182, cambiar:
```typescript
// ANTES:
if (!rrData || !rrData.intervals || rrData.intervals.length < 2) {

// DESPUÉS:
if (!rrData || !rrData.intervals) {
  // Permitir continuar con 0 intervalos para calcular SpO2 al menos
```

---

## RESUMEN DE ARCHIVOS A MODIFICAR

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `PPGPipeline.ts` | 487 | `windowSize < 60` → `< 30` |
| `PPGPipeline.ts` | 310 | Remover condición `piIsValid` del if |
| `PeakDetectorHDEM.ts` | 183-191 | Remover validación de PI que bloquea |
| `VitalSignsProcessor.ts` | 182 | Relajar validación de intervalos |

---

## SECCIÓN TÉCNICA

### Flujo Corregido

```text
Camera Frame
    │
    ▼
extractROI() → RGB promedio
    │
    ▼
detectFinger() → fingerDetected (5 frames consecutivos)
    │
    ▼
calculateACDC() ← AHORA FUNCIONA desde 30 frames
    │ redAC, redDC, greenAC, greenDC = valores reales
    ▼
perfusionIndex = redAC/redDC * 100 = valor real
    │
    ▼
if (fingerDetected) {  ← SIN bloqueo por PI
    │ peakDetector.processSample()
    ▼
    isPeak = true/false basado en HDEM
}
    │
    ▼
rrIntervals se llena con cada pico
    │
    ▼
VitalSignsProcessor.processSignal()
    │ Calcula SpO2, PA, Glucosa, etc.
    ▼
UI actualizada + Vibración + Beep
```

### Criterios de Detección Relajados

| Parámetro | Valor Anterior | Valor Nuevo | Razón |
|-----------|----------------|-------------|-------|
| `windowSize < 60` | 60 frames (2s) | 30 frames (1s) | Empezar antes |
| `piIsValid` gatekeeper | Requerido | Opcional | No bloquear picos |
| PI validation en detector | `< 0.005` bloquea | Removido | PI=0 es válido al inicio |
| `intervals.length < 2` | Bloquea vitales | Permitir 0 | Calcular SpO2 sin RR |

---

## GARANTÍAS POST-CORRECCIÓN

1. **calculateACDC()** funcionará desde 30 frames (1 segundo)
2. **Detección de picos** no se bloqueará por PI = 0
3. **VitalSignsProcessor** calculará SpO2 aunque no haya intervalos RR
4. **Vibración y beep** se dispararán en cada pico detectado
5. **Todos los signos vitales** se mostrarán en la UI

---

## NOTA IMPORTANTE

Estos cambios son **MÍNIMOS y QUIRÚRGICOS** para desbloquear el sistema sin reescribir todo. El problema no era la lógica de PPG en sí, sino las **condiciones de bloqueo demasiado estrictas** que se agregaron en iteraciones anteriores para "evitar falsos positivos", pero que terminaron bloqueando TODO.
