/**
 * MORPHOLOGICAL OPERATIONS
 * 
 * Operaciones morfológicas para procesamiento de imágenes:
 * - Dilatación: Expandir regiones blancas
 * - Erosión: Contraer regiones blancas
 * - Apertura: Erosión + Dilatación (eliminar ruido pequeño)
 * - Cierre: Dilatación + Erosión (cerrar huecos pequeños)
 * - Gradiente morfológico: Diferencia entre dilatación y erosión
 * - Top-hat: Diferencia entre imagen y apertura
 * - Bottom-hat: Diferencia entre cierre e imagen
 * 
 * Útil para limpiar máscaras ROI, eliminar ruido, y mejorar detección de contacto.
 */

export enum MorphologyOperation {
  DILATE = 'dilate',
  ERODE = 'erode',
  OPEN = 'open',
  CLOSE = 'close',
  GRADIENT = 'gradient',
  TOPHAT = 'tophat',
  BOTTOMHAT = 'bottomhat'
}

export interface MorphologyConfig {
  operation: MorphologyOperation;
  iterations: number;
  kernelSize: number;
  kernelShape: 'square' | 'circle' | 'cross';
}

export class Morphology {
  /**
   * Aplicar operación morfológica a máscara binaria
   */
  static apply(
    mask: Uint8Array,
    width: number,
    height: number,
    config: Partial<MorphologyConfig> = {}
  ): Uint8Array {
    const finalConfig: MorphologyConfig = {
      operation: MorphologyOperation.DILATE,
      iterations: 1,
      kernelSize: 3,
      kernelShape: 'square',
      ...config
    };

    let result = new Uint8Array(mask.length);
    result.set(mask);

    for (let i = 0; i < finalConfig.iterations; i++) {
      result = this.applySingle(result, width, height, finalConfig) as Uint8Array;
    }

    return result;
  }

  /**
   * Aplicar una sola iteración de operación morfológica
   */
  private static applySingle(
    mask: Uint8Array,
    width: number,
    height: number,
    config: MorphologyConfig
  ): Uint8Array {
    switch (config.operation) {
      case MorphologyOperation.DILATE:
        return this.dilate(mask, width, height, config.kernelSize, config.kernelShape);
      case MorphologyOperation.ERODE:
        return this.erode(mask, width, height, config.kernelSize, config.kernelShape);
      case MorphologyOperation.OPEN:
        const eroded = this.erode(mask, width, height, config.kernelSize, config.kernelShape);
        return this.dilate(eroded, width, height, config.kernelSize, config.kernelShape);
      case MorphologyOperation.CLOSE:
        const dilated = this.dilate(mask, width, height, config.kernelSize, config.kernelShape);
        return this.erode(dilated, width, height, config.kernelSize, config.kernelShape);
      case MorphologyOperation.GRADIENT:
        const d = this.dilate(mask, width, height, config.kernelSize, config.kernelShape);
        const e = this.erode(mask, width, height, config.kernelSize, config.kernelShape);
        return this.subtract(d, e);
      case MorphologyOperation.TOPHAT:
        const opened = this.open(mask, width, height, config.kernelSize, config.kernelShape);
        return this.subtract(mask, opened);
      case MorphologyOperation.BOTTOMHAT:
        const closed = this.close(mask, width, height, config.kernelSize, config.kernelShape);
        return this.subtract(closed, mask);
      default:
        const result = new Uint8Array(mask.length);
        result.set(mask);
        return result;
    }
  }

  /**
   * Dilatación: expandir regiones blancas
   */
  static dilate(
    mask: Uint8Array,
    width: number,
    height: number,
    kernelSize: number = 3,
    kernelShape: 'square' | 'circle' | 'cross' = 'square'
  ): Uint8Array {
    const result = new Uint8Array(mask.length);
    const radius = Math.floor(kernelSize / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        // Si el pixel actual es blanco, dilatar
        if (mask[idx] > 0) {
          result[idx] = 255;
          this.applyKernel(result, width, height, x, y, radius, kernelShape, 255);
        }
      }
    }

