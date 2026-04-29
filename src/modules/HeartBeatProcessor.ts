/**
 * HEARTBEAT PROCESSOR V2 — LAYERED ARCHITECTURE
 * 
 * USO FORENSE: Todos los parámetros algorítmicos están centralizados
 * en src/constants/processing.ts para trazabilidad y validación.
 * 
 * Referencias:
 * - Elgendi 2013: PPG peak detection (NeuroKit2/PPG-BEATS/pyPPG)
 * - Pan & Tompkins 1985: QRS detection (IEEE TBME)
 * - Adaptaciones para PPG: 300ms refractario (vs 200ms ECG)
 */
import { RingBuffer } from './signal-processing/RingBuffer';
import { estimateHrNarrowbank } from './signal-processing/SpectralHrEstimator';
import { BeatQualityAssessor } from './signal-processing/BeatQualityAssessor';
import { ElgendiPeakDetector } from './signal-processing/ElgendiPeakDetector';
import type {
  BeatCandidate, AcceptedBeat, BeatFlags, BPMHypothesis,
  HeartBeatResult, HeartBeatDebug
} from '../types/beat';
import {
  // Buffers
  PPG_BUFFER_SIZE,
  DERIVATIVE_BUFFER_SIZE,
  SLOPE_SUM_BUFFER_SIZE,
  TIMESTAMP_BUFFER_SIZE,
  TEMPLATE_SIZE,
  TEMPLATE_WINDOW,
  MAX_RR_INTERVALS,
  MAX_ACCEPTED_BEATS,
  MIN_FRAMES_FOR_PROCESSING,
  // Sampling
  DEFAULT_SAMPLE_RATE,
  OVERSAMPLE_FACTOR,
  // Thresholds
  PEAK_THRESHOLD_INITIAL,
  MIN_SIGNAL_RANGE,
  // Detection
  DET1_PROMINENCE_THRESHOLD,
  DET1_RISING_SLOPE_THRESHOLD,
  DET2_RISING_SLOPE_THRESHOLD,
  DET2_SSF_THRESHOLD,
  // Periodicity
  MIN_RR_MS,
  MAX_RR_MS,
  SEARCH_BACK_FACTOR,
  SEARCH_BACK_THRESHOLD_FACTOR,
  ELGENDI_SYNTHESIS_MIN_TIME,
  ELGENDI_SYNTHESIS_MIN_FACTOR,
  ELGENDI_SYNTHESIS_MAX_FACTOR,
  TEMPLATE_SCORE_THRESHOLD,
  ELGENDI_CORROBORATION_MS,
  ELGENDI_CORROBORATION_SCORE,
  ELGENDI_SYNTHESIS_PROMINENCE_BASE,
  ELGENDI_SYNTHESIS_PROMINENCE_FACTOR,
  ELGENDI_SYNTHESIS_WIDTH_MS,
  ELGENDI_SYNTHESIS_RISING_SLOPE_MIN,
  ELGENDI_SYNTHESIS_FALLING_SLOPE,
  ELGENDI_SYNTHESIS_BAND_POWER_DIVISOR,
  // IBI and timing
  DEFAULT_IBI_MS,
  // Source switch
  SOURCE_SWITCH_PENALTY,
  SOURCE_SWITCH_NORMAL,
  // SQI thresholds
  BEAT_SQI_UPDATE_THRESHOLD,
  // Missed beat
  MISSED_BEAT_FACTOR_MIN,
  MISSED_BEAT_FACTOR_MAX,
  MAX_MISSED_BEAT_RR,
  // Scoring
  PROMINENCE_SCORE_MAX,
  PROMINENCE_SCORE_DIVISOR,
  SLOPE_SCORE_MAX,
  RISING_SLOPE_DIVISOR,
  FALLING_SLOPE_DIVISOR,
  WIDTH_SCORE_OPTIMAL,
  WIDTH_SCORE_ACCEPTABLE,
  WIDTH_OPTIMAL_MIN_MS,
  WIDTH_OPTIMAL_MAX_MS,
  WIDTH_ACCEPTABLE_MIN_MS,
  WIDTH_ACCEPTABLE_MAX_MS,
  ASYMMETRY_SCORE,
  ASYMMETRY_RATIO_MIN,
  ASYMMETRY_RATIO_MAX,
  RHYTHM_SCORE_NEAR,
  RHYTHM_SCORE_AUTOCORR,
  RHYTHM_SCORE_CONSECUTIVE,
  RHYTHM_MIN_CONSECUTIVE_PEAKS,
  MORPHOLOGY_WEIGHT,
  RHYTHM_WEIGHT,
  DETECTOR_AGREEMENT_WEIGHT,
  TEMPLATE_CORRELATION_WEIGHT,
  CONTACT_STABLE_BONUS,
  FAST_PATH_MIN_SCORE,
  MIDDLE_PATH_MIN_SCORE_INITIAL,
  MIDDLE_PATH_MIN_SCORE_ESTABLISHED,
  HIGH_SCORE_MIN,
  ELGENDI_SYNTHESIS_MORPHOLOGY,
  ELGENDI_SYNTHESIS_RHYTHM,
  ELGENDI_SYNTHESIS_TOTAL,
  ELGENDI_SYNTHESIS_DETECTOR_AGREEMENT,
  // Adjudication
  MIN_PROMINENCE,
  WIDTH_REJECT_MIN_MS,
  WIDTH_REJECT_MAX_MS,
  CLIP_PENALTY_REJECT_THRESHOLD,
  MIN_RISING_SLOPE,
  MIN_FALLING_SLOPE,
  SOFT_REFRACTORY_MIN_MORPHOLOGY,
  SOFT_REFRACTORY_MIN_AGREEMENT,
  THRESHOLD_FACTOR_PERIODIC,
  THRESHOLD_FACTOR_NON_PERIODIC,
  PROMINENCE_THRESHOLD_MIN,
  PROMINENCE_THRESHOLD_FACTOR,
  TEMPLATE_CORR_MIDDLE_PATH,
  MORPHOLOGY_SCORE_MIDDLE_ALT,
  // Amplitude
  AMPLITUDE_RATIO_MIN,
  AMPLITUDE_RATIO_MAX,
  // Refractory
  PT_REFRACTORY_MS,
  SOFT_REFRACTORY_FACTOR,
  SOFT_REFRACTORY_DEFAULT_MS,
  // Confidence
  PEAK_DOMAIN_MIN_PEAKS,
  PEAK_DOMAIN_MIN_SQI,
  PEAK_DOMAIN_BASE_CONF,
  PEAK_DOMAIN_CONF_PER_PEAK,
  PEAK_DOMAIN_CONF_PER_SQI,
  PEAK_AUTOCRR_FUSION_WEIGHT,
  AUTOCRR_PEAK_FUSION_WEIGHT,
  AUTOCRR_BASE_CONF,
  AUTOCRR_CONF_PER_PEAK,
  AUTOCRR_MAX_CONF,
  MEDIAN_BASE_CONF,
  MEDIAN_CONF_PER_PEAK,
  MEDIAN_MAX_CONF,
  SPECTRAL_CONFIDENCE_MIN,
  SPECTRAL_CONFIDENCE_MIN_FUSE,
  SPECTRAL_CONFIDENCE_HIGH,
  AGREEMENT_MIN_BPM,
  TEMP_SPEC_AGREEMENT_LOW,
  TEMP_SPEC_AGREEMENT_HIGH,
  TEMP_SPEC_LOW_BPM_WEIGHT,
  TEMP_SPEC_LOW_SPEC_WEIGHT,
  TEMP_SPEC_HIGH_BPM_WEIGHT,
  TEMP_SPEC_HIGH_SPEC_WEIGHT,
  TEMP_SPEC_AGREEMENT_DEFAULT,
  TEMP_SPEC_WITH_AUTOCRR,
  PEAK_AUTOCRR_MAX_DIFF,
  PEAK_AUTOCRR_FUSION_PEAK_WEIGHT,
  PEAK_AUTOCRR_FUSION_AUTO_WEIGHT,
  AUTOCRR_MEDIAN_FUSION_WEIGHT,
  // EMA
  EMA_AGREEMENT_LOW,
  EMA_DIFF_HIGH,
  EMA_DIFF_MED,
  TEMPLATE_EMA_ALPHA,
  EMA_DIFF_THRESHOLD_SLOW,
  EMA_ALPHA_SLOW,
  EMA_DIFF_THRESHOLD_MED,
  EMA_ALPHA_MED,
  EMA_ALPHA_FAST,
  // Evidence
  INVALID_EVIDENCE_HARD_RESET,
  WINDOW_SQI_UPSTREAM_DEFAULT,
  PHASE_ALIGN_DEFAULT,
  SPECTRAL_AGG_DEFAULT,
  MOTION_PENALTY,
  CLIP_PENALTY_FACTOR,
  HIGH_PRESSURE_PENALTY,
  LOW_PRESSURE_PENALTY,
  UPSTREAM_SQI_DEFAULT,
  // Forensic evidence
  MIN_ACCEPTED_BEATS_EVIDENCE,
  MIN_CONSECUTIVE_PEAKS_EVIDENCE,
  MIN_AVG_BEAT_SQI_EVIDENCE,
  MIN_RR_INTERVALS_EVIDENCE,
  MIN_SIGNAL_BUFFER_EVIDENCE,
  // Factors
  WINDOW_SQI_MIN,
  PHASE_ALIGN_MIN,
  SPECTRAL_AGG_MIN,
  UPSTREAM_FACTOR_EXPONENT,
  DETECTOR_DISAGREEMENT_PENALTY,
  DETECTOR_DISAGREEMENT_THRESHOLD,
  BPM_CONFIDENCE_BASE,
  BPM_CONFIDENCE_UPSTREAM_FACTOR,
  // Validation
  TEMPLATE_MIN_RANGE,
  CORR_MIN_RANGE,
  // Utils
  clamp,
  bpmToRrMs,
} from '@/constants/processing';

