/**
 * CONTACT STATE MACHINE
 * 
 * Máquina de estados para contacto de dedo con histéresis robusta.
 */

export type ContactState =
  | 'NO_CONTACT'
  | 'ACQUIRING_CONTACT'
  | 'UNSTABLE_CONTACT'
  | 'STABLE_CONTACT'
  | 'SATURATED_CONTACT'
  | 'EXCESSIVE_PRESSURE';

export interface ContactStateInput {
  fingerLikelihood: number;
  coverageRatio: number;
  clipHighRatio: number;
  clipLowRatio: number;
  motionScore: number;
  pressureScore: number;
  perfusionIndex: number;
  spatialCoherence: number;
  temporalStability: number;
}

export interface ContactStateOutput {
  state: ContactState;
  confidence: number;
  reason: string;
  framesInState: number;
  canExtractSignal: boolean;
}

export class ContactStateMachine {
  private currentState: ContactState = 'NO_CONTACT';
  private framesInCurrentState = 0;
  private stateHistory: ContactState[] = [];
  private maxHistory = 300;

  // Umbrales configurables
  private readonly FINGER_CONFIRM_THRESHOLD = 0.65;
  private readonly FINGER_LOSE_THRESHOLD = 0.35;
  private readonly STABLE_FRAMES_REQUIRED = 40; // ~1.3s a 30fps
  private readonly UNSTABLE_GRACE_FRAMES = 120; // ~4s
  private readonly SATURATION_THRESHOLD = 0.25;
  private readonly PRESSURE_THRESHOLD = 0.7;

  // Histéresis
  private confidenceAccumulator = 0;
  private stableCounter = 0;
  private unstableCounter = 0;

  /**
   * Procesa un frame y actualiza el estado
   */
  process(input: ContactStateInput): ContactStateOutput {
    this.framesInCurrentState++;
    
    // Acumular confianza con histéresis
    this.confidenceAccumulator = this.confidenceAccumulator * 0.9 + input.fingerLikelihood * 0.1;

    const prevState = this.currentState;
    let newState = this.currentState;
    let reason = '';

    // Lógica de transición
    switch (this.currentState) {
      case 'NO_CONTACT':
        newState = this.handleNoContact(input);
        reason = newState === 'NO_CONTACT' ? 'Sin dedo detectado' : 'Dedo detectado';
        break;

      case 'ACQUIRING_CONTACT':
        newState = this.handleAcquiringContact(input);
        reason = 'Adquiriendo contacto';
        break;

      case 'UNSTABLE_CONTACT':
        newState = this.handleUnstableContact(input);
        reason = 'Contacto inestable';
        break;

      case 'STABLE_CONTACT':
        newState = this.handleStableContact(input);
        reason = 'Contacto estable';
        break;

      case 'SATURATED_CONTACT':
        newState = this.handleSaturatedContact(input);
        reason = 'Saturación detectada';
        break;

      case 'EXCESSIVE_PRESSURE':
        newState = this.handleExcessivePressure(input);
        reason = 'Presión excesiva';
        break;
    }

    // Transición de estado
    if (newState !== this.currentState) {
      this.transitionTo(newState);
    }

    // Guardar historial
    this.stateHistory.push(this.currentState);
    if (this.stateHistory.length > this.maxHistory) {
      this.stateHistory.shift();
    }

    return {
      state: this.currentState,
      confidence: this.confidenceAccumulator,
      reason,
      framesInState: this.framesInCurrentState,
      canExtractSignal: this.canExtractSignal()
    };
  }

  private handleNoContact(input: ContactStateInput): ContactState {
    if (this.confidenceAccumulator > this.FINGER_CONFIRM_THRESHOLD &&
        input.coverageRatio > 0.3 &&
        input.clipHighRatio < 0.3 &&
        input.motionScore < 0.8) {
      return 'ACQUIRING_CONTACT';
    }
    return 'NO_CONTACT';
  }

  private handleAcquiringContact(input: ContactStateInput): ContactState {
    this.stableCounter++;

    // Chequear condiciones problemáticas
    if (input.clipHighRatio > this.SATURATION_THRESHOLD) {
      return 'SATURATED_CONTACT';
    }
    if (input.pressureScore > this.PRESSURE_THRESHOLD) {
      return 'EXCESSIVE_PRESSURE';
    }

    // Progreso a estable
    if (this.stableCounter >= this.STABLE_FRAMES_REQUIRED &&
        this.confidenceAccumulator > 0.7 &&
        input.coverageRatio > 0.4 &&
        input.perfusionIndex > 0.003 &&
        input.spatialCoherence > 0.5) {
      this.stableCounter = 0;
      return 'STABLE_CONTACT';
    }

    // Regresar a no contacto
    if (this.confidenceAccumulator < this.FINGER_LOSE_THRESHOLD) {
      this.stableCounter = 0;
      return 'NO_CONTACT';
    }

    return 'ACQUIRING_CONTACT';
  }

