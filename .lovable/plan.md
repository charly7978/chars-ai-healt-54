

## Plan: Visualizacion Completa de Latidos Normales y Arritmicos

### Problema Actual
El monitor solo marca como "arritmia" el punto exacto del pico (`isPeak && arrStatus.includes('ARRITMIA')`), lo que produce un unico segmento rojo en vez de colorear el latido completo. El resultado visual es confuso: la mayoria de la onda queda verde aunque haya arritmia activa.

### Solucion

Cambiar la logica para que el estado de arritmia se propague a **todo el ciclo del latido** (de valle a valle), no solo al instante del pico.

### Cambios en `src/components/PPGSignalMeter.tsx`

**1. Propagar estado de arritmia por latido completo**

En el bloque de insercion al buffer (linea ~417-424), reemplazar la logica puntual por un estado persistente que se activa cuando se detecta arritmia y se mantiene hasta el siguiente pico normal:

- Agregar una ref `currentBeatIsArrhythmia` que rastrea si el latido actual (en curso) es arritmico.
- Cuando llega un pico (`isPeak`):
  - Si `arrStatus` incluye "ARRITMIA": marcar `currentBeatIsArrhythmia = true`
  - Si no: marcar `currentBeatIsArrhythmia = false`
- Todos los puntos entre picos heredan el estado del latido actual.

```
// Logica actual (solo marca el instante del pico):
const currentIsArrhythmia = peak && arrStatus?.includes('ARRITMIA');

// Logica nueva (marca todo el latido):
if (peak) {
  beatArrhythmiaRef.current = arrStatus?.includes('ARRITMIA') || false;
}
const currentIsArrhythmia = beatArrhythmiaRef.current;
```

**2. Mejorar marcadores de pico**

- Picos normales (verdes): circulo verde con etiqueta "N" (Normal) y valor de amplitud
- Picos arritmicos (rojos): circulo rojo mas grande con etiqueta "A" (Arritmia), halo pulsante, y linea vertical de referencia

**3. Agregar lineas verticales de referencia en picos**

Dibujar lineas verticales punteadas en cada pico detectado:
- Verde para picos normales
- Rojo para picos arritmicos

Esto facilita la lectura visual de cada latido individual.

**4. Mejorar leyenda**

Actualizar la leyenda inferior para reflejar:
- Linea verde + "Normal (N)"
- Linea roja + "Arritmia (A)"
- Circulo + "Pico"
- Triangulo + "Valle"

### Secuencia de Cambios

1. Agregar `beatArrhythmiaRef` como nueva ref en el componente
2. Modificar logica de asignacion de `isArrhythmia` en el buffer push
3. Actualizar renderizado de picos con marcadores mas descriptivos
4. Agregar lineas verticales de referencia por pico
5. Actualizar leyenda

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `src/components/PPGSignalMeter.tsx` | Logica de propagacion de arritmia por latido + marcadores mejorados |

### Impacto

- Estetica: mejorada (latidos completos coloreados, marcadores claros)
- Funcionalidad: mejorada (visualizacion profesional de arritmias)
- Rendimiento: sin impacto (misma cantidad de operaciones canvas)

