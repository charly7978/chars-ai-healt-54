/**
 * CAMERA SERVICE UNIFICADO - FASE 1
 * 
 * Responsabilidades:
 * - Detección de capabilities de cámara
 * - Selección de cámara trasera con torch
 * - Aplicación de constraints con fallback progresivo
 * - Medición real de FPS
 * - Control de torch con verificación
 * - Exposición/white balance/focus/iso si disponibles
 */

export interface CameraCapabilities {
  hasTorch: boolean;
  hasExposureMode: boolean;
  hasWhiteBalanceMode: boolean;
  hasFocusMode: boolean;
  hasIso: boolean;
  hasZoom: boolean;
  exposureModes?: string[];
  whiteBalanceModes?: string[];
  focusModes?: string[];
  isoRange?: { min: number; max: number };
  zoomRange?: { min: number; max: number };
}

export interface CameraSettings {
  deviceId: string;
  label: string;
  width: number;
  height: number;
  frameRate: number;
  exposureMode?: string;
  whiteBalanceMode?: string;
  focusMode?: string;
  iso?: number;
  torch: boolean;
  zoom?: number;
}

export interface CameraDiagnostics {
  deviceLabel: string;
  deviceId: string;
  capabilities: CameraCapabilities;
  settings: CameraSettings;
  realFps: number;
  torchRequested: boolean;
  torchActive: boolean;
  torchEffective: boolean;
  constraintFailures: string[];
  constraintIgnored: string[];
  warmUpStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
  warmUpProgress: number;
  stabilizationScore: number;
}

export type FingerState = 
  | 'NO_FINGER'
  | 'FINGER_DETECTED_UNSTABLE'
  | 'FINGER_STABLE'
  | 'SATURATED'
  | 'TOO_DARK'
  | 'MOTION_CONTAMINATED';

export interface FrameMetrics {
  timestamp: number;
  meanR: number;
  meanG: number;
  meanB: number;
  meanLinearR: number;
  meanLinearG: number;
  meanLinearB: number;
  saturationRatio: number;
  contactScore: number;
  motionScore: number;
  fingerState: FingerState;
  roiBox: { x: number; y: number; width: number; height: number };
}

export class CameraService {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private activeTrack: MediaStreamTrack | null = null;
  
  private capabilities: CameraCapabilities = {
    hasTorch: false,
    hasExposureMode: false,
    hasWhiteBalanceMode: false,
    hasFocusMode: false,
    hasIso: false,
    hasZoom: false,
  };
  
  private settings: CameraSettings = {
    deviceId: '',
    label: '',
    width: 0,
    height: 0,
    frameRate: 30,
    torch: false,
  };
  
  private realFps: number = 30;
  private frameTimestamps: number[] = [];
  private lastFrameTime: number = 0;
  
  private torchRequested: boolean = false;
  private torchActive: boolean = false;
  private torchEffective: boolean = false;
  
  private constraintFailures: string[] = [];
  private constraintIgnored: string[] = [];
  
  private warmUpStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED' = 'NOT_STARTED';
  private warmUpProgress: number = 0;
  private warmUpStartTime: number = 0;
  private luminanceHistory: number[] = [];
  private clipHistory: { high: number; low: number }[] = [];
  
  private isStarting: boolean = false;
  private warmUpDuration: number = 1000; // 1 segundo
  private warmUpInterval: number = 100; // 100ms
  
  private onStreamReady?: (stream: MediaStream) => void;
  private onWarmUpComplete?: () => void;
  private onFrameMetrics?: (metrics: FrameMetrics) => void;
  private onError?: (error: string) => void;

  constructor() {
    this.initializeFrameTiming();
  }

  private initializeFrameTiming(): void {
    this.frameTimestamps = [];
    this.lastFrameTime = 0;
  }

  private updateFps(): void {
    const now = performance.now();
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = now;
      return;
    }
    
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;
    
    if (delta < 8 || delta > 120) return; // Ignorar deltas anormales
    
    this.frameTimestamps.push(delta);
    if (this.frameTimestamps.length > 30) {
      this.frameTimestamps.shift();
    }
    
