/**
 * ESTADOS OFICIALES DE MEDICIÓN - FAIL-CLOSED ARCHITECTURE
 * 
 * Estos estados representan el estado actual de la medición PPG
 * de manera explícita y sin ambigüedad.
 * 
 * La UI debe mostrar estos estados claramente al usuario.
 * La transición entre estados debe ser inmediata y basada en evidencia.
 */

export enum MeasurementState {
  /**
   * No hay cámara activa o no se ha iniciado la medición
   */
  IDLE = 'IDLE',
  
  /**
   * Cámara activa pero sin contacto con tejido
   */
  NO_CONTACT = 'NO_CONTACT',
  
  /**
   * Contacto detectado pero señal insuficiente o inválida
   */
  INSUFFICIENT_SIGNAL = 'INSUFFICIENT_SIGNAL',
  
  /**
   * Contacto estable pero sin evidencia PPG viva
   * (puede ser material estático, fondo, etc.)
   */
  NO_PPG_EVIDENCE = 'NO_PPG_EVIDENCE',
  
  /**
   * Evidencia PPG débil o probable, pero no suficiente
   * para mediciones clínicas
   */
  WEAK_EVIDENCE = 'WEAK_EVIDENCE',
  
  /**
   * Evidencia PPG probable, acercándose a umbral
   */
  PROBABLE_PPG = 'PROBABLE_PPG',
  
  /**
   * Evidencia PPG viva confirmada, listo para medir
   */
  VALID_LIVE_PPG = 'VALID_LIVE_PPG',
  
  /**
   * Calibración en progreso (requerida para ciertos signos)
   */
  CALIBRATING = 'CALIBRATING',
  
  /**
   * Medición activa con evidencia PPG válida
   */
  MEASURING = 'MEASURING',
  
  /**
   * Pérdida de contacto durante medición
   */
  CONTACT_LOST = 'CONTACT_LOST',
  
  /**
   * Pérdida de evidencia PPG durante medición
   */
  EVIDENCE_LOST = 'EVIDENCE_LOST',
  
  /**
   * Medición completada con resultado válido
   */
  COMPLETED = 'COMPLETED',
  
  /**
   * Error en el sistema
   */
  ERROR = 'ERROR'
}

export interface MeasurementStateInfo {
  state: MeasurementState;
  message: string;
  actionRequired: boolean;
  canMeasure: boolean;
  displayColor: 'green' | 'yellow' | 'red' | 'gray';
}

export function getMeasurementStateInfo(state: MeasurementState): MeasurementStateInfo {
  const stateMap: Record<MeasurementState, MeasurementStateInfo> = {
    [MeasurementState.IDLE]: {
      state: MeasurementState.IDLE,
      message: 'Inicie la medición',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'gray'
    },
    [MeasurementState.NO_CONTACT]: {
      state: MeasurementState.NO_CONTACT,
      message: 'Coloque el dedo en la cámara',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'red'
    },
    [MeasurementState.INSUFFICIENT_SIGNAL]: {
      state: MeasurementState.INSUFFICIENT_SIGNAL,
      message: 'Señal insuficiente - ajuste posición',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'red'
    },
    [MeasurementState.NO_PPG_EVIDENCE]: {
      state: MeasurementState.NO_PPG_EVIDENCE,
      message: 'Sin evidencia PPG - verifique contacto',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'red'
    },
    [MeasurementState.WEAK_EVIDENCE]: {
      state: MeasurementState.WEAK_EVIDENCE,
      message: 'Evidencia débil - mantenga posición',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'yellow'
    },
    [MeasurementState.PROBABLE_PPG]: {
      state: MeasurementState.PROBABLE_PPG,
      message: 'PPG probable - estabilice',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'yellow'
    },
    [MeasurementState.VALID_LIVE_PPG]: {
      state: MeasurementState.VALID_LIVE_PPG,
      message: 'PPG válido - listo para medir',
      actionRequired: false,
      canMeasure: true,
      displayColor: 'green'
    },
    [MeasurementState.CALIBRATING]: {
      state: MeasurementState.CALIBRATING,
      message: 'Calibrando...',
      actionRequired: false,
      canMeasure: false,
      displayColor: 'yellow'
    },
    [MeasurementState.MEASURING]: {
      state: MeasurementState.MEASURING,
      message: 'Midiendo...',
      actionRequired: false,
      canMeasure: true,
      displayColor: 'green'
    },
    [MeasurementState.CONTACT_LOST]: {
      state: MeasurementState.CONTACT_LOST,
      message: 'Contacto perdido - reanude',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'red'
    },
    [MeasurementState.EVIDENCE_LOST]: {
      state: MeasurementState.EVIDENCE_LOST,
      message: 'Evidencia perdida - reanude',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'red'
    },
    [MeasurementState.COMPLETED]: {
      state: MeasurementState.COMPLETED,
      message: 'Medición completada',
      actionRequired: false,
      canMeasure: false,
      displayColor: 'green'
    },
    [MeasurementState.ERROR]: {
      state: MeasurementState.ERROR,
      message: 'Error del sistema',
      actionRequired: true,
      canMeasure: false,
      displayColor: 'red'
    }
  };
  
  return stateMap[state];
}

export function mapEvidenceTierToMeasurementState(
  tier: 'INVALID' | 'WEAK' | 'PROBABLE_PPG' | 'VALID_LIVE_PPG',
  isMonitoring: boolean,
  hasContact: boolean
): MeasurementState {
  if (!hasContact) return MeasurementState.NO_CONTACT;
  
  if (tier === 'INVALID') return MeasurementState.NO_PPG_EVIDENCE;
  if (tier === 'WEAK') return MeasurementState.WEAK_EVIDENCE;
  if (tier === 'PROBABLE_PPG') return MeasurementState.PROBABLE_PPG;
  if (tier === 'VALID_LIVE_PPG') {
    return isMonitoring ? MeasurementState.MEASURING : MeasurementState.VALID_LIVE_PPG;
  }
  
  return MeasurementState.ERROR;
}
