/**
 * CAMERA CAPABILITY MANAGER V2
 * 
 * Real camera negotiation with:
 * - Post-constraint verification (getSettings, getCapabilities)
 * - Acquisition profile with negotiated values
 * - Drift detection for exposure/WB
 * - AcquisitionAdapter interface for web/native abstraction
 */

// Real acquisition profile after constraint negotiation
export interface AcquisitionProfile {
  // Identity
  deviceId: string;
  deviceLabel: string;
  facingMode: 'environment' | 'user' | 'unknown';
  
  // Negotiated resolution
  requestedWidth: number;
  requestedHeight: number;
  actualWidth: number;
  actualHeight: number;
  aspectRatio: number;
  
  // Negotiated frame rate
  requestedFrameRate: number;
  actualFrameRate: number;
  frameRateStable: boolean;
  frameRateChanges: number;
  
  // Torch
  torchSupported: boolean;
  torchRequested: boolean;
  torchActive: boolean;
  torchOffEvents: number;
  
  // Exposure
  exposureModeSupported: boolean;
  exposureModeRequested: string;
  exposureModeActual: string;
  exposureCompensationSupported: boolean;
  exposureCompensationRequested: number;
  exposureCompensationActual: number;
  exposureTime?: number; // If available
  
  // White Balance
  whiteBalanceModeSupported: boolean;
  whiteBalanceModeRequested: string;
  whiteBalanceModeActual: string;
  colorTemperature?: number; // If available
  
  // ISO
  isoSupported: boolean;
  isoRange: { min: number; max: number };
  isoRequested: number;
  isoActual: number;
  
  // Focus
  focusModeSupported: boolean;
  focusModeRequested: string;
  focusModeActual: string;
  focusDistance?: number; // If available
  
  // Zoom
  zoomSupported: boolean;
  zoomRange: { min: number; max: number };
  zoomRequested: number;
  zoomActual: number;
  
  // Browser capability support
  supportedConstraints: string[];
  
  // Timestamps
  profileCreatedAt: number;
  lastVerifiedAt: number;
}

// Drift detection for baseline stability
export interface DriftEvent {
  timestamp: number;
  type: 'EXPOSURE' | 'WHITE_BALANCE' | 'FRAME_RATE' | 'TORCH';
  previousValue: number | string | boolean;
  currentValue: number | string | boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

// Acquisition Adapter Interface (Web + Native ready)
export interface AcquisitionAdapter {
  // Lifecycle
  initialize(constraints: MediaStreamConstraints): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // Profile
  getAcquisitionProfile(): AcquisitionProfile | null;
  refreshProfile(): AcquisitionProfile | null;
  
  // Drift monitoring
  checkDrift(): DriftEvent[];
  resetBaselines(): void;
  
  // Constraint application with verification
  applyConstraint(constraint: string, value: any): Promise<boolean>;
  verifyConstraint(constraint: string): boolean;
  
  // Stream access
  getVideoElement(): HTMLVideoElement | null;
  getMediaStream(): MediaStream | null;
  