    if (this.frameTimestamps.length >= 10) {
      const sorted = [...this.frameTimestamps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      this.realFps = Math.max(15, Math.min(60, 1000 / median));
    }
  }

  /**
   * Fase 1: Enumerar dispositivos y encontrar cámara trasera con torch
   */
  private async findBackCameraWithTorch(): Promise<{ deviceId: string; label: string } | null> {
    try {
      // Solicitar acceso mínimo primero para obtener labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      tempStream.getTracks().forEach(t => t.stop());
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      
      console.log('📷 Cámaras encontradas:', videoDevices.length);
      
      const candidates: { deviceId: string; label: string; hasTorch: boolean }[] = [];
      
      for (const device of videoDevices) {
        const label = device.label.toLowerCase();
        const isBack = label.includes('back') || label.includes('rear') || 
          label.includes('environment') || label.includes('trasera') ||
          label.includes('camera 0') || label.includes('camera0') ||
          videoDevices.length === 1;
        
        if (isBack) {
          try {
            const testStream = await navigator.mediaDevices.getUserMedia({
              video: { 
                deviceId: { exact: device.deviceId },
                width: { ideal: 640 },
                height: { ideal: 480 }
              }
            });
            const track = testStream.getVideoTracks()[0];
            const caps = track.getCapabilities?.() as any;
            const hasTorch = caps?.torch === true;
            
            candidates.push({
              deviceId: device.deviceId,
              label: device.label || 'Unknown',
              hasTorch
            });
            
            testStream.getTracks().forEach(t => t.stop());
          } catch (e) {
            console.warn('Falló test de cámara:', device.label, e);
          }
        }
      }
      
      // Ordenar: torch primero, luego resolución
      candidates.sort((a, b) => {
        if (a.hasTorch && !b.hasTorch) return -1;
        if (!a.hasTorch && b.hasTorch) return 1;
        return 0;
      });
      
      if (candidates.length > 0) {
        const best = candidates[0];
        console.log('✅ Cámara seleccionada:', best.label, '| Torch:', best.hasTorch);
        return { deviceId: best.deviceId, label: best.label };
      }
      
      console.warn('⚠️ No se encontró cámara trasera adecuada');
      return null;
    } catch (e) {
      console.error('❌ Error enumerando cámaras:', e);
      return null;
    }
  }

  /**
   * Detectar capabilities del track activo
   */
  private detectCapabilities(track: MediaStreamTrack): CameraCapabilities {
    const caps = track.getCapabilities?.() as any;
    
    const capabilities: CameraCapabilities = {
      hasTorch: caps?.torch === true,
      hasExposureMode: Array.isArray(caps?.exposureMode) && caps.exposureMode.length > 0,
      hasWhiteBalanceMode: Array.isArray(caps?.whiteBalanceMode) && caps.whiteBalanceMode.length > 0,
      hasFocusMode: Array.isArray(caps?.focusMode) && caps.focusMode.length > 0,
      hasIso: typeof caps?.iso?.min === 'number' && typeof caps?.iso?.max === 'number',
      hasZoom: typeof caps?.zoom?.min === 'number' && typeof caps?.zoom?.max === 'number',
    };
    
    if (capabilities.hasExposureMode) {
      capabilities.exposureModes = caps.exposureMode;
    }
    if (capabilities.hasWhiteBalanceMode) {
      capabilities.whiteBalanceModes = caps.whiteBalanceMode;
    }
    if (capabilities.hasFocusMode) {
      capabilities.focusModes = caps.focusMode;
    }
    if (capabilities.hasIso) {
      capabilities.isoRange = { min: caps.iso.min, max: caps.iso.max };
    }
    if (capabilities.hasZoom) {
      capabilities.zoomRange = { min: caps.zoom.min, max: caps.zoom.max };
    }
    
    this.capabilities = capabilities;
    return capabilities;
  }

  /**
   * Aplicar constraint individual con verificación
   */
  private async applyConstraint(
    track: MediaStreamTrack,
    name: string,
    value: any
  ): Promise<{ success: boolean; effective?: any }> {
    try {
      await track.applyConstraints({ advanced: [{ [name]: value } as any] });
      const settings = track.getSettings() as any;
      const effective = (settings as any)[name];
      return { success: true, effective };
    } catch (e) {
      this.constraintFailures.push(name);
      console.warn(`⚠️ Constraint falló: ${name}`, e);
      return { success: false };
    }
  }

