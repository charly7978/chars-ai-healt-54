/**
 * RADIOMETRIC CONTROL
 * 
 * Control radiométrico para mediciones PPG precisas.
 * Implementa:
 * 1. sRGB -> Linear conversion (corrección gamma)
 * 2. Optical Density (OD) calculation
 * 3. Dark frame correction (ruido del sensor)
 * 4. White reference calibration (balance de blancos)
 * 
 * FAIL-CLOSED: Si no hay calibración válida, rechaza la medición.
 */

export interface DarkFrame {
  red: number;
  green: number;
  blue: number;
  timestamp: number;
}

export interface WhiteReference {
  red: number;
  green: number;
  blue: number;
  timestamp: number;
}

export interface RadiometricConfig {
  darkFrame: DarkFrame | null;
  whiteReference: WhiteReference | null;
  gamma: number; // Típicamente 2.2 para sRGB
}

export interface RadiometricResult {
  linearRed: number;
  linearGreen: number;
  linearBlue: number;
  odRed: number;
  odGreen: number;
  odBlue: number;
  calibrated: boolean;
  valid: boolean;
  rejectionReasons: string[];
}

export class RadiometricControl {
  private config: RadiometricConfig;

  constructor(config: Partial<RadiometricConfig> = {}) {
    this.config = {
      darkFrame: config.darkFrame || null,
      whiteReference: config.whiteReference || null,
      gamma: config.gamma || 2.2
    };
  }

  /**
   * Convertir sRGB a lineal (corrección gamma inversa)
   * sRGB usa gamma ~2.2, necesitamos lineal para cálculos radiométricos
   */
  srgbToLinear(srgb: number): number {
    if (srgb <= 0.04045) {
      return srgb / 12.92;
    }
    return Math.pow((srgb + 0.055) / 1.055, this.config.gamma);
  }

  /**
   * Convertir lineal a sRGB (corrección gamma)
   */
  linearToSrgb(linear: number): number {
    if (linear <= 0.0031308) {
      return linear * 12.92;
    }
    return Math.pow(linear, 1 / this.config.gamma) * 1.055 - 0.055;
  }

  /**
   * Calcular Optical Density (OD)
   * OD = -log10(I / I0)
   * donde I es la intensidad medida y I0 es la referencia (white)
   */
  calculateOD(intensity: number, reference: number): number {
    if (reference <= 0 || intensity <= 0) {
      return 0;
    }
    const ratio = intensity / reference;
    return -Math.log10(ratio);
  }

  /**
   * Aplicar corrección de dark frame
   * Substrae el ruido del sensor (dark current)
   */
  applyDarkCorrection(value: number, dark: number): number {
    const corrected = value - dark;
    return Math.max(0, corrected);
  }

  /**
   * Normalizar a white reference
   * Divide por la referencia de blanco para obtener reflectancia relativa
   */
  applyWhiteNormalization(value: number, white: number): number {
    if (white <= 0) {
      return 0;
    }
    return value / white;
  }

  /**
   * Procesar un píxel RGB con control radiométrico completo
   */
  processPixel(
    srgbRed: number,
    srgbGreen: number,
    srgbBlue: number
  ): RadiometricResult {
    const rejectionReasons: string[] = [];

    // Validar calibración
    if (!this.config.darkFrame) {
      rejectionReasons.push('NO_DARK_FRAME: Dark frame calibration required');
    }
    if (!this.config.whiteReference) {
      rejectionReasons.push('NO_WHITE_REFERENCE: White reference calibration required');
    }

    const calibrated = this.config.darkFrame !== null && this.config.whiteReference !== null;

    // Convertir sRGB a lineal
    const linearRed = this.srgbToLinear(srgbRed);
    const linearGreen = this.srgbToLinear(srgbGreen);
    const linearBlue = this.srgbToLinear(srgbBlue);

    // Aplicar correcciones si hay calibración
    let correctedRed = linearRed;
    let correctedGreen = linearGreen;
    let correctedBlue = linearBlue;

    if (calibrated) {
      // Dark frame correction
      correctedRed = this.applyDarkCorrection(linearRed, this.config.darkFrame.red);
      correctedGreen = this.applyDarkCorrection(linearGreen, this.config.darkFrame.green);
      correctedBlue = this.applyDarkCorrection(linearBlue, this.config.darkFrame.blue);

      // White reference normalization
      correctedRed = this.applyWhiteNormalization(correctedRed, this.config.whiteReference.red);
      correctedGreen = this.applyWhiteNormalization(correctedGreen, this.config.whiteReference.green);
      correctedBlue = this.applyWhiteNormalization(correctedBlue, this.config.whiteReference.blue);
    }

    // Calcular Optical Density
    let odRed = 0;
    let odGreen = 0;
    let odBlue = 0;

    if (calibrated) {
      odRed = this.calculateOD(correctedRed, 1.0); // Normalizado a 1.0
      odGreen = this.calculateOD(correctedGreen, 1.0);
      odBlue = this.calculateOD(correctedBlue, 1.0);
    }

    // Validar resultados
    const valid = calibrated && 
                  rejectionReasons.length === 0 &&
                  odRed >= 0 && odRed <= 3.0 &&
                  odGreen >= 0 && odGreen <= 3.0 &&
                  odBlue >= 0 && odBlue <= 3.0;

    if (!valid && calibrated) {
      if (odRed < 0 || odRed > 3.0) {
        rejectionReasons.push(`OD_RED_OUT_OF_RANGE: ${odRed.toFixed(3)} not in [0, 3]`);
      }
      if (odGreen < 0 || odGreen > 3.0) {
        rejectionReasons.push(`OD_GREEN_OUT_OF_RANGE: ${odGreen.toFixed(3)} not in [0, 3]`);
      }
      if (odBlue < 0 || odBlue > 3.0) {
        rejectionReasons.push(`OD_BLUE_OUT_OF_RANGE: ${odBlue.toFixed(3)} not in [0, 3]`);
      }
    }

    return {
      linearRed,
      linearGreen,
      linearBlue,
      odRed,
      odGreen,
      odBlue,
      calibrated,
      valid,
      rejectionReasons
    };
  }

  /**
   * Procesar un array de píxeles RGB
   */
  processPixels(pixels: Uint8ClampedArray): RadiometricResult[] {
    const results: RadiometricResult[] = [];

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;

      results.push(this.processPixel(r, g, b));
    }

    return results;
  }

  /**
   * Establecer dark frame
   */
  setDarkFrame(darkFrame: DarkFrame): void {
    this.config.darkFrame = darkFrame;
  }

  /**
   * Establecer white reference
   */
  setWhiteReference(whiteReference: WhiteReference): void {
    this.config.whiteReference = whiteReference;
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): RadiometricConfig {
    return { ...this.config };
  }

  /**
   * Verificar si el sistema está calibrado
   */
  isCalibrated(): boolean {
    return this.config.darkFrame !== null && this.config.whiteReference !== null;
  }

  /**
   * Calibrar automáticamente capturando dark frame y white reference
   * NOTA: Esto requiere acceso a la cámara para capturar frames específicos
   */
  async autoCalibrate(): Promise<{ success: boolean; message: string }> {
    // Esta función debe ser implementada por el código que tiene acceso a la cámara
    // Aquí solo es un placeholder para la interfaz
    return {
      success: false,
      message: 'Auto-calibration requires camera access. Use setDarkFrame and setWhiteReference manually.'
    };
  }
}

export default RadiometricControl;