  // Diagnostics
  getDiagnostics(): CameraDiagnostics;
}

// Legacy profile (maintained for compatibility)
export interface CameraProfile extends AcquisitionProfile {
  width: number; // alias for actualWidth
  height: number; // alias for actualHeight
  frameRate: number; // alias for actualFrameRate
  torch: boolean; // alias for torchSupported
  focusMode: string; // alias for focusModeActual
  exposureMode: string; // alias for exposureModeActual
  whiteBalanceMode: string; // alias for whiteBalanceModeActual
  iso: number; // alias for isoActual
  exposureCompensation: number; // alias for exposureCompensationActual
  zoom: number; // alias for zoomActual
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
   * Build camera profile from track (legacy method - delegates to buildAcquisitionProfile)
   */
  buildProfile(track: MediaStreamTrack, deviceId: string, deviceLabel: string = ''): CameraProfile {
    // Use new acquisition profile builder with default constraints
    const acquisitionProfile = this.buildAcquisitionProfile(
      track, 
      deviceId, 
      deviceLabel,
      {} // Use actual settings as requested
    );
    
    // Return as CameraProfile (full compatibility)
    return acquisitionProfile as CameraProfile;
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
    this.baselineSettings = null;
    this.driftEvents = [];
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DRIFT DETECTION & BASELINE MANAGEMENT (FASE 2)
  // ═══════════════════════════════════════════════════════════════════
  
  private baselineSettings: CameraSettings | null = null;
  private driftEvents: DriftEvent[] = [];
  private readonly DRIFT_THRESHOLD_EXPOSURE = 0.5; // exposureCompensation units
  private readonly DRIFT_THRESHOLD_WB_TEMP = 200; // Kelvin (approx)
  private readonly DRIFT_THRESHOLD_ISO = 50;
  private readonly DRIFT_THRESHOLD_FPS = 5;
  private readonly DRIFT_WINDOW_MS = 300; // min time between drift checks
  private lastDriftCheck = 0;

  /**
   * Establish baseline settings after warmup period
   * Call this after camera has stabilized (~2 seconds)
   */
  establishBaseline(): void {
    if (!this.track) return;
    this.baselineSettings = this.getSettings(this.track);
    this.lastDriftCheck = performance.now();
    this.driftEvents = [];
    console.log('📷 Baseline established:', {
      exposure: this.baselineSettings.exposureCompensation,
      wb: this.baselineSettings.whiteBalanceMode,
      iso: this.baselineSettings.iso,
      fps: this.baselineSettings.frameRate,
    });
  }

  /**
   * Check for drift from baseline
   * Returns array of drift events detected
   */
  checkDrift(): DriftEvent[] {
    if (!this.track || !this.baselineSettings) return [];
    
    const now = performance.now();
    if (now - this.lastDriftCheck < this.DRIFT_WINDOW_MS) {
      return []; // Rate limited
    }
    this.lastDriftCheck = now;

    const current = this.getSettings(this.track);
    const newEvents: DriftEvent[] = [];

    // Exposure drift
    if (this.baselineSettings.exposureCompensation !== undefined && 
        current.exposureCompensation !== undefined) {
      const expDiff = Math.abs(current.exposureCompensation - this.baselineSettings.exposureCompensation);
      if (expDiff > this.DRIFT_THRESHOLD_EXPOSURE) {
        newEvents.push({
          timestamp: now,
          type: 'EXPOSURE',
          previousValue: this.baselineSettings.exposureCompensation,
          currentValue: current.exposureCompensation,
          severity: expDiff > 1.0 ? 'HIGH' : 'MEDIUM',
        });
      }
    }

    // White Balance mode drift (manual -> auto is bad)
    if (this.baselineSettings.whiteBalanceMode === 'manual' && 
        current.whiteBalanceMode !== 'manual') {
      newEvents.push({
        timestamp: now,
        type: 'WHITE_BALANCE',
        previousValue: this.baselineSettings.whiteBalanceMode,
        currentValue: current.whiteBalanceMode,
        severity: 'HIGH',
      });
    }

    // ISO drift (significant change)
    if (this.baselineSettings.iso !== undefined && current.iso !== undefined) {
      const isoDiff = Math.abs(current.iso - this.baselineSettings.iso);
      if (isoDiff > this.DRIFT_THRESHOLD_ISO) {
        newEvents.push({
          timestamp: now,
          type: 'EXPOSURE', // ISO affects exposure
          previousValue: this.baselineSettings.iso,
          currentValue: current.iso,
          severity: isoDiff > 100 ? 'HIGH' : 'MEDIUM',
        });
      }
    }

    // Frame rate drift
    if (this.baselineSettings.frameRate !== undefined && current.frameRate !== undefined) {
      const fpsDiff = Math.abs(current.frameRate - this.baselineSettings.frameRate);
      if (fpsDiff > this.DRIFT_THRESHOLD_FPS) {
        newEvents.push({
          timestamp: now,
          type: 'FRAME_RATE',
          previousValue: this.baselineSettings.frameRate,
          currentValue: current.frameRate,
          severity: 'MEDIUM',
        });
      }
    }

    // Torch drift (off when it should be on)
    if (this.baselineSettings.torch === true && current.torch === false) {
      newEvents.push({
        timestamp: now,
        type: 'TORCH',
        previousValue: true,
        currentValue: false,
        severity: 'HIGH',
      });
    }

    this.driftEvents.push(...newEvents);
    // Keep only last 50 events
    if (this.driftEvents.length > 50) {
      this.driftEvents = this.driftEvents.slice(-50);
    }

    return newEvents;
  }

  /**
   * Get all drift events
   */
  getDriftEvents(): DriftEvent[] {
    return [...this.driftEvents];
  }

  /**
   * Reset drift detection baselines
   */
  resetBaselines(): void {
    this.establishBaseline();
  }

  /**
   * Check if significant drift occurred (for pipeline invalidation)
   */
  hasSignificantDrift(): boolean {
    const recentEvents = this.driftEvents.filter(
      e => performance.now() - e.timestamp < 1000 // Last second
    );
    return recentEvents.some(e => e.severity === 'HIGH');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  POST-CONSTRAINT VERIFICATION (FASE 2)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Verify that a constraint was actually applied by checking getSettings()
   */
  verifyConstraint(constraintName: string): boolean {
    if (!this.track || !this.profile) return false;
    
    const settings = this.getSettings(this.track);
    const requested = (this.profile as any)[`${constraintName}Requested`] ?? 
                      (this.profile as any)[constraintName];
    const actual = (settings as any)[constraintName];
    
    if (actual === undefined) return false;
    
    // For numeric values, allow small tolerance
    if (typeof requested === 'number' && typeof actual === 'number') {
      const tolerance = constraintName === 'frameRate' ? 2 : 0.1;
      return Math.abs(actual - requested) <= tolerance;
    }
    
    // For strings/booleans, exact match
    return actual === requested;
  }

  /**
   * Refresh profile with current actual settings
   */
  refreshProfile(): CameraProfile | null {
    if (!this.track || !this.profile) return null;
    
    const currentSettings = this.getSettings(this.track);
    const currentCaps = this.getCapabilities(this.track);
    
    // Update actual values
    this.profile.actualWidth = currentSettings.width ?? this.profile.actualWidth;
    this.profile.actualHeight = currentSettings.height ?? this.profile.actualHeight;
    this.profile.actualFrameRate = currentSettings.frameRate ?? this.profile.actualFrameRate;
    this.profile.torchActive = currentSettings.torch ?? this.profile.torchActive;
    this.profile.exposureModeActual = currentSettings.exposureMode ?? this.profile.exposureModeActual;
    this.profile.exposureCompensationActual = currentSettings.exposureCompensation ?? this.profile.exposureCompensationActual;
    this.profile.whiteBalanceModeActual = currentSettings.whiteBalanceMode ?? this.profile.whiteBalanceModeActual;
    this.profile.isoActual = currentSettings.iso ?? this.profile.isoActual;
    this.profile.focusModeActual = currentSettings.focusMode ?? this.profile.focusModeActual;
    this.profile.zoomActual = currentSettings.zoom ?? this.profile.zoomActual;
    this.profile.lastVerifiedAt = performance.now();
    
    // Update legacy aliases
    this.profile.width = this.profile.actualWidth;
    this.profile.height = this.profile.actualHeight;
    this.profile.frameRate = this.profile.actualFrameRate;
    this.profile.torch = this.profile.torchSupported;
    this.profile.torchActive = this.profile.torchActive;
    this.profile.focusMode = this.profile.focusModeActual;
    this.profile.exposureMode = this.profile.exposureModeActual;
    this.profile.whiteBalanceMode = this.profile.whiteBalanceModeActual;
    this.profile.iso = this.profile.isoActual;
    this.profile.exposureCompensation = this.profile.exposureCompensationActual;
    this.profile.zoom = this.profile.zoomActual;
    this.profile.settings = currentSettings;
    this.profile.capabilities = currentCaps;
    
    return this.profile;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SUPPORTED CONSTRAINTS DISCOVERY (FASE 2)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get browser-supported constraints from getSupportedConstraints()
   */
  getBrowserSupportedConstraints(): string[] {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      return [];
    }
    
    try {
      const supported = navigator.mediaDevices.getSupportedConstraints();
      return Object.keys(supported).filter(k => supported[k as keyof MediaTrackSupportedConstraints]);
    } catch {
      return [];
    }
  }

  /**
   * Build complete acquisition profile with negotiation tracking
   */
  buildAcquisitionProfile(
    track: MediaStreamTrack, 
    deviceId: string,
    deviceLabel: string,
    requestedConstraints: {
      width?: number;
      height?: number;
      frameRate?: number;
      torch?: boolean;
      exposureMode?: string;
      exposureCompensation?: number;
      whiteBalanceMode?: string;
      iso?: number;
      focusMode?: string;
      zoom?: number;
    }
  ): AcquisitionProfile {
    const caps = this.getCapabilities(track);
    const settings = this.getSettings(track);
    const browserConstraints = this.getBrowserSupportedConstraints();
    
    // Determine facing mode from label or capabilities
    let facingMode: 'environment' | 'user' | 'unknown' = 'unknown';
    const label = deviceLabel.toLowerCase();
    if (label.includes('back') || label.includes('rear') || label.includes('trasera') || label.includes('environment')) {
      facingMode = 'environment';
    } else if (label.includes('front') || label.includes('user') || label.includes('frontal') || label.includes('selfie')) {
      facingMode = 'user';
    }
    
    const now = performance.now();
    
    const profile: AcquisitionProfile = {
      // Identity
      deviceId,
      deviceLabel,
      facingMode,
      
      // Resolution
      requestedWidth: requestedConstraints.width ?? 0,
      requestedHeight: requestedConstraints.height ?? 0,
      actualWidth: settings.width ?? 0,
      actualHeight: settings.height ?? 0,
      aspectRatio: (settings.width ?? 0) / (settings.height ?? 1),
      
      // Frame rate
      requestedFrameRate: requestedConstraints.frameRate ?? 30,
      actualFrameRate: settings.frameRate ?? 30,
      frameRateStable: true,
      frameRateChanges: 0,
      
      // Torch
      torchSupported: caps.torch ?? false,
      torchRequested: requestedConstraints.torch ?? false,
      torchActive: settings.torch ?? false,
      torchOffEvents: 0,
      
      // Exposure
      exposureModeSupported: caps.exposureMode !== undefined,
      exposureModeRequested: requestedConstraints.exposureMode ?? 'unknown',
      exposureModeActual: settings.exposureMode ?? 'unknown',
      exposureCompensationSupported: caps.exposureCompensation !== undefined,
      exposureCompensationRequested: requestedConstraints.exposureCompensation ?? 0,
      exposureCompensationActual: settings.exposureCompensation ?? 0,
      
      // White Balance
      whiteBalanceModeSupported: caps.whiteBalanceMode !== undefined,
      whiteBalanceModeRequested: requestedConstraints.whiteBalanceMode ?? 'unknown',
      whiteBalanceModeActual: settings.whiteBalanceMode ?? 'unknown',
      
      // ISO
      isoSupported: caps.iso !== undefined,
      isoRange: caps.iso ?? { min: 50, max: 1600 },
      isoRequested: requestedConstraints.iso ?? 0,
      isoActual: settings.iso ?? 0,
      
      // Focus
      focusModeSupported: caps.focusMode !== undefined,
      focusModeRequested: requestedConstraints.focusMode ?? 'unknown',
      focusModeActual: settings.focusMode ?? 'unknown',
      
      // Zoom
      zoomSupported: caps.zoom !== undefined,
      zoomRange: caps.zoom ?? { min: 1, max: 1 },
      zoomRequested: requestedConstraints.zoom ?? 1,
      zoomActual: settings.zoom ?? 1,
      
      // Browser support
      supportedConstraints: browserConstraints,
      
      // Timestamps
      profileCreatedAt: now,
      lastVerifiedAt: now,
    };
    
    this.profile = profile as CameraProfile;
    this.profile.capabilities = caps;
    this.profile.settings = settings;
    this.profile.diagnostics = { ...this.diagnostics };
    this.track = track;
    
    return profile;
  }
}
