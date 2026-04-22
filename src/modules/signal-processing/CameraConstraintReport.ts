/**
 * CAMERA CONSTRAINT REPORT
 * 
 * Consolida información de capabilities, constraints y settings de cámara.
 */

export interface ConstraintReport {
  // Capabilities soportados
  supportedCapabilities: string[];
  
  // Constraints solicitados
  requestedConstraints: Record<string, any>;
  
  // Settings efectivos después de applyConstraints
  effectiveSettings: Record<string, any>;
  
  // Constraints ignorados (no soportados)
  ignoredConstraints: string[];
  
  // Constraints que fallaron al aplicar
  failedConstraints: string[];
  
  // Warnings del navegador
  browserWarnings: string[];
  
  // Torch
  torchRequested: boolean;
  torchSupported: boolean;
  torchEffective: boolean;
  
  // Frame rate
  frameRateRequested: number;
  frameRateEffective: number;
  frameRateMatch: boolean;
  
  // Resolución
  resolutionRequested: { width: number; height: number };
  resolutionEffective: { width: number; height: number };
  resolutionMatch: boolean;
  
  // Otros controles
  exposureModeRequested?: string;
  exposureModeEffective?: string;
  exposureLocked: boolean;
  
  whiteBalanceModeRequested?: string;
  whiteBalanceModeEffective?: string;
  whiteBalanceLocked: boolean;
  
  focusModeRequested?: string;
  focusModeEffective?: string;
  focusLocked: boolean;
  
  isoRequested?: number;
  isoEffective?: number;
  
  // Dispositivo
  deviceId: string;
  deviceLabel: string;
  
  // Resumen
  overallQuality: 'EXCELLENT' | 'GOOD' | 'ACCEPTABLE' | 'POOR' | 'CRITICAL';
  summary: string;
}

export class CameraConstraintReport {
  private report: Partial<ConstraintReport> = {
    supportedCapabilities: [],
    requestedConstraints: {},
    effectiveSettings: {},
    ignoredConstraints: [],
    failedConstraints: [],
    browserWarnings: [],
    torchRequested: false,
    torchSupported: false,
    torchEffective: false,
    frameRateRequested: 30,
    frameRateEffective: 0,
    frameRateMatch: false,
    resolutionRequested: { width: 640, height: 480 },
    resolutionEffective: { width: 0, height: 0 },
    resolutionMatch: false,
    exposureLocked: false,
    whiteBalanceLocked: false,
    focusLocked: false,
    deviceId: '',
    deviceLabel: '',
    overallQuality: 'POOR',
    summary: ''
  };

  /**
   * Registra capabilities soportados
   */
  setSupportedCapabilities(capabilities: Record<string, any>): void {
    this.report.supportedCapabilities = Object.keys(capabilities).filter(k => capabilities[k]);
  }

  /**
   * Registra constraints solicitados
   */
  setRequestedConstraints(constraints: MediaTrackConstraints): void {
    this.report.requestedConstraints = { ...constraints };
    
    if (constraints.width) {
      this.report.resolutionRequested = {
        width: typeof constraints.width === 'object' ? constraints.width.ideal || 0 : constraints.width || 0,
        height: typeof constraints.height === 'object' ? constraints.height.ideal || 0 : constraints.height || 0
      };
    }
    
    if (constraints.frameRate) {
      this.report.frameRateRequested = typeof constraints.frameRate === 'object' 
        ? constraints.frameRate.ideal || 30 
        : constraints.frameRate || 30;
    }
  }

  /**
   * Registra settings efectivos después de applyConstraints
   */
  setEffectiveSettings(settings: Record<string, any>): void {
    this.report.effectiveSettings = { ...settings };
    
    this.report.resolutionEffective = {
      width: settings.width || 0,
      height: settings.height || 0
    };
    
    this.report.frameRateEffective = settings.frameRate || 0;
    this.report.isoEffective = settings.iso;
    this.report.exposureModeEffective = settings.exposureMode;
    this.report.whiteBalanceModeEffective = settings.whiteBalanceMode;
    this.report.focusModeEffective = settings.focusMode;
    
    // Verificar matches
    this.report.resolutionMatch = this.checkResolutionMatch();
    this.report.frameRateMatch = this.checkFrameRateMatch();
  }

  /**
   * Registra capabilities específicos de torch
   */
  setTorchInfo(supported: boolean, requested: boolean, effective: boolean): void {
    this.report.torchSupported = supported;
    this.report.torchRequested = requested;
    this.report.torchEffective = effective;
  }

