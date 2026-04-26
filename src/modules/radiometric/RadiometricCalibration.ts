/**
 * CALIBRACIÓN RADIOMÉTRICA - FASE 1
 * 
 * Responsabilidades:
 * - Captura de offset oscuro (dark estimate)
 * - Captura de punto blanco (white reference)
 * - Conversión sRGB → lineal
 * - Corrección de offset
 * - Normalización por white reference
 * - Conversión a densidad óptica (OD)
 * - Persistencia en IndexedDB
 */

export interface DarkOffsetRGB {
  r: number;
  g: number;
  b: number;
}

export interface WhiteRefRGB {
  r: number;
  g: number;
  b: number;
}

export interface DeviceCalibrationProfile {
  deviceKey: string;
  cameraLabel: string;
  videoWidth: number;
  videoHeight: number;
  fpsMeasured: number;
  torchSupported: boolean;
  exposureSupported: boolean;
  isoSupported: boolean;
  whiteBalanceSupported: boolean;
  darkOffsetRGB: DarkOffsetRGB;
  whiteRefRGB: WhiteRefRGB;
  createdAt: number;
  updatedAt: number;
}

export interface RadiometricResult {
  linearR: number;
  linearG: number;
  linearB: number;
  correctedR: number;
  correctedG: number;
  correctedB: number;
  normalizedR: number;
  normalizedG: number;
  normalizedB: number;
  odR: number;
  odG: number;
  odB: number;
}

const EPSILON = 1e-6;
const DARK_FRAMES_MIN = 20;
const DARK_FRAMES_MAX = 60;
const WHITE_FRAMES_MIN = 30;
const WHITE_FRAMES_MAX = 120;
const SATURATION_THRESHOLD = 250;
const SATURATION_RATIO_LIMIT = 0.05;

export class RadiometricCalibration {
  private darkOffsetRGB: DarkOffsetRGB = { r: 0, g: 0, b: 0 };
  private whiteRefRGB: WhiteRefRGB = { r: 255, g: 255, b: 255 };
  private darkOffsetLinear: DarkOffsetRGB = { r: 0, g: 0, b: 0 };
  private whiteRefLinear: WhiteRefRGB = { r: 1, g: 1, b: 1 };
  
  private darkFrames: number[][] = [[], [], []]; // R, G, B history
  private whiteFrames: number[][] = [[], [], []];
  private isDarkCalibrated: boolean = false;
  private isWhiteCalibrated: boolean = false;
  
  private deviceKey: string = '';
  private profile: DeviceCalibrationProfile | null = null;
  
  private db: IDBDatabase | null = null;
  private DB_NAME = 'PPGCalibrationDB';
  private DB_VERSION = 1;
  private STORE_NAME = 'deviceProfiles';

  constructor() {
    this.initDB();
  }