export class HeartBeatProcessor {
  private signalBuf = new RingBuffer(PPG_BUFFER_SIZE);
  private derivBuf = new RingBuffer(DERIVATIVE_BUFFER_SIZE);
  private slopeSum = new RingBuffer(SLOPE_SUM_BUFFER_SIZE);
  private timestampBuf = new RingBuffer(TIMESTAMP_BUFFER_SIZE);

  private rrIntervals: number[] = [];
  private readonly MAX_RR = MAX_RR_INTERVALS;
  private acceptedBeats: AcceptedBeat[] = [];
  private readonly MAX_ACCEPTED = MAX_ACCEPTED_BEATS;

  private templateBuf: Float64Array = new Float64Array(TEMPLATE_SIZE);
  private templateLen = 0;
  private templateValid = false;
  // Usa constante TEMPLATE_WINDOW importada de processing.ts

  private smoothBPM = 0;
  private spectralBPM = 0;
  private spectralConfidence = 0;
  private spectralPeakRatio = 0;
  private autocorrBPM = 0;
  private medianRRBPM = 0;
  private lastHypothesis: BPMHypothesis | null = null;
  private temporalSpectralAgreement = 0;
  private windowSQIUpstream = WINDOW_SQI_UPSTREAM_DEFAULT;
  
  // FAIL-CLOSED: Evidencia PPG obligatoria para publicar BPM
  private livePpgEvidencePassed = false;
  private lastContactState = '';
  // Streak de frames sin evidencia viva: tras cierto umbral, hard-reset
  // del estado interno (latidos acumulados, RR, smoothBPM). Evita que la
  // app siga "midiendo" tras retirar el dedo.
  private invalidEvidenceStreak = 0;
  private readonly INVALID_EVIDENCE_HARD_RESET = 30;

  private lastPeakTime = 0;
  private lastPeakValue = 0;
  private consecutivePeaks = 0;
  private frameCount = 0;
  private peakThreshold = PEAK_THRESHOLD_INITIAL;
  // Elgendi 2013 — detector estado del arte para PPG, validado por
  // NeuroKit2/PPG-BEATS/pyPPG. Corre en paralelo con el detector
  // dual-criterio interno; cuando Elgendi confirma un pico, lo aceptamos
  // de inmediato (sensibilidad ~99.9% en bases de datos clínicas).
  private elgendi = new ElgendiPeakDetector({ sampleRate: DEFAULT_SAMPLE_RATE });
  private lastElgendiPeakTs = 0;
  // Pan-Tompkins adaptado para PPG (Pan & Tompkins 1985, IEEE TBME):
  //   SignalLevel = 0.125·PEAK + 0.875·SignalLevel
  //   NoiseLevel  = 0.125·NOISE + 0.875·NoiseLevel
  //   Threshold   = NoiseLevel + 0.25·(SignalLevel − NoiseLevel)
  // Refractory PPG: 300 ms (2× más que ECG por morfología más lenta).
  private ptSignalLevel = 0;
  private ptNoiseLevel = 0;
  private readonly PT_REFRACTORY_MS = 300;

  private beatsAccepted = 0;
  private beatsRejected = 0;
  private doublePeakCount = 0;
  private missedBeatCount = 0;
  private suspiciousCount = 0;
  private lastRejectionReason = '';

  private upstreamSQI = UPSTREAM_SQI_DEFAULT;
  private motionPenalty = 0;
  private clipPenalty = 0;
  private pressurePenalty = 0;
  private contactStable = true;
  private sourceSwitchRecent = false;

  constructor() {
    // FAIL-CLOSED: Constructor puro, sin efectos secundarios (audio, vibración)
  }