    return result;
  }

  /**
   * Erosión: contraer regiones blancas
   */
  static erode(
    mask: Uint8Array,
    width: number,
    height: number,
    kernelSize: number = 3,
    kernelShape: 'square' | 'circle' | 'cross' = 'square'
  ): Uint8Array {
    const result = new Uint8Array(mask.length);
    const radius = Math.floor(kernelSize / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        // Si el pixel actual es blanco, verificar vecinos
        if (mask[idx] > 0) {
          const allNeighborsWhite = this.checkKernel(mask, width, height, x, y, radius, kernelShape);
          result[idx] = allNeighborsWhite ? 255 : 0;
        }
      }
    }

    return result;
  }

  /**
   * Apertura: erosión + dilatación (eliminar ruido pequeño)
   */
  static open(
    mask: Uint8Array,
    width: number,
    height: number,
    kernelSize: number = 3,
    kernelShape: 'square' | 'circle' | 'cross' = 'square'
  ): Uint8Array {
    const eroded = this.erode(mask, width, height, kernelSize, kernelShape);
    return this.dilate(eroded, width, height, kernelSize, kernelShape);
  }

  /**
   * Cierre: dilatación + erosión (cerrar huecos pequeños)
   */
  static close(
    mask: Uint8Array,
    width: number,
    height: number,
    kernelSize: number = 3,
    kernelShape: 'square' | 'circle' | 'cross' = 'square'
  ): Uint8Array {
    const dilated = this.dilate(mask, width, height, kernelSize, kernelShape);
    return this.erode(dilated, width, height, kernelSize, kernelShape);
  }

  /**
   * Gradiente morfológico: diferencia entre dilatación y erosión
   */
  static gradient(
    mask: Uint8Array,
    width: number,
    height: number,
    kernelSize: number = 3,
    kernelShape: 'square' | 'circle' | 'cross' = 'square'
  ): Uint8Array {
    const dilated = this.dilate(mask, width, height, kernelSize, kernelShape);
    const eroded = this.erode(mask, width, height, kernelSize, kernelShape);
    return this.subtract(dilated, eroded);
  }

  /**
   * Top-hat: diferencia entre imagen y apertura
   */
  static tophat(
    mask: Uint8Array,
    width: number,
    height: number,
    kernelSize: number = 3,
    kernelShape: 'square' | 'circle' | 'cross' = 'square'
  ): Uint8Array {
    const opened = this.open(mask, width, height, kernelSize, kernelShape);
    return this.subtract(mask, opened);
  }

  /**
   * Bottom-hat: diferencia entre cierre e imagen
   */
  static bottomhat(
    mask: Uint8Array,
    width: number,
    height: number,
    kernelSize: number = 3,
    kernelShape: 'square' | 'circle' | 'cross' = 'square'
  ): Uint8Array {
    const closed = this.close(mask, width, height, kernelSize, kernelShape);
    return this.subtract(closed, mask);
  }

  /**
   * Aplicar kernel a pixel (para dilatación)
   */
  private static applyKernel(
    result: Uint8Array,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number,
    kernelShape: 'square' | 'circle' | 'cross',
    value: number
  ): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;

        // Verificar límites
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        // Verificar forma del kernel
        if (!this.isInKernel(dx, dy, radius, kernelShape)) continue;

        const idx = y * width + x;
        result[idx] = value;
      }
    }
  }

  /**
   * Verificar si todos los vecinos cumplen condición (para erosión)
   */
  private static checkKernel(
    mask: Uint8Array,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number,
    kernelShape: 'square' | 'circle' | 'cross'
  ): boolean {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;

        // Verificar límites
        if (x < 0 || x >= width || y < 0 || y >= height) return false;

        // Verificar forma del kernel
        if (!this.isInKernel(dx, dy, radius, kernelShape)) continue;

        const idx = y * width + x;
        if (mask[idx] === 0) return false;
      }
    }

    return true;
  }

  /**
   * Verificar si offset está dentro del kernel según forma
   */
  private static isInKernel(
    dx: number,
    dy: number,
    radius: number,
    shape: 'square' | 'circle' | 'cross'
  ): boolean {
    switch (shape) {
      case 'square':
        return true;
      case 'circle':
        return (dx * dx + dy * dy) <= (radius * radius);
      case 'cross':
        return dx === 0 || dy === 0;
      default:
        return true;
    }
  }

  /**
   * Restar dos arrays (clamped a 0-255)
   */
  private static subtract(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      result[i] = Math.max(0, Math.min(255, diff));
    }
    return result;
  }

  /**
   * Limpiar máscara ROI usando morfología
   * - Eliminar ruido pequeño (apertura)
   * - Cerrar huecos (cierre)
   * - Suavizar bordes
   */
  static cleanROIMask(
    mask: Uint8Array,
    width: number,
    height: number,
    options: {
      removeNoise?: boolean;
      closeHoles?: boolean;
      smoothEdges?: boolean;
      minKernelSize?: number;
      maxKernelSize?: number;
    } = {}
  ): Uint8Array {
    const {
      removeNoise = true,
      closeHoles = true,
      smoothEdges = true,
      minKernelSize = 3,
      maxKernelSize = 5
    } = options;

    let result = new Uint8Array(mask.length);
    result.set(mask);

    // Eliminar ruido pequeño (apertura)
    if (removeNoise) {
      result = this.open(result, width, height, minKernelSize, 'square') as Uint8Array;
    }

    // Cerrar huecos pequeños (cierre)
    if (closeHoles) {
      result = this.close(result, width, height, minKernelSize, 'circle') as Uint8Array;
    }

    // Suavizar bordes (gradiente + cierre suave)
    if (smoothEdges) {
      result = this.close(result, width, height, maxKernelSize, 'circle') as Uint8Array;
    }

    return result;
  }

  /**
   * Encontrar componentes conectados en máscara binaria
   * Devuelve array de componentes con sus bounding boxes
   */
  static findConnectedComponents(
    mask: Uint8Array,
    width: number,
    height: number,
    minSize: number = 10
  ): Array<{
    id: number;
    pixels: number[];
    boundingBox: { x: number; y: number; width: number; height: number };
    centroid: { x: number; y: number };
  }> {
    const visited = new Uint8Array(mask.length);
    const components: Array<{
      id: number;
      pixels: number[];
      boundingBox: { x: number; y: number; width: number; height: number };
      centroid: { x: number; y: number };
    }> = [];
    let componentId = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        if (mask[idx] > 0 && visited[idx] === 0) {
          // BFS para encontrar componente conectado
          const component = this.bfs(mask, visited, width, height, x, y);

          // Filtrar por tamaño mínimo
          if (component.pixels.length >= minSize) {
            const bbox = this.calculateBoundingBox(component.pixels, width);
            const centroid = this.calculateCentroid(component.pixels, width);

            components.push({
              id: componentId++,
              pixels: component.pixels,
              boundingBox: bbox,
              centroid
            });
          }
        }
      }
    }

    return components;
  }

  /**
   * BFS para encontrar componente conectado
   */
  private static bfs(
    mask: Uint8Array,
    visited: Uint8Array,
    width: number,
    height: number,
    startX: number,
    startY: number
  ): { pixels: number[] } {
    const pixels: number[] = [];
    const queue: number[] = [startY * width + startX];
    visited[startY * width + startX] = 1;

    while (queue.length > 0) {
      const idx = queue.shift()!;
      pixels.push(idx);

      const x = idx % width;
      const y = Math.floor(idx / width);

      // Vecinos (4-conectividad)
      const neighbors = [
        { x: x - 1, y: y },
        { x: x + 1, y: y },
        { x: x, y: y - 1 },
        { x: x, y: y + 1 }
      ];

      for (const neighbor of neighbors) {
        const nx = neighbor.x;
        const ny = neighbor.y;

        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const nidx = ny * width + nx;
        if (mask[nidx] > 0 && visited[nidx] === 0) {
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
    }

    return { pixels };
  }

  /**
   * Calcular bounding box de componente
   */
  private static calculateBoundingBox(pixels: number[], width: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const idx of pixels) {
      const x = idx % width;
      const y = Math.floor(idx / width);

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
  }

  /**
   * Calcular centroide de componente
   */
  private static calculateCentroid(pixels: number[], width: number): {
    x: number;
    y: number;
  } {
    let sumX = 0, sumY = 0;

    for (const idx of pixels) {
      const x = idx % width;
      const y = Math.floor(idx / width);
      sumX += x;
      sumY += y;
    }

    return {
      x: sumX / pixels.length,
      y: sumY / pixels.length
    };
  }

  /**
   * Filtrar componentes por tamaño y aspecto
   */
  static filterComponents(
    components: Array<{
      id: number;
      pixels: number[];
      boundingBox: { x: number; y: number; width: number; height: number };
      centroid: { x: number; y: number };
    }>,
    options: {
      minSize?: number;
      maxSize?: number;
      minAspectRatio?: number;
      maxAspectRatio?: number;
      minCircularity?: number;
    } = {}
  ): typeof components {
    const {
      minSize = 10,
      maxSize = Infinity,
      minAspectRatio = 0,
      maxAspectRatio = Infinity,
      minCircularity = 0
    } = options;

    return components.filter(comp => {
      const size = comp.pixels.length;
      const aspect = comp.boundingBox.width / Math.max(1, comp.boundingBox.height);
      const circularity = this.calculateCircularity(comp);

      return (
        size >= minSize &&
        size <= maxSize &&
        aspect >= minAspectRatio &&
        aspect <= maxAspectRatio &&
        circularity >= minCircularity
      );
    });
  }

  /**
   * Calcular circularidad de componente (4π * area / perimeter^2)
   */
  private static calculateCircularity(comp: {
    pixels: number[];
    boundingBox: { x: number; y: number; width: number; height: number };
  }): number {
    const area = comp.pixels.length;
    const perimeter = this.estimatePerimeter(comp.pixels, comp.boundingBox.width);

    if (perimeter === 0) return 0;
    return (4 * Math.PI * area) / (perimeter * perimeter);
  }

  /**
   * Estimar perímetro de componente
   */
  private static estimatePerimeter(pixels: number[], width: number): number {
    const pixelSet = new Set(pixels);
    let perimeter = 0;

    for (const idx of pixels) {
      const x = idx % width;
      const y = Math.floor(idx / width);

      // Verificar si algún vecino está vacío
      const neighbors = [
        { x: x - 1, y: y },
        { x: x + 1, y: y },
        { x: x, y: y - 1 },
        { x: x, y: y + 1 }
      ];

      let hasEmptyNeighbor = false;
      for (const neighbor of neighbors) {
        const nidx = neighbor.y * width + neighbor.x;
        if (!pixelSet.has(nidx)) {
          hasEmptyNeighbor = true;
          break;
        }
      }

      if (hasEmptyNeighbor) perimeter++;
    }

    return perimeter;
  }
}