  /**
   * Activar torch con reintentos y verificación
   */
  private async activateTorch(track: MediaStreamTrack): Promise<boolean> {
    if (!this.capabilities.hasTorch) {
      this.constraintIgnored.push('torch');
      return false;
    }
    
    this.torchRequested = true;
    
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await track.applyConstraints({ advanced: [{ torch: true } as any] });
        const settings = track.getSettings() as any;
        const isActive = (settings as any).torch === true;
        
        if (isActive) {
          this.torchActive = true;
          this.torchEffective = true;
          console.log('🔦 Torch ON (verificado)');
          return true;
        }
      } catch (e) {
        console.warn(`Torch intento ${attempt} falló:`, e);
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    this.torchActive = false;
    this.torchEffective = false;
    this.constraintFailures.push('torch');
    console.warn('⚠️ Torch falló después de 5 intentos');
    return false;
  }

  /**
   * Fase 4: Aplicar controles finos después de warm-up
   */
  private async applyFineControls(track: MediaStreamTrack): Promise<void> {
    const caps = track.getCapabilities?.() as any;
    
    // Frame rate lock
    await this.applyConstraint(track, 'frameRate', 30);
    
    // Exposure
    if (this.capabilities.hasExposureMode) {
      if (caps.exposureMode.includes('manual')) {
        const result = await this.applyConstraint(track, 'exposureMode', 'manual');
        if (!result.success) {
          this.constraintFailures.push('exposureMode');
        }
      } else if (caps.exposureMode.includes('continuous')) {
        await this.applyConstraint(track, 'exposureMode', 'continuous');
        this.constraintIgnored.push('exposureMode');
      } else {
        this.constraintIgnored.push('exposureMode');
      }
    }
    
    // Exposure compensation
    if (caps.exposureCompensation) {
      const min = caps.exposureCompensation.min ?? -2;
      const max = caps.exposureCompensation.max ?? 2;
      const target = Math.max(min, Math.min(max, -0.35));
      await this.applyConstraint(track, 'exposureCompensation', target);
    }
    
    // White balance
    if (this.capabilities.hasWhiteBalanceMode) {
      if (caps.whiteBalanceMode.includes('manual')) {
        const result = await this.applyConstraint(track, 'whiteBalanceMode', 'manual');
        if (!result.success) {
          this.constraintFailures.push('whiteBalanceMode');
        }
      } else if (caps.whiteBalanceMode.includes('continuous')) {
        await this.applyConstraint(track, 'whiteBalanceMode', 'continuous');
        this.constraintIgnored.push('whiteBalanceMode');
      } else {
        this.constraintIgnored.push('whiteBalanceMode');
      }
    }
    
    // ISO
    if (this.capabilities.hasIso) {
      const minISO = caps.iso.min ?? 50;
      const maxISO = caps.iso.max ?? 400;
      const targetISO = Math.max(minISO, Math.min(maxISO, 140));
      const result = await this.applyConstraint(track, 'iso', targetISO);
      if (result.success) {
        this.settings.iso = targetISO;
      } else {
        this.constraintFailures.push('iso');
      }
    }
    
    // Focus
    if (this.capabilities.hasFocusMode) {
      if (caps.focusMode.includes('manual')) {
        const result = await this.applyConstraint(track, 'focusMode', 'manual');
        if (!result.success) {
          this.constraintFailures.push('focusMode');
        }
      } else if (caps.focusMode.includes('continuous')) {
        await this.applyConstraint(track, 'focusMode', 'continuous');
        this.constraintIgnored.push('focusMode');
      } else {
        this.constraintIgnored.push('focusMode');
      }
    }
  }