  private handleUnstableContact(input: ContactStateInput): ContactState {
    this.unstableCounter++;

    // Chequear condiciones problemáticas
    if (input.clipHighRatio > this.SATURATION_THRESHOLD) {
      return 'SATURATED_CONTACT';
    }
    if (input.pressureScore > this.PRESSURE_THRESHOLD) {
      return 'EXCESSIVE_PRESSURE';
    }

    // Recuperar estabilidad
    if (this.confidenceAccumulator > 0.75 &&
        input.coverageRatio > 0.45 &&
        input.perfusionIndex > 0.005 &&
        input.motionScore < 0.5 &&
        input.temporalStability > 0.6) {
      this.unstableCounter = 0;
      return 'STABLE_CONTACT';
    }

    // Perder contacto
    if (this.confidenceAccumulator < this.FINGER_LOSE_THRESHOLD) {
      if (this.unstableCounter > this.UNSTABLE_GRACE_FRAMES) {
        this.unstableCounter = 0;
        return 'NO_CONTACT';
      }
    } else {
      this.unstableCounter = Math.max(0, this.unstableCounter - 2);
    }

    return 'UNSTABLE_CONTACT';
  }

  private handleStableContact(input: ContactStateInput): ContactState {
    // Chequear condiciones problemáticas
    if (input.clipHighRatio > this.SATURATION_THRESHOLD) {
      return 'SATURATED_CONTACT';
    }
    if (input.pressureScore > this.PRESSURE_THRESHOLD) {
      return 'EXCESSIVE_PRESSURE';
    }

    // Motion alto degrada a inestable
    if (input.motionScore > 0.8) {
      return 'UNSTABLE_CONTACT';
    }

    // Perder contacto
    if (this.confidenceAccumulator < this.FINGER_LOSE_THRESHOLD) {
      return 'UNSTABLE_CONTACT';
    }

    return 'STABLE_CONTACT';
  }

  private handleSaturatedContact(input: ContactStateInput): ContactState {
    // Recuperar si la saturación baja
    if (input.clipHighRatio < this.SATURATION_THRESHOLD * 0.7) {
      if (this.confidenceAccumulator > 0.6) {
        return 'STABLE_CONTACT';
      } else {
        return 'UNSTABLE_CONTACT';
      }
    }

    // Si sigue saturado, perder contacto
    if (this.confidenceAccumulator < this.FINGER_LOSE_THRESHOLD) {
      return 'NO_CONTACT';
    }

    return 'SATURATED_CONTACT';
  }

  private handleExcessivePressure(input: ContactStateInput): ContactState {
    // Recuperar si la presión baja
    if (input.pressureScore < this.PRESSURE_THRESHOLD * 0.7) {
      if (this.confidenceAccumulator > 0.6) {
        return 'STABLE_CONTACT';
      } else {
        return 'UNSTABLE_CONTACT';
      }
    }

    // Si sigue con presión excesiva, perder contacto
    if (this.confidenceAccumulator < this.FINGER_LOSE_THRESHOLD) {
      return 'NO_CONTACT';
    }

    return 'EXCESSIVE_PRESSURE';
  }

  private transitionTo(newState: ContactState): void {
    this.currentState = newState;
    this.framesInCurrentState = 0;
    this.stableCounter = 0;
    this.unstableCounter = 0;
  }

  /**
   * Determina si se puede extraer señal en el estado actual
   */
  canExtractSignal(): boolean {
    return this.currentState === 'STABLE_CONTACT';
  }

  /**
   * Obtiene el estado actual
   */
  getState(): ContactState {
    return this.currentState;
  }

  /**
   * Obtiene tiempo en estado actual
   */
  getFramesInState(): number {
    return this.framesInCurrentState;
  }

  /**
   * Resetea la máquina de estados
   */
  reset(): void {
    this.currentState = 'NO_CONTACT';
    this.framesInCurrentState = 0;
    this.stateHistory = [];
    this.confidenceAccumulator = 0;
    this.stableCounter = 0;
    this.unstableCounter = 0;
  }

  /**
   * Obtiene estabilidad temporal del estado
   */
  getStateStability(): number {
    if (this.stateHistory.length < 10) return 0;
    
    const recent = this.stateHistory.slice(-20);
    const stableCount = recent.filter(s => s === 'STABLE_CONTACT').length;
    return stableCount / recent.length;
  }
}
