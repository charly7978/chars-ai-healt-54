

## Plan: Eliminacion de Codigo Muerto

### Resumen
Eliminar 5 archivos no utilizados y funciones huerfanas para reducir el bundle y simplificar el mantenimiento. Sin cambios en UI, funcionalidad ni rendimiento.

### Archivos a eliminar (5)

| Archivo | Razon |
|---------|-------|
| `src/modules/signal-processing/FrameProcessor.ts` | No importado en ningun otro archivo |
| `src/modules/signal-processing/SignalQualityAnalyzer.ts` | No importado en ningun otro archivo |
| `src/modules/signal-processing/types.ts` | Solo importado por FrameProcessor (tambien muerto) |
| `src/modules/camera/PIDController.ts` | No importado en ningun otro archivo |
| `src/modules/camera/CameraController.ts` | No importado en ningun otro archivo |

### Funciones a eliminar

**En `src/modules/signal-processing/PPGSignalProcessor.ts`:**
- `getVPGBuffer()` - nunca invocado externamente
- `getAPGBuffer()` - nunca invocado externamente
- `getFilteredBuffer()` - nunca invocado externamente
- `getRawBuffer()` - nunca invocado externamente
- `getLastNSamples()` - nunca invocado externamente
- Tambien eliminar los buffers `vpgBuffer` y `apgBuffer` si solo existen para estas funciones

**En `src/hooks/useSignalProcessor.ts`:**
- Eliminar las 3 funciones wrapper: `getVPGBuffer`, `getAPGBuffer`, `getFilteredBuffer`
- Eliminar sus exports del objeto return

**En `src/pages/Index.tsx`:**
- Eliminar la destructuracion de `getVPGBuffer`, `getAPGBuffer`, `getFilteredBuffer` del hook

### Secuencia de implementacion

1. Eliminar los 5 archivos muertos
2. Limpiar `PPGSignalProcessor.ts` (funciones + buffers no usados)
3. Limpiar `useSignalProcessor.ts` (wrappers + exports)
4. Limpiar `Index.tsx` (destructuracion)

### Impacto

- Estetica: ninguno
- Funcionalidad: ninguna
- Rendimiento: mejora menor (menos copias de arrays innecesarias, menor bundle)
- Archivos eliminados: 5
- Lineas removidas: ~350 aproximadamente

