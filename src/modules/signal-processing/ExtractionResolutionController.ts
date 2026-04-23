/**
 * Resolución de extracción (crop central) con escalones adaptativos.
 */

export type ExtractionTierId = 'S' | 'M' | 'L';

export interface ExtractionTier {
  id: ExtractionTierId;
  /** Ancho/alto del canvas de extracción (píxeles) */
  outWidth: number;
  outHeight: number;
  /** Fracción del video fuente que se recorta (central) */
  cropFraction: number;
}

const TIERS: Record<ExtractionTierId, ExtractionTier> = {
  S: { id: 'S', outWidth: 240, outHeight: 180, cropFraction: 0.62 },
  M: { id: 'M', outWidth: 320, outHeight: 240, cropFraction: 0.58 },
  L: { id: 'L', outWidth: 360, outHeight: 360, cropFraction: 0.52 },
};

export interface CentralCropSpec {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  videoWidth: number;
  videoHeight: number;
  tier: ExtractionTier;
  upscaleFromDetection: number;
}

export class ExtractionResolutionController {
  private tier: ExtractionTierId = 'M';

  getTier(): ExtractionTier {
    return TIERS[this.tier];
  }

  getTierId(): ExtractionTierId {
    return this.tier;
  }

  /** Bajar resolución bajo carga */
  stepDown(): void {
    if (this.tier === 'L') this.tier = 'M';
    else if (this.tier === 'M') this.tier = 'S';
  }

  /** Subir si hay margen */
  stepUp(): void {
    if (this.tier === 'S') this.tier = 'M';
    else if (this.tier === 'M') this.tier = 'L';
  }

  setTier(id: ExtractionTierId): void {
    this.tier = id;
  }

  /**
   * Crop central en coordenadas del video; mantiene aspect del tier de salida.
   */
  computeCentralCrop(videoWidth: number, videoHeight: number, detWidth: number, detHeight: number): CentralCropSpec {
    const tier = TIERS[this.tier];
    const cropFrac = tier.cropFraction;
    const targetAspect = tier.outWidth / Math.max(1, tier.outHeight);

    let sw = Math.floor(videoWidth * cropFrac);
    let sh = Math.floor(videoHeight * cropFrac);
    const ar = sw / Math.max(1, sh);
    if (ar > targetAspect) {
      sw = Math.floor(sh * targetAspect);
    } else if (ar < targetAspect) {
      sh = Math.floor(sw / targetAspect);
    }
    const sx = Math.floor((videoWidth - sw) / 2);
    const sy = Math.floor((videoHeight - sh) / 2);
    const upscaleFromDetection = sw / Math.max(1, detWidth);

    return {
      sx: Math.max(0, sx),
      sy: Math.max(0, sy),
      sw: Math.max(1, sw),
      sh: Math.max(1, sh),
      videoWidth,
      videoHeight,
      tier,
      upscaleFromDetection,
    };
  }
}
