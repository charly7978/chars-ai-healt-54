/**
 * Segmentación HSV + Hemoglobin para detección de piel y tejido vascular.
 * Basado en literatura 2024 de skin detection en HSV y hemoglobin multispectral analysis.
 * Combina:
 * - HSV color space para skin detection robusto
 * - Hemoglobin ratio (R/G) para vascular tissue detection
 * - Adaptive thresholds según iluminación
 * - Spatial coherence filtering
 */

export interface HSVSegmentationResult {
  /** Máscara binaria de piel (0 = no piel, 1 = piel) */
  skinMask: Uint8Array;
  /** Máscara de tejido vascular (alta hemoglobina) */
  vascularMask: Uint8Array;
  /** Porcentaje de píxeles clasificados como piel */
  skinCoverage: number;
  /** Porcentaje de píxeles clasificados como vascular */
  vascularCoverage: number;
  /** Ratio hemoglobina promedio (R/G) */
  hemoglobinRatio: number;
  /** Confianza de la segmentación [0,1] */
  segmentationConfidence: number;
  /** Umbral H usado (adaptive) */
  hueThreshold: number;
  /** Umbral S usado (adaptive) */
  saturationThreshold: number;
}

export interface HSVSegmentationConfig {
  /** Rango de Hue para piel (grados) */
  hueRange: { min: number; max: number };
  /** Rango de Saturation para piel */
  saturationRange: { min: number; max: number };
  /** Rango de Value para piel */
  valueRange: { min: number; max: number };
  /** Ratio R/G mínimo para vascular */
  hemoglobinRatioMin: number;
  /** Factor de adaptive thresholding */
  adaptiveFactor: number;
}

export class HSVSkinSegmentation {
  private readonly config: HSVSegmentationConfig;
  private readonly tempHSV: Float32Array;
  private readonly historyHue: number[] = [];
  private readonly historySat: number[] = [];
  private readonly historySize = 30;

  constructor(config?: Partial<HSVSegmentationConfig>) {
    this.config = {
      hueRange: { min: 0, max: 50 }, // Rango típico piel (rojo-naranja)
      saturationRange: { min: 15, max: 100 },
      valueRange: { min: 20, max: 100 },
      hemoglobinRatioMin: 1.2, // R/G > 1.2 indica hemoglobina
      adaptiveFactor: 0.15,
      ...config,
    };
    this.tempHSV = new Float32Array(3);
  }

  /**
   * Convierte RGB a HSV
   * @param r, g, b: valores RGB [0,255]
   * @returns [h, s, v] donde h [0,360], s [0,100], v [0,100]
   */
  private rgbToHSV(r: number, g: number, b: number): [number, number, number] {
    const nr = r / 255;
    const ng = g / 255;
    const nb = b / 255;

    const max = Math.max(nr, ng, nb);
    const min = Math.min(nr, ng, nb);
    const delta = max - min;

    let h = 0;
    let s = 0;
    const v = max * 100;

    if (delta > 1e-6) {
      s = (delta / max) * 100;

      if (max === nr) {
        h = 60 * (((ng - nb) / delta) % 6);
      } else if (max === ng) {
        h = 60 * ((nb - nr) / delta + 2);
      } else {
        h = 60 * ((nr - ng) / delta + 4);
      }

      if (h < 0) h += 360;
    }

    return [h, s, v];
  }

  /**
   * Segmenta frame usando HSV + hemoglobin ratio
   * @param frame: ImageData con datos RGBA
   * @param width, height: dimensiones del frame
   * @returns Resultado de segmentación
   */
  segment(frame: ImageData, width: number, height: number): HSVSegmentationResult {
    const data = frame.data;
    const pixelCount = width * height;
    const skinMask = new Uint8Array(pixelCount);
    const vascularMask = new Uint8Array(pixelCount);

    // Calcular estadísticas globales para adaptive thresholding
    let totalHue = 0;
    let totalSat = 0;
    let totalHemoglobin = 0;
    let sampleCount = 0;

    // Primer pase: calcular estadísticas con subsampling
    const step = 8;
    for (let i = 0; i < pixelCount; i += step) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;

      const [h, s, v] = this.rgbToHSV(r, g, b);

      if (v > this.config.valueRange.min && s > this.config.saturationRange.min) {
        totalHue += h;
        totalSat += s;
        if (g > 10) {
          totalHemoglobin += r / g;
          sampleCount++;
        }
      }
    }

