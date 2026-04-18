/**
 * CAMERA CAPABILITY MANAGER
 * 
 * Manages real camera capabilities, settings, and constraint application
 * with fallback and runtime diagnostics. No assumptions - only real capabilities.
 */

export interface CameraProfile {
  deviceId: string;
  width: number;
  height: number;
  frameRate: number;
  torch: boolean;
  torchActive: boolean;
  focusMode: string;
  exposureMode: string;
  whiteBalanceMode: string;
  iso: number;
  exposureCompensation: number;
  zoom: number;
  resizeMode: string;
  capabilities: CameraCapabilities;
  settings: CameraSettings;
  diagnostics: CameraDiagnostics;
}

export interface CameraCapabilities {
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  iso?: { min: number; max: number };
  exposureCompensation?: { min: number; max: number };
  zoom?: { min: number; max: number };
  frameRate?: { min: number; max: number };
  width?: { min: number; max: number };
  height?: { min: number; max: number };
  resizeMode?: string[];
}

export interface CameraSettings {
  width?: number;
  height?: number;
  frameRate?: number;
  torch?: boolean;
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
  iso?: number;
  exposureCompensation?: number;
  zoom?: number;
  resizeMode?: string;
}

export interface CameraDiagnostics {
  torchAttempts: number;
  torchSuccess: boolean;
  exposureLocked: boolean;
  wbLocked: boolean;
  focusLocked: boolean;
  frameRateStable: boolean;
  frameRateChanges: number;
  torchOffEvents: number;
  unsupportedConstraints: string[];
  appliedConstraints: string[];
  failedConstraints: string[];
}

export class CameraCapabilityManager {
  private profile: CameraProfile | null = null;
  private track: MediaStreamTrack | null = null;
  private lastFrameRateCheck = 0;
  private lastFrameRate = 0;
  private diagnostics: CameraDiagnostics = {
    torchAttempts: 0,
    torchSuccess: false,
    exposureLocked: false,
    wbLocked: false,
    focusLocked: false,
    frameRateStable: true,
    frameRateChanges: 0,
    torchOffEvents: 0,
    unsupportedConstraints: [],
    appliedConstraints: [],
    failedConstraints: [],
  };

  /**
   * Get capabilities from track
   */
  getCapabilities(track: MediaStreamTrack): CameraCapabilities {
    const caps = track.getCapabilities?.() as any;
    if (!caps) return {};

    const capabilities: CameraCapabilities = {};
    
    if (caps.torch !== undefined) capabilities.torch = caps.torch;
    if (caps.focusMode) capabilities.focusMode = caps.focusMode;
    if (caps.exposureMode) capabilities.exposureMode = caps.exposureMode;
    if (caps.whiteBalanceMode) capabilities.whiteBalanceMode = caps.whiteBalanceMode;
    if (caps.iso) capabilities.iso = { min: caps.iso.min ?? 50, max: caps.iso.max ?? 1600 };
    if (caps.exposureCompensation) {
      capabilities.exposureCompensation = {
        min: caps.exposureCompensation.min ?? -2,
        max: caps.exposureCompensation.max ?? 2
      };
    }
    if (caps.zoom) capabilities.zoom = { min: caps.zoom.min ?? 1, max: caps.zoom.max ?? 10 };
    if (caps.frameRate) capabilities.frameRate = { min: caps.frameRate.min ?? 1, max: caps.frameRate.max ?? 60 };
    if (caps.width) capabilities.width = { min: caps.width.min ?? 1, max: caps.width.max ?? 4096 };
    if (caps.height) capabilities.height = { min: caps.height.min ?? 1, max: caps.height.max ?? 4096 };
    if (caps.resizeMode) capabilities.resizeMode = caps.resizeMode;

    return capabilities;
  }

  /**
   * Get current settings from track
   */
  getSettings(track: MediaStreamTrack): CameraSettings {
    const settings = track.getSettings?.() as any;
    if (!settings) return {};

    return {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      torch: settings.torch,
      focusMode: settings.focusMode,
      exposureMode: settings.exposureMode,
      whiteBalanceMode: settings.whiteBalanceMode,
      iso: settings.iso,
      exposureCompensation: settings.exposureCompensation,
      zoom: settings.zoom,
      resizeMode: settings.resizeMode,
    };
  }

  /**
   * Apply constraint with fallback
   */
  async applyConstraint(
    track: MediaStreamTrack,
    constraintName: string,
    value: any,
    isAdvanced = false
  ): Promise<boolean> {
    const caps = this.getCapabilities(track);
    
    // Check if constraint is supported
    if (isAdvanced) {
      // For advanced constraints, check capability directly
      const capValue = (caps as any)[constraintName];
      if (capValue === undefined) {
        this.diagnostics.unsupportedConstraints.push(constraintName);
        return false;
      }
      if (Array.isArray(capValue) && !capValue.includes(value)) {
        this.diagnostics.failedConstraints.push(`${constraintName}:${value}`);
        return false;
      }
    }

    try {
      if (isAdvanced) {
        await track.applyConstraints({ advanced: [{ [constraintName]: value } as any] });
      } else {
        await track.applyConstraints({ [constraintName]: value });
      }
      this.diagnostics.appliedConstraints.push(constraintName);
      return true;
    } catch (e) {
      this.diagnostics.failedConstraints.push(`${constraintName}:${value}`);
      return false;
    }
  }