  /**
   * Calcular score de estabilización durante warm-up
   */
  private calculateStabilizationScore(): number {
    if (this.luminanceHistory.length < 5) return 0;
    
    const recent = this.luminanceHistory.slice(-5);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, l) => sum + (l - mean) ** 2, 0) / recent.length;
    const std = Math.sqrt(variance);
    const lumStability = Math.max(0, 1 - std / (mean + 1));
    
    const lumIncrease = this.luminanceHistory.length >= 2 
      ? (this.luminanceHistory[this.luminanceHistory.length - 1] - this.luminanceHistory[0]) 
      / (this.luminanceHistory[0] + 1) 
      : 0;
    const torchEffect = Math.min(1, Math.max(0, lumIncrease * 5));
    
    const avgClipHigh = this.clipHistory.reduce((sum, c) => sum + c.high, 0) / this.clipHistory.length;
    const avgClipLow = this.clipHistory.reduce((sum, c) => sum + c.low, 0) / this.clipHistory.length;
    const clipQuality = Math.max(0, 1 - (avgClipHigh + avgClipLow) * 10);
    
    return lumStability * 0.4 + torchEffect * 0.3 + clipQuality * 0.3;
  }

  /**
   * Capturar frame para análisis de warm-up
   */
  private captureWarmUpFrame(): void {
    if (!this.videoElement || this.videoElement.readyState < 2) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    ctx.drawImage(this.videoElement, 0, 0, 64, 64);
    const imageData = ctx.getImageData(0, 0, 64, 64);
    const data = imageData.data;
    
    let totalLum = 0;
    let clipHigh = 0;
    let clipLow = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      totalLum += lum;
      
      if (r > 250 || g > 250 || b > 250) clipHigh++;
      if (r < 5 && g < 5 && b < 5) clipLow++;
    }
    
    const avgLum = totalLum / (data.length / 4);
    this.luminanceHistory.push(avgLum);
    this.clipHistory.push({ 
      high: clipHigh / (data.length / 4), 
      low: clipLow / (data.length / 4) 
    });
  }

  /**
   * Fase 3: Warm-up con torch activado
   */
  private async runWarmUp(track: MediaStreamTrack): Promise<void> {
    this.warmUpStatus = 'IN_PROGRESS';
    this.warmUpProgress = 0;
    this.warmUpStartTime = performance.now();
    this.luminanceHistory = [];
    this.clipHistory = [];
    
    // Activar torch
    await this.activateTorch(track);
    
    let warmUpElapsed = 0;
    
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        warmUpElapsed += this.warmUpInterval;
        this.warmUpProgress = Math.min(100, (warmUpElapsed / this.warmUpDuration) * 100);
        
        this.captureWarmUpFrame();
        
        if (warmUpElapsed >= this.warmUpDuration) {
          clearInterval(interval);
          
          const stabilizationScore = this.calculateStabilizationScore();
          
          if (stabilizationScore < 0.3) {
            console.warn('⚠️ Score de estabilización bajo:', stabilizationScore.toFixed(2));
            this.warmUpStatus = 'FAILED';
          } else {
            console.log('✅ Warm-up completo, score:', stabilizationScore.toFixed(2));
            this.warmUpStatus = 'COMPLETE';
            this.onWarmUpComplete?.();
          }
          
          resolve();
        }
      }, this.warmUpInterval);
    });
  }

  /**
   * Iniciar cámara
   */
  async start(
    videoElement: HTMLVideoElement,
    options?: {
      onStreamReady?: (stream: MediaStream) => void;
      onWarmUpComplete?: () => void;
      onFrameMetrics?: (metrics: FrameMetrics) => void;
      onError?: (error: string) => void;
    }
  ): Promise<boolean> {
    if (this.isStarting) return false;
    this.isStarting = true;
    
    this.onStreamReady = options?.onStreamReady;
    this.onWarmUpComplete = options?.onWarmUpComplete;
    this.onFrameMetrics = options?.onFrameMetrics;
    this.onError = options?.onError;
    
    this.videoElement = videoElement;
    this.constraintFailures = [];
    this.constraintIgnored = [];
    
    try {
      // Fase 1: Encontrar cámara trasera
      const cameraInfo = await this.findBackCameraWithTorch();
      if (!cameraInfo) {
        this.onError?.('No se encontró cámara trasera adecuada');
        this.isStarting = false;
        return false;
      }
      
      this.settings.deviceId = cameraInfo.deviceId;
      this.settings.label = cameraInfo.label;
      
      // Fase 2: Abrir stream con constraints base
      const baseConstraints: MediaTrackConstraints = {
        deviceId: { exact: cameraInfo.deviceId },
        width: { ideal: 640, max: 960 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 30, min: 24, max: 30 }
      };
      
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: baseConstraints
        });
      } catch {
        console.warn('Fallback a constraints simples');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { 
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });
      }
      
      this.stream = stream;
      this.activeTrack = stream.getVideoTracks()[0];
      
      if (!this.activeTrack) {
        this.onError?.('No se obtuvo track de video');
        this.isStarting = false;
        return false;
      }
      
      // Conectar video
      this.videoElement.srcObject = stream;
      await new Promise<void>((resolve) => {
        const video = this.videoElement!;
        video.onloadedmetadata = async () => {
          try { await video.play(); } catch {}
          resolve();
        };
      });
      
      // Detectar capabilities
      this.detectCapabilities(this.activeTrack);
      
      // Guardar settings iniciales
      const initialSettings = this.activeTrack.getSettings() as any;
      this.settings.width = initialSettings.width || 640;
      this.settings.height = initialSettings.height || 480;
      this.settings.frameRate = initialSettings.frameRate || 30;
      
      // Fase 3: Warm-up con torch
      await this.runWarmUp(this.activeTrack);
      
      if (this.warmUpStatus === 'FAILED') {
        this.onError?.('Warm-up falló: estabilización insuficiente');
        this.stop();
        this.isStarting = false;
        return false;
      }
      
      // Fase 4: Aplicar controles finos
      await new Promise(r => setTimeout(r, 200));
      await this.applyFineControls(this.activeTrack);
      
      // Verificar settings finales
      const finalSettings = this.activeTrack.getSettings() as any;
      this.settings.exposureMode = finalSettings.exposureMode;
      this.settings.whiteBalanceMode = finalSettings.whiteBalanceMode;
      this.settings.focusMode = finalSettings.focusMode;
      this.settings.iso = finalSettings.iso;
      this.settings.zoom = finalSettings.zoom;
      this.settings.torch = (finalSettings as any).torch === true;
      
      console.log('📹 Cámara lista:', this.settings);
      
      this.onStreamReady?.(stream);
      this.isStarting = false;
      return true;
      
    } catch (error) {
      console.error('❌ Error iniciando cámara:', error);
      this.onError?.(error instanceof Error ? error.message : 'Error desconocido');
      this.stop();
      this.isStarting = false;
      return false;
    }
  }

  /**
   * Detener cámara
   */
  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getVideoTracks()) {
        try {
          const caps = track.getCapabilities?.() as any;
          if (caps?.torch) {
            track.applyConstraints({ advanced: [{ torch: false } as any] });
          }
        } catch {}
        track.stop();
      }
      this.stream = null;
    }
    
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    
    this.activeTrack = null;
    this.isStarting = false;
    this.warmUpStatus = 'NOT_STARTED';
    this.warmUpProgress = 0;
    this.torchRequested = false;
    this.torchActive = false;
    this.torchEffective = false;
    this.initializeFrameTiming();
  }

  /**
   * Obtener diagnósticos
   */
  getDiagnostics(): CameraDiagnostics {
    return {
      deviceLabel: this.settings.label,
      deviceId: this.settings.deviceId,
      capabilities: this.capabilities,
      settings: this.settings,
      realFps: this.realFps,
      torchRequested: this.torchRequested,
      torchActive: this.torchActive,
      torchEffective: this.torchEffective,
      constraintFailures: [...this.constraintFailures],
      constraintIgnored: [...this.constraintIgnored],
      warmUpStatus: this.warmUpStatus,
      warmUpProgress: this.warmUpProgress,
      stabilizationScore: this.calculateStabilizationScore(),
    };
  }

  /**
   * Obtener video element
   */
  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  /**
   * Obtener stream activo
   */
  getStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Obtener track activo
   */
  getActiveTrack(): MediaStreamTrack | null {
    return this.activeTrack;
  }

  /**
   * Verificar si está warmed up
   */
  isWarmedUp(): boolean {
    return this.warmUpStatus === 'COMPLETE';
  }
}