    // Calcular thresholds adaptativos
    const avgHue = sampleCount > 0 ? totalHue / sampleCount : 25;
    const avgSat = sampleCount > 0 ? totalSat / sampleCount : 40;
    const avgHemoglobin = sampleCount > 0 ? totalHemoglobin / sampleCount : 1.3;

    // Actualizar historial para smoothing
    this.historyHue.push(avgHue);
    this.historySat.push(avgSat);
    if (this.historyHue.length > this.historySize) this.historyHue.shift();
    if (this.historySat.length > this.historySize) this.historySat.shift();

    const smoothHue = this.historyHue.length > 0 
      ? this.historyHue.reduce((a, b) => a + b, 0) / this.historyHue.length 
      : avgHue;
    const smoothSat = this.historySat.length > 0 
      ? this.historySat.reduce((a, b) => a + b, 0) / this.historySat.length 
      : avgSat;

    // Thresholds adaptativos con tolerancia
    const hueMin = Math.max(0, smoothHue - this.config.hueRange.max * this.config.adaptiveFactor);
    const hueMax = Math.min(360, smoothHue + this.config.hueRange.max * this.config.adaptiveFactor);
    const satMin = Math.max(10, smoothSat - 20 * this.config.adaptiveFactor);

    // Segundo pase: segmentación completa
    let skinCount = 0;
    let vascularCount = 0;

    for (let i = 0; i < pixelCount; i++) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;

      const [h, s, v] = this.rgbToHSV(r, g, b);

      // Skin detection en HSV
      const isSkin = 
        h >= hueMin && 
        h <= hueMax && 
        s >= satMin && 
        s <= this.config.saturationRange.max &&
        v >= this.config.valueRange.min &&
        v <= this.config.valueRange.max;

      if (isSkin) {
        skinMask[i] = 1;
        skinCount++;

        // Vascular tissue detection usando hemoglobin ratio
        const hemoglobinRatio = g > 10 ? r / g : 0;
        if (hemoglobinRatio >= this.config.hemoglobinRatioMin) {
          vascularMask[i] = 1;
          vascularCount++;
        }
      }
    }

    // Spatial coherence filtering (3x3 median-like)
    this.applySpatialCoherence(skinMask, width, height);
    this.applySpatialCoherence(vascularMask, width, height);

    const skinCoverage = pixelCount > 0 ? skinCount / pixelCount : 0;
    const vascularCoverage = pixelCount > 0 ? vascularCount / pixelCount : 0;

    // Calcular confianza de segmentación
    const hueConfidence = smoothHue >= this.config.hueRange.min && smoothHue <= this.config.hueRange.max ? 1 : 0.5;
    const satConfidence = smoothSat >= this.config.saturationRange.min ? 1 : 0.5;
    const coverageConfidence = skinCoverage > 0.1 && skinCoverage < 0.9 ? 1 : 0.3;
    const segmentationConfidence = (hueConfidence * 0.4 + satConfidence * 0.3 + coverageConfidence * 0.3);

    return {
      skinMask,
      vascularMask,
      skinCoverage,
      vascularCoverage,
      hemoglobinRatio: avgHemoglobin,
      segmentationConfidence,
      hueThreshold: hueMin,
      saturationThreshold: satMin,
    };
  }

  /**
   * Filtrado de coherencia espacial simple (3x3)
   * Elimina píxeles aislados y suaviza la máscara
   */
  private applySpatialCoherence(mask: Uint8Array, width: number, height: number): void {
    const temp = new Uint8Array(mask);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        
        // Contar vecinos activos
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const ni = (y + dy) * width + (x + dx);
            neighbors += temp[ni]!;
          }
        }
        
        // Si hay suficientes vecinos, mantener; si no, eliminar
        if (temp[i]! === 1 && neighbors < 4) {
          mask[i] = 0;
        } else if (temp[i]! === 0 && neighbors >= 5) {
          mask[i] = 1;
        }
      }
    }
  }

  reset(): void {
    this.historyHue.length = 0;
    this.historySat.length = 0;
  }

  getAverageHue(): number {
    if (this.historyHue.length === 0) return 25;
    return this.historyHue.reduce((a, b) => a + b, 0) / this.historyHue.length;
  }

  getAverageSaturation(): number {
    if (this.historySat.length === 0) return 40;
    return this.historySat.reduce((a, b) => a + b, 0) / this.historySat.length;
  }
}