  processSignal(
    filteredValue: number,
    timestamp?: number,
    upstreamContext?: {
      rawValue?: number;
      quality?: number;
      contactState?: string;
      motionArtifact?: boolean;
      pressureState?: string;
      clipHigh?: number;
      clipLow?: number;
      activeSource?: string;
      perfusionIndex?: number;
      positionDrifting?: boolean;
      windowSQI?: number;
      fingerMeasurementState?: string;
      effectiveSampleRate?: number;
      phaseAlignmentQuality?: number;
      spectralQualityAggregate?: number;
      livePpgEvidencePassed?: boolean;
    }
  ): HeartBeatResult {
    this.frameCount++;
    const now = timestamp ?? performance.now();

    let phaseAlign = PHASE_ALIGN_DEFAULT;
    let spectralAgg = SPECTRAL_AGG_DEFAULT;
    if (upstreamContext) {
      this.upstreamSQI = upstreamContext.quality ?? UPSTREAM_SQI_DEFAULT;
      if (typeof upstreamContext.phaseAlignmentQuality === 'number') {
        phaseAlign = Math.max(0, Math.min(1, upstreamContext.phaseAlignmentQuality));
      }
      if (typeof upstreamContext.spectralQualityAggregate === 'number') {
        spectralAgg = Math.max(0, Math.min(1, upstreamContext.spectralQualityAggregate));
      }
      this.motionPenalty = upstreamContext.motionArtifact ? MOTION_PENALTY : 0;
      this.clipPenalty = Math.min(1, (upstreamContext.clipHigh ?? 0) + (upstreamContext.clipLow ?? 0)) * CLIP_PENALTY_FACTOR;
      this.pressurePenalty = upstreamContext.pressureState === 'HIGH_PRESSURE' ? HIGH_PRESSURE_PENALTY :
        upstreamContext.pressureState === 'LOW_PRESSURE' ? LOW_PRESSURE_PENALTY : 0;
      this.contactStable = upstreamContext.contactState === 'STABLE_CONTACT';
      this.sourceSwitchRecent = false;
      if (typeof upstreamContext.windowSQI === 'number') {
        this.windowSQIUpstream = Math.max(0, Math.min(1, upstreamContext.windowSQI));
      }
      // (fingerMeasurementState ya no se almacena: el HBP no lo consume
      // internamente; el contexto va directo al gate externo.)
      
      // FAIL-CLOSED: Rastrear evidencia PPG
      if (typeof upstreamContext.livePpgEvidencePassed === 'boolean') {
        const prev = this.livePpgEvidencePassed;
        this.livePpgEvidencePassed = upstreamContext.livePpgEvidencePassed;
        if (this.livePpgEvidencePassed) {
          this.invalidEvidenceStreak = 0;
        } else {
          this.invalidEvidenceStreak++;
          // Tras INVALID_EVIDENCE_HARD_RESET frames sin evidencia (~1 s a 30 fps),
          // resetear todo el estado interno. Esto garantiza que retirar el dedo
          // ⇒ inmediatamente se borran latidos y BPM, no se "arrastran".
          if (this.invalidEvidenceStreak >= this.INVALID_EVIDENCE_HARD_RESET) {
            this.hardReset();
            this.invalidEvidenceStreak = 0;
          } else if (prev && !this.livePpgEvidencePassed) {
            // Borrar latidos antiguos sin tocar buffers de señal: BPM cae
            // a 0 inmediatamente, pero la onda sigue computándose para
            // que el operador vea qué entra a la cámara.
            this.acceptedBeats = [];
            this.consecutivePeaks = 0;
            this.smoothBPM = 0;
            this.medianRRBPM = 0;
            this.autocorrBPM = 0;
            this.rrIntervals = [];
          }
        }
      }
      
      // FAIL-CLOSED: Hard reset si contactState cambia a inválido
      const currentState = upstreamContext.contactState ?? '';
      if (this.lastContactState && currentState !== this.lastContactState) {
        if (currentState === 'NO_CONTACT' || currentState === 'INSUFFICIENT_SIGNAL' || 
            currentState === 'INVALID' || currentState === 'MATERIAL_SIGNAL' || 
            currentState === 'CAMERA_NOISE') {
          this.hardReset();
        }
      }
      this.lastContactState = currentState;
    }

    this.signalBuf.push(filteredValue);
    this.timestampBuf.push(now);

    const deriv = this.computeDerivative();
    this.derivBuf.push(deriv);

    const ssf = this.computeSlopeSum();
    this.slopeSum.push(ssf);

    if (this.signalBuf.length < MIN_FRAMES_FOR_PROCESSING) {
      return this.makeEmptyResult(0);
    }

    // Tolerar señales muy débiles: range ≥ MIN_SIGNAL_RANGE. Esto cubre
    // perfusión ultra-baja (sujetos hipotérmicos / posibles fallecidos).
    const range = this.getSignalRange(60);
    if (range < MIN_SIGNAL_RANGE) {
      return this.makeEmptyResult(0);
    }

    const { normalizedValue, normRange } = this.normalizeSignal(filteredValue);

    // Sample rate efectivo para todos los detectores que dependen de él.
    const effectiveSr = this.estimateSampleRate();
    this.elgendi.setSampleRate(effectiveSr);

    // Elgendi 2013 — detector primario PPG (estado del arte clínico).
    // Recibe la señal NORMALIZADA (±60) que ya está limpia y centrada.
    const elgendiResult = this.elgendi.process(normalizedValue, now);
    const elgendiHit = elgendiResult.isPeak;
    if (elgendiHit) this.lastElgendiPeakTs = elgendiResult.peakTime;

    if (this.frameCount % OVERSAMPLE_FACTOR === 0) this.updateSpectralHr();
    this.updateThreshold(normRange);

    const timeSinceLastPeak = this.lastPeakTime > 0 ? now - this.lastPeakTime : 1e9;
    const expectedRR = this.getExpectedRR();
    const refractoryState = this.getRefractoryState(timeSinceLastPeak, expectedRR);

    let candidate: BeatCandidate | null = null;
    if (refractoryState !== 'hard') {
      candidate = this.detectCandidate(now, timeSinceLastPeak, expectedRR, normRange);
    }

    // Pan-Tompkins SEARCH-BACK (validado IEEE TBME 1985):
    // Si han pasado 166% del RR promedio sin detectar pico, hacemos una
    // búsqueda hacia atrás con threshold reducido a 50%. Esto recupera
    // latidos débiles que el threshold normal pasó por alto, sin riesgo
    // (estamos buscando un pico que físicamente DEBERÍA estar ahí por
    // periodicidad cardíaca).
    if (
      !candidate &&
      refractoryState !== 'hard' &&
      expectedRR > 0 &&
      timeSinceLastPeak > expectedRR * SEARCH_BACK_FACTOR
    ) {
      const savedThreshold = this.peakThreshold;
      this.peakThreshold = savedThreshold * SEARCH_BACK_THRESHOLD_FACTOR;
      const sbCandidate = this.detectCandidate(now, timeSinceLastPeak, expectedRR, normRange);
      this.peakThreshold = savedThreshold;
      if (sbCandidate) {
        candidate = sbCandidate;
      }
    }

    let isPeak = false;
    let currentBeatSQI = 0;
    let currentFlags: BeatFlags | null = null;
    let rejectionReason = '';

    // Elgendi synthesization: SOLO cuando hay evidencia PPG viva confirmada
    // y contexto de ritmo establecido. Evita falsos positivos cuando Elgendi
    // detecta ruido como pico.
    const canSynthesizeElgendi =
      elgendiHit &&
      !candidate &&
      refractoryState !== 'hard' &&
      timeSinceLastPeak >= ELGENDI_SYNTHESIS_MIN_TIME &&
      this.livePpgEvidencePassed && // REQUERIR: evidencia PPG viva
      this.acceptedBeats.length >= 1 && // REQUERIR: al menos un latido previo
      expectedRR > 0 && // REQUERIR: contexto de ritmo conocido
      timeSinceLastPeak >= expectedRR * ELGENDI_SYNTHESIS_MIN_FACTOR &&
      timeSinceLastPeak <= expectedRR * ELGENDI_SYNTHESIS_MAX_FACTOR; // Rango más estricto que antes

    if (canSynthesizeElgendi) {
      // Verificación adicional: el valor debe estar cerca del valor esperado del template
      const templateScore = this.templateValid ? this.correlateWithTemplate() : 0;
      const nearTemplate = !this.templateValid || templateScore >= TEMPLATE_SCORE_THRESHOLD;

      if (nearTemplate) {
        candidate = {
          timestamp: now,
          sampleIndex: this.frameCount,
          amplitude: normalizedValue,
          prominence: Math.max(ELGENDI_SYNTHESIS_PROMINENCE_BASE, range * ELGENDI_SYNTHESIS_PROMINENCE_FACTOR),
          widthMs: ELGENDI_SYNTHESIS_WIDTH_MS,
          upSlope: Math.max(ELGENDI_SYNTHESIS_RISING_SLOPE_MIN, deriv),
          downSlope: ELGENDI_SYNTHESIS_FALLING_SLOPE,
          localBaseline: 0,
          detectorHits: 1,
          detectorAgreement: ELGENDI_SYNTHESIS_DETECTOR_AGREEMENT, // Solo Elgendi, no el dual
          zeroCrossingSupport: false,
          periodicitySupport: true, // Ya verificado arriba
          templateCorrelation: templateScore,
          localBandPowerRatio: clamp(normRange / ELGENDI_SYNTHESIS_BAND_POWER_DIVISOR, 0, 1),
          localPerfusion: 0,
          localMotionPenalty: this.motionPenalty,
          localPressurePenalty: this.pressurePenalty,
          localClipPenalty: this.clipPenalty,
          status: 'accepted',
          rejectionReason: '',
          morphologyScore: ELGENDI_SYNTHESIS_MORPHOLOGY, // Ligeramente menor que latido dual-detectado
          rhythmScore: ELGENDI_SYNTHESIS_RHYTHM,
          totalScore: ELGENDI_SYNTHESIS_TOTAL, // Justo por encima del umbral mínimo
        };
      }
    }

    if (candidate) {
      // Si Elgendi también confirmó este pico (dentro de ±150 ms), forzar
      // aceptación: dos detectores ortogonales coinciden, es prácticamente
      // imposible que sea un falso positivo.
      const elgendiCorroborates = elgendiHit && Math.abs(elgendiResult.peakTime - now) <= ELGENDI_CORROBORATION_MS;
      if (elgendiCorroborates) {
        candidate.status = 'accepted';
        candidate.detectorAgreement = Math.max(candidate.detectorAgreement, 1.0);
        candidate.totalScore = Math.max(candidate.totalScore, ELGENDI_CORROBORATION_SCORE);
      } else {
        this.adjudicate(candidate, timeSinceLastPeak, expectedRR, refractoryState);
      }

      if (candidate.status === 'accepted') {
        isPeak = true;
        // Pan-Tompkins: actualizar SignalLevel cada vez que se acepta un pico.
        this.updatePTSignalLevel(candidate.amplitude);

        if (this.lastPeakTime > 0 && timeSinceLastPeak >= MIN_RR_MS && timeSinceLastPeak <= MAX_RR_MS) {
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.MAX_RR) this.rrIntervals.shift();

          const instantBPM = 60000 / timeSinceLastPeak;
          if (expectedRR > 0 && timeSinceLastPeak > expectedRR * MISSED_BEAT_FACTOR_MIN) {
            this.handleMissedBeat(timeSinceLastPeak, expectedRR, now);
          }
          this.updateSmoothBPM(instantBPM);
          this.consecutivePeaks++;
        }

        this.lastPeakTime = now;
        this.lastPeakValue = candidate.amplitude;

        currentBeatSQI = this.computeBeatSQI(candidate, this.lastPeakTime > 0 ? timeSinceLastPeak : DEFAULT_IBI_MS);
        currentFlags = this.computeFlags(candidate, timeSinceLastPeak, expectedRR);

        const accepted: AcceptedBeat = {
          timestamp: now,
          ibiMs: timeSinceLastPeak,
          instantBpm: timeSinceLastPeak > 0 ? 60000 / timeSinceLastPeak : 0,
          beatSQI: currentBeatSQI,
          morphologyScore: candidate.morphologyScore,
          rhythmScore: candidate.rhythmScore,
          detectorAgreementScore: candidate.detectorAgreement,
          templateScore: candidate.templateCorrelation,
          sourceConsistencyScore: this.sourceSwitchRecent ? SOURCE_SWITCH_PENALTY : SOURCE_SWITCH_NORMAL,
          flags: currentFlags,
        };

        this.acceptedBeats.push(accepted);
        if (this.acceptedBeats.length > this.MAX_ACCEPTED) this.acceptedBeats.shift();
        this.beatsAccepted++;

        if (currentBeatSQI > BEAT_SQI_UPDATE_THRESHOLD) {
          this.updateTemplate();
        }

        // FAIL-CLOSED: Vibración/beep movidos a capa de presentación
        // Solo se ejecutan si LIVE_PPG_VALIDATED === true
      } else {
        rejectionReason = candidate.rejectionReason;
        this.lastRejectionReason = rejectionReason;
        this.beatsRejected++;
        // Pan-Tompkins: actualizar NoiseLevel cuando se rechaza un candidato.
        // Esto permite que el threshold se adapte a la amplitud del ruido
        // de fondo automáticamente.
        this.updatePTNoiseLevel(candidate.amplitude);
      }
    }