  /**
   * Registra estado de locks
   */
  setLocks(exposure: boolean, wb: boolean, focus: boolean): void {
    this.report.exposureLocked = exposure;
    this.report.whiteBalanceLocked = wb;
    this.report.focusLocked = focus;
  }

  /**
   * Agrega constraint ignorado
   */
  addIgnoredConstraint(constraint: string): void {
    if (!this.report.ignoredConstraints!.includes(constraint)) {
      this.report.ignoredConstraints!.push(constraint);
    }
  }

  /**
   * Agrega constraint que falló
   */
  addFailedConstraint(constraint: string): void {
    if (!this.report.failedConstraints!.includes(constraint)) {
      this.report.failedConstraints!.push(constraint);
    }
  }

  /**
   * Agrega warning del navegador
   */
  addBrowserWarning(warning: string): void {
    if (!this.report.browserWarnings!.includes(warning)) {
      this.report.browserWarnings!.push(warning);
    }
  }

  /**
   * Registra info del dispositivo
   */
  setDeviceInfo(deviceId: string, deviceLabel: string): void {
    this.report.deviceId = deviceId;
    this.report.deviceLabel = deviceLabel;
  }

  /**
   * Verifica si la resolución coincide
   */
  private checkResolutionMatch(): boolean {
    const req = this.report.resolutionRequested!;
    const eff = this.report.resolutionEffective!;
    
    if (req.width === 0 || eff.width === 0) return false;
    
    // Tolerancia del 10%
    const widthMatch = Math.abs(req.width - eff.width) / req.width < 0.1;
    const heightMatch = Math.abs(req.height - eff.height) / req.height < 0.1;
    
    return widthMatch && heightMatch;
  }

  /**
   * Verifica si el frame rate coincide
   */
  private checkFrameRateMatch(): boolean {
    const req = this.report.frameRateRequested;
    const eff = this.report.frameRateEffective;
    
    if (eff === 0) return false;
    
    // Tolerancia del 15%
    return Math.abs(req - eff) / req < 0.15;
  }

  /**
   * Genera resumen de calidad
   */
  generateSummary(): void {
    let score = 0;
    const issues: string[] = [];

    // Torch
    if (this.report.torchRequested) {
      if (this.report.torchEffective) {
        score += 25;
      } else {
        issues.push('Torch no activo');
      }
    }

    // Resolución
    if (this.report.resolutionMatch) {
      score += 20;
    } else {
      issues.push('Resolución no coincide');
    }

    // Frame rate
    if (this.report.frameRateMatch) {
      score += 20;
    } else {
      issues.push('Frame rate no coincide');
    }

    // Locks
    if (this.report.exposureLocked) score += 10;
    if (this.report.whiteBalanceLocked) score += 10;
    if (this.report.focusLocked) score += 10;

    // Penalizaciones
    if (this.report.failedConstraints!.length > 0) {
      score -= this.report.failedConstraints!.length * 5;
      issues.push(`${this.report.failedConstraints!.length} constraints fallaron`);
    }

    if (this.report.ignoredConstraints!.length > 0) {
      score -= this.report.ignoredConstraints!.length * 2;
    }

    // Calidad overall
    if (score >= 80) {
      this.report.overallQuality = 'EXCELLENT';
    } else if (score >= 60) {
      this.report.overallQuality = 'GOOD';
    } else if (score >= 40) {
      this.report.overallQuality = 'ACCEPTABLE';
    } else if (score >= 20) {
      this.report.overallQuality = 'POOR';
    } else {
      this.report.overallQuality = 'CRITICAL';
    }

    this.report.summary = issues.length > 0 
      ? issues.join(', ')
      : 'Configuración óptima';
  }

  /**
   * Obtiene el reporte completo
   */
  getReport(): ConstraintReport {
    this.generateSummary();
    return this.report as ConstraintReport;
  }

  /**
   * Resetea el reporte
   */
  reset(): void {
    this.report = {
      supportedCapabilities: [],
      requestedConstraints: {},
      effectiveSettings: {},
      ignoredConstraints: [],
      failedConstraints: [],
      browserWarnings: [],
      torchRequested: false,
      torchSupported: false,
      torchEffective: false,
      frameRateRequested: 30,
      frameRateEffective: 0,
      frameRateMatch: false,
      resolutionRequested: { width: 640, height: 480 },
      resolutionEffective: { width: 0, height: 0 },
      resolutionMatch: false,
      exposureLocked: false,
      whiteBalanceLocked: false,
      focusLocked: false,
      deviceId: '',
      deviceLabel: '',
      overallQuality: 'POOR',
      summary: ''
    };
  }
}
