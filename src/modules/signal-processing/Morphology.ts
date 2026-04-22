/**
 * MORPHOLOGY - Operaciones morfológicas ligeras para matrices de tiles
 * 
 * Implementa threshold adaptativo, open/close, connected components,
 * centroid, bounding box - sin dependencias pesadas.
 */

export interface Blob {
  id: number;
  pixels: number[];
  centroid: { x: number; y: number };
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
  fillRatio: number;
  borderTouch: boolean;
}

export class Morphology {
  /**
   * Threshold adaptativo basado en percentiles
   */
  static adaptiveThreshold(
    values: Float64Array,
    percentile: number = 0.5,
    minThreshold: number = 0.1
  ): number {
    const sorted = new Float64Array(values);
    sorted.sort();
    const idx = Math.floor(sorted.length * percentile);
    return Math.max(minThreshold, sorted[idx]);
  }

  /**
   * Erosión binaria (reduce regiones)
   */
  static erode(mask: Uint8Array, width: number, height: number): Uint8Array {
    const result = new Uint8Array(mask.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        let min = 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            min = Math.min(min, mask[(y + dy) * width + (x + dx)]);
          }
        }
        result[i] = min;
      }
    }
    return result;
  }

  /**
   * Dilatación binaria (expande regiones)
   */
  static dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
    const result = new Uint8Array(mask.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        let max = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            max = Math.max(max, mask[(y + dy) * width + (x + dx)]);
          }
        }
        result[i] = max;
      }
    }
    return result;
  }

  /**
   * Opening (erosión + dilatación) - remueve ruido pequeño
   */
  static open(mask: Uint8Array, width: number, height: number): Uint8Array {
    const eroded = this.erode(mask, width, height);
    return this.dilate(eroded, width, height);
  }

  /**
   * Closing (dilatación + erosión) - rellena huecos pequeños
   */
  static close(mask: Uint8Array, width: number, height: number): Uint8Array {
    const dilated = this.dilate(mask, width, height);
    return this.erode(dilated, width, height);
  }

  /**
   * Connected components - encuentra blobs en matriz binaria
   * Usa flood fill recursivo optimizado para matrices chicas
   */
  static connectedComponents(
    mask: Uint8Array,
    width: number,
    height: number
  ): Blob[] {
    const visited = new Uint8Array(mask.length);
    const blobs: Blob[] = [];
    let blobId = 0;

    const floodFill = (startX: number, startY: number): number[] => {
      const pixels: number[] = [];
      const stack: number[] = [startY * width + startX];
      
      while (stack.length > 0) {
        const i = stack.pop()!;
        if (visited[i] === 1) continue;
        if (mask[i] === 0) continue;
        
        visited[i] = 1;
        pixels.push(i);
        
        const x = i % width;
        const y = Math.floor(i / width);
        
        // Vecinos 4-conectividad
        if (x > 0 && visited[i - 1] === 0 && mask[i - 1] === 1) {
          stack.push(i - 1);
        }
        if (x < width - 1 && visited[i + 1] === 0 && mask[i + 1] === 1) {
          stack.push(i + 1);
        }
        if (y > 0 && visited[i - width] === 0 && mask[i - width] === 1) {
          stack.push(i - width);
        }
        if (y < height - 1 && visited[i + width] === 0 && mask[i + width] === 1) {
          stack.push(i + width);
        }
      }
      
      return pixels;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (mask[i] === 1 && visited[i] === 0) {
          const pixels = floodFill(x, y);
          if (pixels.length > 0) {
            blobs.push(this.computeBlobMetrics(pixels, width, height, blobId++));
          }
        }
      }
    }

    return blobs;
  }

  /**
   * Calcula métricas de un blob
   */
  private static computeBlobMetrics(
    pixels: number[],
    width: number,
    height: number,
    id: number
  ): Blob {
    let sumX = 0, sumY = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let borderTouch = false;

    for (const i of pixels) {
      const x = i % width;
      const y = Math.floor(i / width);
      
      sumX += x;
      sumY += y;
      
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        borderTouch = true;
      }
    }

    const centroid = {
      x: sumX / pixels.length,
      y: sumY / pixels.length
    };

    const bbox = { minX, minY, maxX, maxY };
    const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
    const fillRatio = pixels.length / bboxArea;

    return {
      id,
      pixels,
      centroid,
      bbox,
      area: pixels.length,
      fillRatio,
      borderTouch
    };
  }

  /**
   * Encuentra el blob dominante (mayor área)
   */
  static getDominantBlob(blobs: Blob[]): Blob | null {
    if (blobs.length === 0) return null;
    return blobs.reduce((max, blob) => blob.area > max.area ? blob : max);
  }

  /**
   * Filtra blobs por área mínima
   */
  static filterByArea(blobs: Blob[], minArea: number): Blob[] {
    return blobs.filter(b => b.area >= minArea);
  }

  /**
   * Filtra blobs que tocan el borde
   */
  static filterBorderTouch(blobs: Blob[]): Blob[] {
    return blobs.filter(b => !b.borderTouch);
  }

  /**
   * Calcula centralidad de un blob (0-1, 1 = centro)
   */
  static blobCentrality(blob: Blob, width: number, height: number): number {
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
    const dist = Math.sqrt(
      (blob.centroid.x - centerX) ** 2 + 
      (blob.centroid.y - centerY) ** 2
    );
    return Math.max(0, 1 - dist / maxDist);
  }
}