    if (!isPeak && this.lastPeakTime > 0 && timeSinceLastPeak > MAX_RR_MS) {
      this.consecutivePeaks = Math.max(0, this.consecutivePeaks - 1);
    }

    const hypothesis = this.fuseBPM();
    this.lastHypothesis = hypothesis;
    // Confianza con UNA sola atenuación combinada (antes 5 multiplicaciones
    // en cadena la dejaban en ~0.18 incluso con buena señal). Ahora la
    // confianza interna del fuseBPM se modula por un único factor de
    // calidad upstream que es la media geométrica de los componentes.
    let bpmConfidence = this.computeBPMConfidence(hypothesis);
    const upstreamFactor = Math.pow(
      Math.max(WINDOW_SQI_MIN, this.windowSQIUpstream) *
        Math.max(PHASE_ALIGN_MIN, phaseAlign) *
        Math.max(SPECTRAL_AGG_MIN, spectralAgg),
      UPSTREAM_FACTOR_EXPONENT
    );
    bpmConfidence *= BPM_CONFIDENCE_BASE + BPM_CONFIDENCE_UPSTREAM_FACTOR * upstreamFactor;
    if (this.temporalSpectralAgreement < DETECTOR_DISAGREEMENT_THRESHOLD && this.spectralBPM > 0 && this.medianRRBPM > 0) {
      // Solo penaliza si los detectores discrepan significativamente, y
      // de forma menos agresiva que antes.
      bpmConfidence *= DETECTOR_DISAGREEMENT_PENALTY;
    }
    const globalSQI = this.computeGlobalSQI();
    
    // Verificaciones mínimas: aplicación forense, sujetos posiblemente con
    // perfusión muy baja. Pero SIEMPRE se requiere evidencia PPG viva
    // confirmada por el gate externo (cromaticidad de hemoglobina,
    // pulsatilidad medible, coherencia multicanal). Sin ella, no hay BPM.
    const meetsMinimumEvidence =
      this.livePpgEvidencePassed &&
      this.beatsAccepted >= MIN_ACCEPTED_BEATS_EVIDENCE &&
      this.consecutivePeaks >= MIN_CONSECUTIVE_PEAKS_EVIDENCE &&
      this.getAvgBeatSQI() >= MIN_AVG_BEAT_SQI_EVIDENCE &&
      this.rrIntervals.length >= MIN_RR_INTERVALS_EVIDENCE &&
      this.signalBuf.length >= MIN_SIGNAL_BUFFER_EVIDENCE; // ~2 segundos a 30 fps

    if (!meetsMinimumEvidence) {
      hypothesis.finalBpm = 0;
      hypothesis.confidence = 0;
      bpmConfidence = 0;
    }

    const debug: HeartBeatDebug = {
      instantBpm: isPeak && timeSinceLastPeak > 0 ? 60000 / timeSinceLastPeak : 0,
      medianRRBpm: this.medianRRBPM,
      autocorrBpm: this.autocorrBPM,
      spectralBpm: this.spectralBPM,
      lastBeatSQI: currentBeatSQI,
      detectorAgreement: candidate?.detectorAgreement ?? 0,
      expectedRR,
      refractoryState,
      beatsAccepted: this.beatsAccepted,
      beatsRejected: this.beatsRejected,
      lastRejectionReason: this.lastRejectionReason,
      doublePeakCount: this.doublePeakCount,
      missedBeatCount: this.missedBeatCount,
      suspiciousCount: this.suspiciousCount,
      templateCorrelation: candidate?.templateCorrelation ?? 0,
      morphologyScore: candidate?.morphologyScore ?? 0,
      consecutivePeaks: this.consecutivePeaks,
      recentAcceptedBeats: this.acceptedBeats.slice(-12).map((beat) => ({
        ibiMs: beat.ibiMs,
        beatSQI: beat.beatSQI,
        morphologyScore: beat.morphologyScore,
        detectorAgreement: beat.detectorAgreementScore,
        amplitude: undefined,
        flags: beat.flags,
      })),
      temporalSpectralAgreement: this.temporalSpectralAgreement,
      spectralConfidence: this.spectralConfidence,
    };