  /**
   * Apply torch with multiple attempts
   */
  async applyTorch(track: MediaStreamTrack, enable: boolean): Promise<boolean> {
    const caps = this.getCapabilities(track);
    if (!caps.torch) return false;

    this.diagnostics.torchAttempts++;
    
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await track.applyConstraints({ advanced: [{ torch: enable } as any] });
        
        // Verify it actually applied
        const settings = this.getSettings(track);
        if (settings.torch === enable) {
          this.diagnostics.torchSuccess = enable;
          return true;
        }
        
        await new Promise(r => setTimeout(r, 250));
      } catch {
        await new Promise(r => setTimeout(r, 250));
      }
    }
    
    return false;
  }

  /**
   * Apply optimal constraints in sequence
   */
  async applyOptimalConstraints(track: MediaStreamTrack): Promise<void> {
    const caps = this.getCapabilities(track);
    
    // 1. Torch first (highest priority)
    if (caps.torch) {
      const torchOk = await this.applyTorch(track, true);
      if (!torchOk) {
        console.warn('⚠️ Torch activation failed');
      }
    }

    // 2. Frame rate - choose highest stable
    if (caps.frameRate) {
      const targetFps = Math.min(30, caps.frameRate.max);
      await this.applyConstraint(track, 'frameRate', targetFps, false);
    }

    // 3. Exposure mode
    if (caps.exposureMode) {
      if (caps.exposureMode.includes('manual')) {
        this.diagnostics.exposureLocked = await this.applyConstraint(track, 'exposureMode', 'manual', true);
      } else if (caps.exposureMode.includes('continuous')) {
        await this.applyConstraint(track, 'exposureMode', 'continuous', true);
      }
    }

    // 4. Exposure compensation
    if (caps.exposureCompensation) {
      const min = caps.exposureCompensation.min;
      const max = caps.exposureCompensation.max;
      const target = Math.max(min, Math.min(max, -0.35));
      await this.applyConstraint(track, 'exposureCompensation', target, true);
    }

    // 5. White balance mode
    if (caps.whiteBalanceMode) {
      if (caps.whiteBalanceMode.includes('manual')) {
        this.diagnostics.wbLocked = await this.applyConstraint(track, 'whiteBalanceMode', 'manual', true);
      } else if (caps.whiteBalanceMode.includes('continuous')) {
        await this.applyConstraint(track, 'whiteBalanceMode', 'continuous', true);
      }
    }

    // 6. ISO
    if (caps.iso) {
      const minISO = caps.iso.min;
      const maxISO = caps.iso.max;
      const targetISO = Math.max(minISO, Math.min(maxISO, 140));
      await this.applyConstraint(track, 'iso', targetISO, true);
    }

    // 7. Focus mode
    if (caps.focusMode) {
      if (caps.focusMode.includes('manual')) {
        this.diagnostics.focusLocked = await this.applyConstraint(track, 'focusMode', 'manual', true);
      } else if (caps.focusMode.includes('continuous')) {
        await this.applyConstraint(track, 'focusMode', 'continuous', true);
      }
    }

    // 8. Zoom - set to neutral/optimal
    if (caps.zoom) {
      const targetZoom = 1.0;
      if (targetZoom >= caps.zoom.min && targetZoom <= caps.zoom.max) {
        await this.applyConstraint(track, 'zoom', targetZoom, true);
      }
    }
  }

  /**
   * Build camera profile from track
   */
  buildProfile(track: MediaStreamTrack, deviceId: string): CameraProfile {
    this.track = track;
    const caps = this.getCapabilities(track);
    const settings = this.getSettings(track);

    this.profile = {
      deviceId,
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      frameRate: settings.frameRate ?? 30,
      torch: caps.torch ?? false,
      torchActive: settings.torch ?? false,
      focusMode: settings.focusMode ?? 'unknown',
      exposureMode: settings.exposureMode ?? 'unknown',
      whiteBalanceMode: settings.whiteBalanceMode ?? 'unknown',
      iso: settings.iso ?? 0,
      exposureCompensation: settings.exposureCompensation ?? 0,
      zoom: settings.zoom ?? 1,
      resizeMode: settings.resizeMode ?? 'unknown',
      capabilities: caps,
      settings,
      diagnostics: { ...this.diagnostics },
    };

    this.lastFrameRate = this.profile.frameRate;

    return this.profile;
  }

  /**
   * Monitor frame rate stability
   */
  monitorFrameRate(): void {
    if (!this.track || !this.profile) return;

    const settings = this.getSettings(this.track);
    const currentFps = settings.frameRate ?? 30;

    if (currentFps !== this.lastFrameRate) {
      this.diagnostics.frameRateChanges++;
      this.lastFrameRate = currentFps;
      
      if (this.diagnostics.frameRateChanges > 3) {
        this.diagnostics.frameRateStable = false;
      }
    }

    this.profile.frameRate = currentFps;
  }

  /**
   * Monitor torch state
   */
  monitorTorch(): void {
    if (!this.track || !this.profile) return;

    const settings = this.getSettings(this.track);
    const torchActive = settings.torch ?? false;

    if (this.profile.torchActive && !torchActive) {
      this.diagnostics.torchOffEvents++;
    }

    this.profile.torchActive = torchActive;
  }

  /**
   * Get current profile
   */
  getProfile(): CameraProfile | null {
    return this.profile;
  }

  /**
   * Get diagnostics
   */
  getDiagnostics(): CameraDiagnostics {
    return { ...this.diagnostics };
  }

  /**
   * Reset diagnostics
   */
  resetDiagnostics(): void {
    this.diagnostics = {
      torchAttempts: 0,
      torchSuccess: false,
      exposureLocked: false,
      wbLocked: false,
      focusLocked: false,
      frameRateStable: true,
      frameRateChanges: 0,
      torchOffEvents: 0,
      unsupportedConstraints: [],
      appliedConstraints: [],
      failedConstraints: [],
    };
  }

  /**
   * Clear profile
   */
  clear(): void {
    this.profile = null;
    this.track = null;
    this.resetDiagnostics();
    this.lastFrameRate = 0;
  }
}