  /**
   * Inicializar IndexedDB
   */
  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      
      request.onerror = () => {
        console.error('❌ Error abriendo IndexedDB:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB inicializada');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'deviceKey' });
          store.createIndex('cameraLabel', 'cameraLabel', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
    });
  }

  /**
   * Generar deviceKey único
   */
  private generateDeviceKey(cameraLabel: string, width: number, height: number): string {
    const userAgent = navigator.userAgent;
    const hash = this.simpleHash(`${userAgent}|${cameraLabel}|${width}x${height}`);
    return hash;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Cargar perfil de dispositivo desde IndexedDB
   */
  async loadProfile(deviceKey: string): Promise<DeviceCalibrationProfile | null> {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(deviceKey);
      
      request.onsuccess = () => {
        const profile = request.result as DeviceCalibrationProfile | null;
        if (profile) {
          this.profile = profile;
          this.darkOffsetRGB = profile.darkOffsetRGB;
          this.whiteRefRGB = profile.whiteRefRGB;
          this.darkOffsetLinear = {
            r: this.sRGBToLinear(profile.darkOffsetRGB.r),
            g: this.sRGBToLinear(profile.darkOffsetRGB.g),
            b: this.sRGBToLinear(profile.darkOffsetRGB.b),
          };
          this.whiteRefLinear = {
            r: this.sRGBToLinear(profile.whiteRefRGB.r),
            g: this.sRGBToLinear(profile.whiteRefRGB.g),
            b: this.sRGBToLinear(profile.whiteRefRGB.b),
          };
          this.isDarkCalibrated = true;
          this.isWhiteCalibrated = true;
          console.log('✅ Perfil cargado:', deviceKey);
        }
        resolve(profile);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Guardar perfil de dispositivo en IndexedDB
   */
  async saveProfile(profile: DeviceCalibrationProfile): Promise<void> {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(profile);
      
      request.onsuccess = () => {
        this.profile = profile;
        console.log('✅ Perfil guardado:', profile.deviceKey);
        resolve();
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Conversión sRGB 8-bit a lineal
   * Fórmula: v = channel/255; linear = v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)^2.4
   */
  sRGBToLinear(srgb: number): number {
    const v = srgb / 255;
    if (v <= 0.04045) {
      return v / 12.92;
    }
    return Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /**
   * Conversión lineal a sRGB 8-bit (inversa)
   */
  linearToSRGB(linear: number): number {
    if (linear <= 0.0031308) {
      return linear * 12.92 * 255;
    }
    return (Math.pow(linear, 1 / 2.4) * 1.055 - 0.055) * 255;
  }

  /**
   * Calcular densidad óptica: OD = -log(normalized)
   */
  opticalDensity(normalized: number): number {
    return -Math.log(Math.max(normalized, EPSILON));
  }

  /**
   * Procesar frame completo para calibración de dark offset
   */
  captureDarkFrame(imageData: ImageData): void {
    const data = imageData.data;
    const sumR = [0], sumG = [0], sumB = [0];
    const count = [0];
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      sumR[0] += r;
      sumG[0] += g;
      sumB[0] += b;
      count[0]++;
    }
    
    const meanR = sumR[0] / count[0];
    const meanG = sumG[0] / count[0];
    const meanB = sumB[0] / count[0];
    
    this.darkFrames[0].push(meanR);
    this.darkFrames[1].push(meanG);
    this.darkFrames[2].push(meanB);
    
    // Limitar tamaño del buffer
    const maxFrames = DARK_FRAMES_MAX;
    for (let c = 0; c < 3; c++) {
      if (this.darkFrames[c].length > maxFrames) {
        this.darkFrames[c].shift();
      }
    }
  }

  /**
   * Calcular dark offset robusto usando percentiles
   */
  calculateDarkOffset(): DarkOffsetRGB {
    const minFrames = DARK_FRAMES_MIN;
    
    for (let c = 0; c < 3; c++) {
      if (this.darkFrames[c].length < minFrames) {
        console.warn(`⚠️ Frames insuficientes para dark offset: ${this.darkFrames[c].length}/${minFrames}`);
      }
    }
    
    // Usar p10/p20 como estimación robusta del offset oscuro
    const p10 = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * 0.1);
      return sorted[Math.max(0, idx)];
    };
    
    const darkR = this.darkFrames[0].length > 0 ? p10(this.darkFrames[0]) : 0;
    const darkG = this.darkFrames[1].length > 0 ? p10(this.darkFrames[1]) : 0;
    const darkB = this.darkFrames[2].length > 0 ? p10(this.darkFrames[2]) : 0;
    
    this.darkOffsetRGB = { r: darkR, g: darkG, b: darkB };
    this.darkOffsetLinear = {
      r: this.sRGBToLinear(darkR),
      g: this.sRGBToLinear(darkG),
      b: this.sRGBToLinear(darkB),
    };
    
    this.isDarkCalibrated = true;
    console.log('🌑 Dark offset calculado:', this.darkOffsetRGB);
    
    return this.darkOffsetRGB;
  }

  /**
   * Procesar frame para calibración de white reference
   */
  captureWhiteFrame(imageData: ImageData): { saturated: boolean; saturationRatio: number } {
    const data = imageData.data;
    const sumR = [0], sumG = [0], sumB = [0];
    const count = [0];
    let saturatedPixels = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      if (r >= SATURATION_THRESHOLD || g >= SATURATION_THRESHOLD || b >= SATURATION_THRESHOLD) {
        saturatedPixels++;
      }
      
      sumR[0] += r;
      sumG[0] += g;
      sumB[0] += b;
      count[0]++;
    }
    
    const saturationRatio = saturatedPixels / count[0];
    const saturated = saturationRatio > SATURATION_RATIO_LIMIT;
    
    if (!saturated) {
      const meanR = sumR[0] / count[0];
      const meanG = sumG[0] / count[0];
      const meanB = sumB[0] / count[0];
      
      this.whiteFrames[0].push(meanR);
      this.whiteFrames[1].push(meanG);
      this.whiteFrames[2].push(meanB);
      
      // Limitar tamaño del buffer
      const maxFrames = WHITE_FRAMES_MAX;
      for (let c = 0; c < 3; c++) {
        if (this.whiteFrames[c].length > maxFrames) {
          this.whiteFrames[c].shift();
        }
      }
    }
    
    return { saturated, saturationRatio };
  }

  /**
   * Calcular white reference robusto usando percentil alto
   */
  calculateWhiteRef(): WhiteRefRGB {
    const minFrames = WHITE_FRAMES_MIN;
    
    for (let c = 0; c < 3; c++) {
      if (this.whiteFrames[c].length < minFrames) {
        console.warn(`⚠️ Frames insuficientes para white ref: ${this.whiteFrames[c].length}/${minFrames}`);
      }
    }
    
    // Usar p95 como estimación robusta del punto blanco
    const p95 = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * 0.95);
      return sorted[Math.min(sorted.length - 1, idx)];
    };
    
    const whiteR = this.whiteFrames[0].length > 0 ? p95(this.whiteFrames[0]) : 255;
    const whiteG = this.whiteFrames[1].length > 0 ? p95(this.whiteFrames[1]) : 255;
    const whiteB = this.whiteFrames[2].length > 0 ? p95(this.whiteFrames[2]) : 255;
    
    this.whiteRefRGB = { r: whiteR, g: whiteG, b: whiteB };
    this.whiteRefLinear = {
      r: this.sRGBToLinear(whiteR),
      g: this.sRGBToLinear(whiteG),
      b: this.sRGBToLinear(whiteB),
    };
    
    this.isWhiteCalibrated = true;
    console.log('💡 White reference calculado:', this.whiteRefRGB);
    
    return this.whiteRefRGB;
  }

  /**
   * Pipeline radiométrico completo para un píxel RGB
   */
  processPixel(r: number, g: number, b: number): RadiometricResult {
    // 1. sRGB → lineal
    const linearR = this.sRGBToLinear(r);
    const linearG = this.sRGBToLinear(g);
    const linearB = this.sRGBToLinear(b);
    
    // 2. Corregir offset oscuro
    const correctedR = Math.max(linearR - this.darkOffsetLinear.r, EPSILON);
    const correctedG = Math.max(linearG - this.darkOffsetLinear.g, EPSILON);
    const correctedB = Math.max(linearB - this.darkOffsetLinear.b, EPSILON);
    
    // 3. Normalizar por white reference
    const whiteRangeR = Math.max(this.whiteRefLinear.r - this.darkOffsetLinear.r, EPSILON);
    const whiteRangeG = Math.max(this.whiteRefLinear.g - this.darkOffsetLinear.g, EPSILON);
    const whiteRangeB = Math.max(this.whiteRefLinear.b - this.darkOffsetLinear.b, EPSILON);
    
    const normalizedR = correctedR / whiteRangeR;
    const normalizedG = correctedG / whiteRangeG;
    const normalizedB = correctedB / whiteRangeB;
    
    // 4. Convertir a densidad óptica
    const odR = this.opticalDensity(normalizedR);
    const odG = this.opticalDensity(normalizedG);
    const odB = this.opticalDensity(normalizedB);
    
    return {
      linearR, linearG, linearB,
      correctedR, correctedG, correctedB,
      normalizedR, normalizedG, normalizedB,
      odR, odG, odB,
    };
  }

  /**
   * Procesar ROI completo (promedio de píxeles)
   */
  processROI(imageData: ImageData, roi: { x: number; y: number; width: number; height: number }): {
    meanLinear: { r: number; g: number; b: number };
    meanOD: { r: number; g: number; b: number };
    saturationRatio: number;
  } {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    let sumLinearR = 0, sumLinearG = 0, sumLinearB = 0;
    let sumODR = 0, sumODG = 0, sumODB = 0;
    let count = 0;
    let saturatedPixels = 0;
    
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        if (r >= SATURATION_THRESHOLD || g >= SATURATION_THRESHOLD || b >= SATURATION_THRESHOLD) {
          saturatedPixels++;
        }
        
        const result = this.processPixel(r, g, b);
        sumLinearR += result.linearR;
        sumLinearG += result.linearG;
        sumLinearB += result.linearB;
        sumODR += result.odR;
        sumODG += result.odG;
        sumODB += result.odB;
        count++;
      }
    }
    
    const saturationRatio = saturatedPixels / count;
    
    return {
      meanLinear: {
        r: sumLinearR / count,
        g: sumLinearG / count,
        b: sumLinearB / count,
      },
      meanOD: {
        r: sumODR / count,
        g: sumODG / count,
        b: sumODB / count,
      },
      saturationRatio,
    };
  }

  /**
   * Iniciar calibración completa de dispositivo
   */
  async calibrateDevice(
    cameraLabel: string,
    videoWidth: number,
    videoHeight: number,
    fpsMeasured: number,
    torchSupported: boolean,
    exposureSupported: boolean,
    isoSupported: boolean,
    whiteBalanceSupported: boolean
  ): Promise<DeviceCalibrationProfile> {
    this.deviceKey = this.generateDeviceKey(cameraLabel, videoWidth, videoHeight);
    
    const profile: DeviceCalibrationProfile = {
      deviceKey: this.deviceKey,
      cameraLabel,
      videoWidth,
      videoHeight,
      fpsMeasured,
      torchSupported,
      exposureSupported,
      isoSupported,
      whiteBalanceSupported,
      darkOffsetRGB: this.darkOffsetRGB,
      whiteRefRGB: this.whiteRefRGB,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.saveProfile(profile);
    return profile;
  }

  /**
   * Resetear calibración
   */
  reset(): void {
    this.darkOffsetRGB = { r: 0, g: 0, b: 0 };
    this.whiteRefRGB = { r: 255, g: 255, b: 255 };
    this.darkOffsetLinear = { r: 0, g: 0, b: 0 };
    this.whiteRefLinear = { r: 1, g: 1, b: 1 };
    this.darkFrames = [[], [], []];
    this.whiteFrames = [[], [], []];
    this.isDarkCalibrated = false;
    this.isWhiteCalibrated = false;
    this.profile = null;
  }

  /**
   * Obtener estado de calibración
   */
  getCalibrationStatus(): {
    isDarkCalibrated: boolean;
    isWhiteCalibrated: boolean;
    darkOffsetRGB: DarkOffsetRGB;
    whiteRefRGB: WhiteRefRGB;
    deviceKey: string;
  } {
    return {
      isDarkCalibrated: this.isDarkCalibrated,
      isWhiteCalibrated: this.isWhiteCalibrated,
      darkOffsetRGB: this.darkOffsetRGB,
      whiteRefRGB: this.whiteRefRGB,
      deviceKey: this.deviceKey,
    };
  }

  /**
   * Obtener perfil actual
   */
  getProfile(): DeviceCalibrationProfile | null {
    return this.profile;
  }
}