    return {
      bpm: hypothesis.finalBpm,
      bpmConfidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0,
      sqi: globalSQI,
      beatSQI: currentBeatSQI,
      rrData: {
        intervals: this.rrIntervals.slice(-10),
        lastPeakTime: this.lastPeakTime || null,
      },
      hypothesis,
      detectorAgreement: candidate?.detectorAgreement ?? 0,
      rejectionReason,
      beatFlags: currentFlags,
      debug,
    };
  }

  private detectCandidate(now: number, timeSinceLast: number, expectedRR: number, normRange: number): BeatCandidate | null {
    const n = this.signalBuf.length;
    const dn = this.derivBuf.length;
    if (n < 15 || dn < 8) return null;

    const windowLen = this.consecutivePeaks < 4 ? 90 : 150;
    const normalized = this.normalizeWindow(11, windowLen);
    const ci = 5;
    const center = normalized[ci];

    const isLocalMax =
      center >= normalized[ci - 1] && center > normalized[ci + 1] &&
      center >= normalized[ci - 2] && center >= normalized[ci + 2];

    const neighborhoodMin = Math.min(...normalized);
    const prominence = center - neighborhoodMin;
    const risingSlope = center - normalized[ci - 3];
    const fallingSlope = center - normalized[ci + 3];

    const halfProm = neighborhoodMin + prominence / 2;
    let widthSamples = 0;
    for (let i = 0; i < normalized.length; i++) {
      if (normalized[i] >= halfProm) widthSamples++;
    }
    const widthMs = (widthSamples / Math.max(1, this.estimateSampleRate())) * 1000;

    // Umbrales mínimos relajados para señales muy débiles (perfusión < 1%,
    // sujeto hipotérmico, contacto sub-óptimo). El gate externo y el
    // detector espectral filtran falsos positivos a posteriori.
    const det1Hit = isLocalMax && prominence > 0.6 && risingSlope > 0.20;

    const d = new Float64Array(8);
    for (let i = 0; i < 8; i++) d[i] = this.derivBuf.get(dn - 8 + i);

    const zeroCrossing =
      (d[4] > 0 && d[5] <= 0) || (d[5] > 0 && d[6] <= 0) || (d[3] > 0 && d[4] <= 0);

    const ssn = this.slopeSum.length;
    const ssfRecent = ssn > 3 ? this.slopeSum.get(ssn - 3) : 0;
    const ssfPeak = ssfRecent > 1.0;

    const det2Hit = zeroCrossing && (ssfPeak || risingSlope > 0.40);

    const detectorHits = (det1Hit ? 1 : 0) + (det2Hit ? 1 : 0);
    if (detectorHits === 0) return null;

    const detectorAgreement = detectorHits / 2;
    const templateCorrelation = this.templateValid ? this.correlateWithTemplate() : 0;
    const nearExpected = expectedRR > 0 &&
      timeSinceLast >= expectedRR * SOFT_REFRACTORY_FACTOR && timeSinceLast <= expectedRR * (2 - SOFT_REFRACTORY_FACTOR);

    // Escalas recalibradas para señales débiles. La señal está normalizada
    // a ±60, así que prominencia típica en perfusión baja es 5-25 (no 30+).
    // Antes /8 hacía que solo prominencias >8 sumaran al score; ahora /3
    // permite que prominencias de 3-9 lleguen al máximo de 30 puntos.
    const prominenceScore = clamp(prominence / PROMINENCE_SCORE_DIVISOR, 0, 1) * PROMINENCE_SCORE_MAX;
    const slopeScore = clamp(risingSlope / RISING_SLOPE_DIVISOR, 0, 1) * 15 + clamp(fallingSlope / FALLING_SLOPE_DIVISOR, 0, 1) * 10;
    const widthScore = (widthMs > WIDTH_OPTIMAL_MIN_MS && widthMs < WIDTH_OPTIMAL_MAX_MS) ? WIDTH_SCORE_OPTIMAL : (widthMs > WIDTH_ACCEPTABLE_MIN_MS && widthMs < WIDTH_ACCEPTABLE_MAX_MS) ? WIDTH_SCORE_ACCEPTABLE : 0;
    const asymmetry = risingSlope > 0 ? fallingSlope / risingSlope : 0;
    const asymmetryScore = (asymmetry > ASYMMETRY_RATIO_MIN && asymmetry < ASYMMETRY_RATIO_MAX) ? ASYMMETRY_SCORE : 0;
    const morphologyScore = clamp(prominenceScore + slopeScore + widthScore + asymmetryScore, 0, 100);

    let rhythmScore = 0;
    if (nearExpected) rhythmScore += RHYTHM_SCORE_NEAR;
    if (this.autocorrBPM > 0) rhythmScore += RHYTHM_SCORE_AUTOCORR;
    if (this.consecutivePeaks >= RHYTHM_MIN_CONSECUTIVE_PEAKS) rhythmScore += RHYTHM_SCORE_CONSECUTIVE;
    rhythmScore = clamp(rhythmScore, 0, 100);

    const totalScore = morphologyScore * MORPHOLOGY_WEIGHT + rhythmScore * RHYTHM_WEIGHT +
      detectorAgreement * DETECTOR_AGREEMENT_WEIGHT + templateCorrelation * TEMPLATE_CORRELATION_WEIGHT +
      (this.contactStable ? CONTACT_STABLE_BONUS : 0);

    return {
      timestamp: now,
      sampleIndex: this.frameCount,
      amplitude: center,
      prominence,
      widthMs,
      upSlope: risingSlope,
      downSlope: fallingSlope,
      localBaseline: neighborhoodMin,
      detectorHits,
      detectorAgreement,
      zeroCrossingSupport: zeroCrossing,
      periodicitySupport: nearExpected,
      templateCorrelation,
      localBandPowerRatio: clamp(normRange / ELGENDI_SYNTHESIS_BAND_POWER_DIVISOR, 0, 1),
      localPerfusion: 0,
      localMotionPenalty: this.motionPenalty,
      localPressurePenalty: this.pressurePenalty,
      localClipPenalty: this.clipPenalty,
      status: 'pending',
      rejectionReason: '',
      morphologyScore,
      rhythmScore,
      totalScore,
    };
  }

  private adjudicate(c: BeatCandidate, timeSinceLast: number, expectedRR: number, refractoryState: 'hard' | 'soft' | 'open'): void {
    // Adjudication relajada para señales débiles: el gate externo y el
    // consenso espectral filtran falsos positivos a posteriori. Aquí solo
    // se rechazan candidatos físicamente imposibles.
    if (c.prominence < MIN_PROMINENCE) {
      c.status = 'rejected'; c.rejectionReason = 'low_prominence'; return;
    }
    if (c.widthMs < WIDTH_REJECT_MIN_MS || c.widthMs > WIDTH_REJECT_MAX_MS) {
      c.status = 'rejected'; c.rejectionReason = 'abnormal_width'; return;
    }
    if (c.localClipPenalty > CLIP_PENALTY_REJECT_THRESHOLD) {
      c.status = 'rejected'; c.rejectionReason = 'high_clipping'; return;
    }
    if (c.upSlope < MIN_RISING_SLOPE) {
      c.status = 'rejected'; c.rejectionReason = 'no_rising_edge'; return;
    }
    if (c.downSlope < MIN_FALLING_SLOPE) {
      c.status = 'rejected'; c.rejectionReason = 'no_falling_edge'; return;
    }
    if (refractoryState === 'soft') {
      // Refractario suave: rechazo solo si el candidato es muy pobre.
      if (c.morphologyScore < SOFT_REFRACTORY_MIN_MORPHOLOGY || c.detectorAgreement < SOFT_REFRACTORY_MIN_AGREEMENT) {
        c.status = 'rejected'; c.rejectionReason = 'double_peak_suspect';
        this.doublePeakCount++;
        return;
      }
    }
    if (this.lastPeakValue > 0) {
      const ampRatio = Math.abs(c.amplitude) / Math.max(1, Math.abs(this.lastPeakValue));
      // Tolerancia amplia para sujetos con perfusión muy variable.
      if (ampRatio < AMPLITUDE_RATIO_MIN || ampRatio > AMPLITUDE_RATIO_MAX) {
        c.status = 'rejected'; c.rejectionReason = 'amplitude_inconsistent'; return;
      }
    }

    const minScore = this.consecutivePeaks < RHYTHM_MIN_CONSECUTIVE_PEAKS ? MIDDLE_PATH_MIN_SCORE_INITIAL : MIDDLE_PATH_MIN_SCORE_ESTABLISHED;
    const thresholdMet = c.amplitude > this.peakThreshold * (c.periodicitySupport ? THRESHOLD_FACTOR_PERIODIC : THRESHOLD_FACTOR_NON_PERIODIC) ||
      c.prominence > Math.max(PROMINENCE_THRESHOLD_MIN, this.peakThreshold * PROMINENCE_THRESHOLD_FACTOR);

    // Vía rápida: dos detectores de acuerdo + morfología decente -> aceptar.
    if (c.detectorAgreement >= 1.0 && c.morphologyScore > FAST_PATH_MIN_SCORE && thresholdMet) {
      c.status = 'accepted'; return;
    }
    // Vía intermedia: un detector + score suficiente + algún soporte adicional.
    if (c.detectorHits >= 1 && c.totalScore >= minScore && thresholdMet) {
      if (c.templateCorrelation > TEMPLATE_CORR_MIDDLE_PATH || c.periodicitySupport || c.morphologyScore > MORPHOLOGY_SCORE_MIDDLE_ALT) {
        c.status = 'accepted'; return;
      }
    }
    // Vía con score alto: aceptar incluso sin threshold físico estricto.
    if (c.totalScore > HIGH_SCORE_MIN) {
      c.status = 'accepted'; return;
    }
    c.status = 'rejected';
    c.rejectionReason = 'insufficient_overall_support';
  }

  private getRefractoryState(timeSinceLast: number, expectedRR: number): 'hard' | 'soft' | 'open' {
    // Pan-Tompkins adaptado para PPG: 300 ms (vs 200 ms del ECG) por
    // morfología más lenta y para evitar contar el dícroto como pico.
    const hardLimit = this.PT_REFRACTORY_MS;
    if (timeSinceLast < hardLimit) return 'hard';
    if (expectedRR > 0) {
      const softLimit = expectedRR * SOFT_REFRACTORY_FACTOR;
      if (timeSinceLast < softLimit) return 'soft';
    } else if (timeSinceLast < SOFT_REFRACTORY_DEFAULT_MS) {
      return 'soft';
    }
    return 'open';
  }

  private getExpectedRR(): number {
    if (this.rrIntervals.length >= 3) {
      const recent = this.rrIntervals.slice(-8);
      const sorted = [...recent].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }
    if (this.autocorrBPM > 0) return bpmToRrMs(this.autocorrBPM);
    if (this.spectralBPM > 0) return bpmToRrMs(this.spectralBPM);
    return 0;
  }

  private handleMissedBeat(longRR: number, expectedRR: number, now: number): void {
    if (expectedRR <= 0) return;
    const ratio = longRR / expectedRR;
    if (ratio >= MISSED_BEAT_FACTOR_MIN && ratio <= MISSED_BEAT_FACTOR_MAX) {
      const halfRR = longRR / 2;
      if (halfRR >= MIN_RR_MS && halfRR <= MAX_MISSED_BEAT_RR) {
        if (this.rrIntervals.length > 0) {
          this.rrIntervals[this.rrIntervals.length - 1] = halfRR;
          this.rrIntervals.push(halfRR);
          if (this.rrIntervals.length > this.MAX_RR) this.rrIntervals.shift();
        }
        this.missedBeatCount++;
      }
    }
  }

  private updateTemplate(): void {
    const n = this.signalBuf.length;
    if (n < TEMPLATE_WINDOW * 2) return;
    const half = Math.floor(TEMPLATE_WINDOW / 2);
    const start = n - half - 5;
    if (start < 0) return;

    const segment = new Float64Array(TEMPLATE_WINDOW);
    for (let i = 0; i < TEMPLATE_WINDOW; i++) {
      segment[i] = this.signalBuf.get(start + i);
    }

    let min = Infinity, max = -Infinity;
    for (let i = 0; i < segment.length; i++) {
      if (segment[i] < min) min = segment[i];
      if (segment[i] > max) max = segment[i];
    }
    const range = max - min;
    if (range < TEMPLATE_MIN_RANGE) return;
    for (let i = 0; i < segment.length; i++) segment[i] = (segment[i] - min) / range;

    if (!this.templateValid) {
      this.templateBuf = segment;
      this.templateLen = TEMPLATE_WINDOW;
      this.templateValid = true;
    } else {
      const alpha = TEMPLATE_EMA_ALPHA;
      for (let i = 0; i < Math.min(this.templateLen, segment.length); i++) {
        this.templateBuf[i] = this.templateBuf[i] * (1 - alpha) + segment[i] * alpha;
      }
    }
  }

  private correlateWithTemplate(): number {
    if (!this.templateValid || this.signalBuf.length < TEMPLATE_WINDOW * 2) return 0;
    const n = this.signalBuf.length;
    const half = Math.floor(TEMPLATE_WINDOW / 2);
    const start = n - half - 5;
    if (start < 0) return 0;

    const seg = new Float64Array(TEMPLATE_WINDOW);
    for (let i = 0; i < TEMPLATE_WINDOW; i++) seg[i] = this.signalBuf.get(start + i);

    let sMin = Infinity, sMax = -Infinity;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i] < sMin) sMin = seg[i];
      if (seg[i] > sMax) sMax = seg[i];
    }
    const sRange = sMax - sMin;
    if (sRange < 0.1) return 0;
    for (let i = 0; i < seg.length; i++) seg[i] = (seg[i] - sMin) / sRange;

    let dot = 0, magA = 0, magB = 0;
    const len = Math.min(this.templateLen, seg.length);
    for (let i = 0; i < len; i++) {
      dot += this.templateBuf[i] * seg[i];
      magA += this.templateBuf[i] ** 2;
      magB += seg[i] ** 2;
    }
    const denom = Math.sqrt(magA * magB);
    return denom > 0 ? dot / denom : 0;
  }

  private fuseBPM(): BPMHypothesis {
    const fromLastIBI = this.rrIntervals.length > 0 ? bpmToRrMs(this.rrIntervals[this.rrIntervals.length - 1]) : 0;
    const fromMedianIBI = this.computeMedianRRBPM();
    this.medianRRBPM = fromMedianIBI;
    const fromTrimmedIBI = this.computeTrimmedMeanBPM();
    const fromAutocorrelation = this.estimateAutocorrBPM();
    this.autocorrBPM = fromAutocorrelation;
    const fromSpectral = this.spectralBPM;

    const tempoMid = fromMedianIBI > 0 ? fromMedianIBI : fromTrimmedIBI > 0 ? fromTrimmedIBI : fromAutocorrelation;
    if (tempoMid > 0 && fromSpectral > 0 && this.spectralConfidence > SPECTRAL_CONFIDENCE_MIN_FUSE) {
      this.temporalSpectralAgreement = 1 - Math.min(1, Math.abs(tempoMid - fromSpectral) / Math.max(AGREEMENT_MIN_BPM, tempoMid));
    } else if (fromSpectral > 0 && this.spectralConfidence > SPECTRAL_CONFIDENCE_HIGH) {
      this.temporalSpectralAgreement = TEMP_SPEC_AGREEMENT_DEFAULT;
    } else {
      this.temporalSpectralAgreement = tempoMid > 0 && fromAutocorrelation > 0
        ? 1 - Math.min(1, Math.abs(tempoMid - fromAutocorrelation) / Math.max(AGREEMENT_MIN_BPM, tempoMid))
        : TEMP_SPEC_WITH_AUTOCRR;
    }

    const hasEnoughPeaks = this.consecutivePeaks >= PEAK_DOMAIN_MIN_PEAKS;
    const peakDomainReliable = hasEnoughPeaks && this.getAvgBeatSQI() > PEAK_DOMAIN_MIN_SQI;

    let finalBpm: number;
    let dominantSource: 'peak' | 'spectral' | 'autocorr' | 'median';
    let confidence: number;

    if (peakDomainReliable && fromMedianIBI > 0) {
      const peakBpm = fromTrimmedIBI > 0 ? fromTrimmedIBI : fromMedianIBI;
      finalBpm = fromAutocorrelation > 0 && Math.abs(peakBpm - fromAutocorrelation) < peakBpm * PEAK_AUTOCRR_MAX_DIFF
        ? peakBpm * PEAK_AUTOCRR_FUSION_PEAK_WEIGHT + fromAutocorrelation * PEAK_AUTOCRR_FUSION_AUTO_WEIGHT
        : peakBpm;
      dominantSource = 'median';
      confidence = clamp(PEAK_DOMAIN_BASE_CONF + this.consecutivePeaks * PEAK_DOMAIN_CONF_PER_PEAK + this.getAvgBeatSQI() * PEAK_DOMAIN_CONF_PER_SQI, 0, 1);
    } else if (fromAutocorrelation > 0) {
      finalBpm = fromMedianIBI > 0 ? fromMedianIBI * AUTOCRR_MEDIAN_FUSION_WEIGHT + fromAutocorrelation * AUTOCRR_MEDIAN_FUSION_WEIGHT : fromAutocorrelation;
      dominantSource = 'autocorr';
      confidence = clamp(AUTOCRR_BASE_CONF + this.consecutivePeaks * AUTOCRR_CONF_PER_PEAK, 0, AUTOCRR_MAX_CONF);
    } else if (fromMedianIBI > 0) {
      finalBpm = fromMedianIBI;
      dominantSource = 'median';
      confidence = clamp(MEDIAN_BASE_CONF + this.consecutivePeaks * MEDIAN_CONF_PER_PEAK, 0, MEDIAN_MAX_CONF);
    } else {
      finalBpm = 0;
      dominantSource = 'peak';
      confidence = 0;
    }

    if (finalBpm > 0 && fromSpectral > 0 && this.spectralConfidence > SPECTRAL_CONFIDENCE_MIN) {
      if (this.temporalSpectralAgreement < TEMP_SPEC_AGREEMENT_LOW) {
        finalBpm = finalBpm * TEMP_SPEC_LOW_BPM_WEIGHT + fromSpectral * TEMP_SPEC_LOW_SPEC_WEIGHT;
        dominantSource = 'spectral';
      } else if (this.temporalSpectralAgreement > TEMP_SPEC_AGREEMENT_HIGH) {
        finalBpm = finalBpm * TEMP_SPEC_HIGH_BPM_WEIGHT + fromSpectral * TEMP_SPEC_HIGH_SPEC_WEIGHT;
      }
    }

    if (finalBpm > 0) {
      if (this.smoothBPM === 0) this.smoothBPM = finalBpm;
      else {
        const diff = Math.abs(finalBpm - this.smoothBPM) / Math.max(1, this.smoothBPM);
        const alpha =
          this.temporalSpectralAgreement < EMA_AGREEMENT_LOW ? Math.min(EMA_ALPHA_MED, diff > EMA_DIFF_HIGH ? EMA_ALPHA_SLOW : EMA_ALPHA_MED) : diff > EMA_DIFF_HIGH ? EMA_ALPHA_SLOW : diff > EMA_DIFF_MED ? 0.18 : EMA_ALPHA_FAST;
        this.smoothBPM = this.smoothBPM * (1 - alpha) + finalBpm * alpha;
      }
    }

    return {
      fromLastIBI,
      fromMedianIBI,
      fromTrimmedIBI,
      fromAutocorrelation,
      fromSpectral,
      finalBpm: this.smoothBPM,
      confidence,
      dominantSource,
      temporalSpectralAgreement: this.temporalSpectralAgreement,
    };
  }

  private computeMedianRRBPM(): number {
    if (this.rrIntervals.length < 2) return 0;
    const recent = this.rrIntervals.slice(-10);
    const sorted = [...recent].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median > 0 ? bpmToRrMs(median) : 0;
  }

  private computeTrimmedMeanBPM(): number {
    if (this.rrIntervals.length < 4) return 0;
    const recent = this.rrIntervals.slice(-12);
    const sorted = [...recent].sort((a, b) => a - b);
    const trimN = Math.max(1, Math.floor(sorted.length * 0.2));
    const trimmed = sorted.slice(trimN, sorted.length - trimN);
    if (trimmed.length === 0) return 0;
    const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    return mean > 0 ? 60000 / mean : 0;
  }

  private estimateAutocorrBPM(): number {
    if (this.signalBuf.length < 80) return 0;
    const sr = this.estimateSampleRate();
    const n = Math.min(180, this.signalBuf.length);
    const minLag = Math.max(5, Math.round((sr * 60) / 200));
    const maxLag = Math.min(n - 10, Math.round((sr * 60) / 38));

    let bestLag = 0, bestScore = 0;
    const expectedRR = this.getExpectedRR();
    const expectedLag = expectedRR > 0 ? Math.round((expectedRR / 1000) * sr) : 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      const ac = this.signalBuf.autocorrelation(lag, n);
      const rhythmBias = expectedLag > 0 ? 1 - Math.min(0.15, Math.abs(lag - expectedLag) / Math.max(1, expectedLag) * 0.1) : 1;
      const weighted = ac * rhythmBias;
      if (weighted > bestScore) {
        bestScore = weighted;
        bestLag = lag;
      }
    }

    if (bestLag === 0 || bestScore < 0.2) return 0;
    return (60 * sr) / bestLag;
  }

  private updateSmoothBPM(instantBPM: number): void {
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
      return;
    }
    const relativeDiff = Math.abs(instantBPM - this.smoothBPM) / Math.max(1, this.smoothBPM);
    let alpha = 0.25;
    if (relativeDiff > 0.30) alpha = 0.06;
    else if (relativeDiff > 0.18) alpha = 0.12;
    if (this.consecutivePeaks < 5) alpha = Math.max(0.05, alpha - 0.06);
    this.smoothBPM = this.smoothBPM * (1 - alpha) + instantBPM * alpha;
  }

  private computeBeatSQI(c: BeatCandidate, timeSinceLast: number): number {
    const prevIbi = this.rrIntervals.length > 0 ? this.rrIntervals[this.rrIntervals.length - 1] : 0;
    const expected = this.getExpectedRR();
    const refractoryOk = timeSinceLast >= 280 && (expected <= 0 || timeSinceLast >= expected * 0.52);
    const bq = BeatQualityAssessor.assess({
      prominence: c.prominence,
      widthMs: c.widthMs,
      upSlope: c.upSlope,
      downSlope: c.downSlope,
      refractoryOk,
      templateCorrelation: c.templateCorrelation,
      ibiMs: timeSinceLast,
      prevIbiMs: prevIbi,
      motionPenalty: this.motionPenalty,
      clipPenalty: this.clipPenalty,
    });
    let legacy = 0;
    legacy += Math.min(30, c.morphologyScore * 0.3);
    legacy += c.detectorAgreement * 20;
    legacy += Math.max(0, c.templateCorrelation) * 15;
    legacy += Math.min(15, c.rhythmScore * 0.15);
    legacy += c.localBandPowerRatio * 8;
    legacy += Math.min(7, this.upstreamSQI * 0.07);
    legacy += this.contactStable ? 5 : 0;
    legacy -= c.localMotionPenalty * 15;
    legacy -= c.localClipPenalty * 12;
    legacy -= c.localPressurePenalty * 10;
    if (this.sourceSwitchRecent) legacy -= 5;
    const blended = bq.score0100 * 0.58 + clamp(legacy, 0, 100) * 0.42;
    return clamp(Math.round(blended), 0, 100);
  }

  private computeFlags(c: BeatCandidate, timeSinceLast: number, expectedRR: number): BeatFlags {
    const isPremature = expectedRR > 0 && timeSinceLast < expectedRR * 0.7;
    const isWeak = c.detectorHits < 2 && c.morphologyScore < 40;
    return {
      isWeak,
      isDoublePeak: false,
      isMissedBeatInserted: false,
      isPremature,
      isSuspicious: isPremature || isWeak || c.totalScore < 35,
    };
  }

  private computeBPMConfidence(h: BPMHypothesis): number {
    if (h.finalBpm === 0) return 0;
    const peakFactor = Math.min(1, this.consecutivePeaks / 6) * 0.25;
    const avgSQI = this.getAvgBeatSQI() / 100 * 0.20;

    let rrStability = 0;
    if (this.rrIntervals.length >= 3) {
      const recent = this.rrIntervals.slice(-8);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance = recent.reduce((a, rr) => a + (rr - mean) ** 2, 0) / recent.length;
      const cv = Math.sqrt(variance) / Math.max(1, mean);
      rrStability = clamp(1 - cv * 2, 0, 1) * 0.20;
    }

    let coherence = 0;
    const hyps = [h.fromMedianIBI, h.fromTrimmedIBI, h.fromAutocorrelation].filter(v => v > 0);
    if (hyps.length >= 2 && h.finalBpm > 0) {
      const diffs = hyps.map(v => Math.abs(v - h.finalBpm) / h.finalBpm);
      const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      coherence = clamp(1 - avgDiff * 5, 0, 1) * 0.15;
    }

    const recentBeats = this.acceptedBeats.slice(-10);
    const suspiciousRatio = recentBeats.length > 0 ? recentBeats.filter(b => b.flags.isSuspicious).length / recentBeats.length : 0;
    const suspPenalty = suspiciousRatio * 0.1;
    const contactBonus = this.contactStable ? 0.08 : 0;
    const pressureBonus = this.pressurePenalty < 0.1 ? 0.05 : 0;

    return clamp(peakFactor + avgSQI + rrStability + coherence - suspPenalty + contactBonus + pressureBonus, 0, 1);
  }

  private computeGlobalSQI(): number {
    if (this.signalBuf.length < 30) return 0;
    const range = this.getSignalRange(60);
    const rangeFactor = Math.min(1, range / 5) * 22;
    const peakFactor = Math.min(1, this.consecutivePeaks / 5) * 20;

    const dLen = Math.min(60, this.derivBuf.length);
    let derivSum = 0;
    for (let i = 0; i < dLen; i++) derivSum += Math.abs(this.derivBuf.get(this.derivBuf.length - dLen + i));
    const slopeFactor = Math.min(1, (derivSum / dLen) / 1.0) * 14;

    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const m = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const v = this.rrIntervals.reduce((a, rr) => a + (rr - m) ** 2, 0) / this.rrIntervals.length;
      const cv = Math.sqrt(v) / Math.max(1, m);
      rrFactor = Math.max(0, 1 - cv * 2) * 22;
    }

    const periodicityFactor = (this.autocorrBPM > 0 ? 0.6 : 0) * 22;
    return clamp(Math.round(rangeFactor + slopeFactor + rrFactor + peakFactor + periodicityFactor), 0, 100);
  }

  private getAvgBeatSQI(): number {
    const recent = this.acceptedBeats.slice(-8);
    if (recent.length === 0) return 0;
    return recent.reduce((s, b) => s + b.beatSQI, 0) / recent.length;
  }
  
  private detectorAgreementAverage(): number {
    const recent = this.acceptedBeats.slice(-8);
    if (recent.length === 0) return 0;
    return recent.reduce((s, b) => s + b.detectorAgreementScore, 0) / recent.length;
  }
  
  private hardReset(): void {
    this.smoothBPM = 0;
    this.spectralBPM = 0;
    this.autocorrBPM = 0;
    this.medianRRBPM = 0;
    this.beatsAccepted = 0;
    this.consecutivePeaks = 0;
    this.rrIntervals = [];
    this.acceptedBeats = [];
    this.lastPeakTime = 0;
    this.livePpgEvidencePassed = false;
    this.invalidEvidenceStreak = 0;
    // Limpiar también buffers de señal para que el detector no quede
    // contaminado con muestras del frame anterior (sin dedo).
    this.signalBuf.clear();
    this.derivBuf.clear();
    this.slopeSum.clear();
    this.timestampBuf.clear();
    this.templateValid = false;
    this.templateLen = 0;
    this.ptSignalLevel = 0;
    this.ptNoiseLevel = 0;
    this.peakThreshold = 4.0;
    this.elgendi.reset();
    this.lastElgendiPeakTs = 0;
  }

  private computeDerivative(): number {
    const n = this.signalBuf.length;
    if (n < 3) return 0;
    return (this.signalBuf.get(n - 1) - this.signalBuf.get(n - 3)) * 0.5 + (this.signalBuf.get(n - 1) - this.signalBuf.get(n - 2)) * 0.5;
  }

  private computeSlopeSum(): number {
    const win = 5;
    const n = this.derivBuf.length;
    if (n < win) return 0;
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const d = this.derivBuf.get(n - win + i);
      if (d > 0) sum += d;
    }
    return sum;
  }

  private getSignalRange(windowLen: number): number {
    const n = Math.min(windowLen, this.signalBuf.length);
    if (n < 10) return 0;
    const p10 = this.signalBuf.percentile(0.1, n);
    const p90 = this.signalBuf.percentile(0.9, n);
    return p90 - p10;
  }

  private normalizeSignal(value: number): { normalizedValue: number; normRange: number } {
    const windowLen = this.consecutivePeaks < 4 ? 90 : 150;
    const n = Math.min(windowLen, this.signalBuf.length);
    if (n < 10) return { normalizedValue: 0, normRange: 0 };
    const p10 = this.signalBuf.percentile(0.1, n);
    const p90 = this.signalBuf.percentile(0.9, n);
    const range = p90 - p10;
    if (range < 0.05) return { normalizedValue: 0, normRange: 0 };
    const clipped = Math.min(p90, Math.max(p10, value));
    const normalizedValue = ((clipped - p10) / range - 0.5) * 120;
    return { normalizedValue, normRange: range };
  }

  private normalizeWindow(count: number, refWindowLen: number): Float64Array {
    const n = this.signalBuf.length;
    if (n < count) return new Float64Array(count);
    const refN = Math.min(refWindowLen, n);
    const p10 = this.signalBuf.percentile(0.1, refN);
    const p90 = this.signalBuf.percentile(0.9, refN);
    const range = p90 - p10;
    const out = new Float64Array(count);
    if (range < 0.05) return out;
    for (let i = 0; i < count; i++) {
      const v = this.signalBuf.get(n - count + i);
      const c = Math.min(p90, Math.max(p10, v));
      out[i] = ((c - p10) / range - 0.5) * 120;
    }
    return out;
  }

  private estimateSampleRate(): number {
    if (this.timestampBuf.length < 10) return 30;
    const n = Math.min(50, this.timestampBuf.length);
    const intervals: number[] = [];
    for (let i = 1; i < n; i++) {
      const d = this.timestampBuf.get(this.timestampBuf.length - n + i) - this.timestampBuf.get(this.timestampBuf.length - n + i - 1);
      if (d >= 8 && d <= 120) intervals.push(d);
    }
    if (intervals.length < 6) return 30;
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    return clamp(1000 / median, 15, 60);
  }

  private updateThreshold(range: number): void {
    // Pan-Tompkins adaptive threshold (validado IEEE TBME 1985):
    //   Threshold = NoiseLevel + 0.25 * (SignalLevel - NoiseLevel)
    // Si todavía no hay suficientes muestras de signal/noise, fallback al
    // threshold rango-relativo. Una vez cargado, el PT-threshold sigue
    // automáticamente a la amplitud de los picos sin parámetros mágicos.
    if (this.ptSignalLevel > 0 && this.ptSignalLevel > this.ptNoiseLevel) {
      const ptTh = this.ptNoiseLevel + 0.25 * (this.ptSignalLevel - this.ptNoiseLevel);
      // Suavizado para no oscilar entre frames
      this.peakThreshold = this.peakThreshold * 0.75 + ptTh * 0.25;
    } else {
      const base = this.autocorrBPM > 0 ? 1.4 : 2.4;
      const target = clamp(base + range * 0.25, 0.9, 6.0);
      this.peakThreshold = this.peakThreshold * 0.80 + target * 0.20;
    }
  }

  /** Actualiza SignalLevel cuando se acepta un latido (Pan-Tompkins). */
  private updatePTSignalLevel(peakAmplitude: number): void {
    const a = Math.abs(peakAmplitude);
    this.ptSignalLevel = this.ptSignalLevel * 0.875 + a * 0.125;
  }

  /** Actualiza NoiseLevel cuando se rechaza un candidato (Pan-Tompkins). */
  private updatePTNoiseLevel(noiseAmplitude: number): void {
    const a = Math.abs(noiseAmplitude);
    this.ptNoiseLevel = this.ptNoiseLevel * 0.875 + a * 0.125;
  }

  private updateSpectralHr(): void {
    if (this.signalBuf.length < 90) return;
    const n = Math.min(128, this.signalBuf.length);
    const arr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      arr[i] = this.signalBuf.get(this.signalBuf.length - n + i);
    }
    const sr = this.estimateSampleRate();
    const res = estimateHrNarrowbank(arr, sr);
    this.spectralBPM = res.bpm;
    this.spectralConfidence = res.confidence;
    this.spectralPeakRatio = res.peakRatio;
  }

  getRRIntervals(): number[] { return [...this.rrIntervals]; }
  getLastPeakTime(): number { return this.lastPeakTime; }
  getSQI(): number { return this.computeGlobalSQI(); }

  private makeEmptyResult(bpm: number): HeartBeatResult {
    return {
      bpm, bpmConfidence: 0, isPeak: false,
      filteredValue: 0, arrhythmiaCount: 0, sqi: 0, beatSQI: 0,
      rrData: { intervals: [], lastPeakTime: null },
      hypothesis: null, detectorAgreement: 0,
      rejectionReason: '', beatFlags: null,
      debug: {
        instantBpm: 0, medianRRBpm: 0, autocorrBpm: 0, spectralBpm: 0,
        lastBeatSQI: 0, detectorAgreement: 0, expectedRR: 0,
        refractoryState: 'open' as const, beatsAccepted: this.beatsAccepted,
        beatsRejected: this.beatsRejected, lastRejectionReason: this.lastRejectionReason,
        doublePeakCount: this.doublePeakCount, missedBeatCount: this.missedBeatCount,
        suspiciousCount: this.suspiciousCount, templateCorrelation: 0,
        morphologyScore: 0, consecutivePeaks: this.consecutivePeaks,
        recentAcceptedBeats: [],
        temporalSpectralAgreement: 0,
        spectralConfidence: 0,
      },
    };
  }

  reset(): void {
    this.signalBuf.clear();
    this.derivBuf.clear();
    this.slopeSum.clear();
    this.timestampBuf.clear();
    this.rrIntervals = [];
    this.acceptedBeats = [];
    this.smoothBPM = 0;
    this.spectralBPM = 0;
    this.spectralConfidence = 0;
    this.spectralPeakRatio = 0;
    this.temporalSpectralAgreement = 0;
    this.windowSQIUpstream = 0.45;
    this.autocorrBPM = 0;
    this.medianRRBPM = 0;
    this.lastPeakTime = 0;
    this.lastPeakValue = 0;
    this.consecutivePeaks = 0;
    this.peakThreshold = 4.0;
    this.ptSignalLevel = 0;
    this.ptNoiseLevel = 0;
    this.elgendi.reset();
    this.lastElgendiPeakTs = 0;
    this.frameCount = 0;
    this.beatsAccepted = 0;
    this.beatsRejected = 0;
    this.doublePeakCount = 0;
    this.missedBeatCount = 0;
    this.suspiciousCount = 0;
    this.lastRejectionReason = '';
    this.templateValid = false;
    this.templateLen = 0;
    this.lastHypothesis = null;
  }

  dispose(): void {
    // FAIL-CLOSED: Sin efectos secundarios, nada que limpiar
  }
}
