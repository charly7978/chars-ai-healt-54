import { KalmanFilter } from './signal-processing/KalmanFilter';

export class HeartBeatProcessor {
  // ────────── MEDICAL-GRADE CONFIGURATION ──────────
  private readonly DEFAULT_SAMPLE_RATE = 100; // Increased for better temporal resolution
  private readonly DEFAULT_WINDOW_SIZE = 极速增强版 3000 
  private readonly DEFAULT_MIN_BPM = 40; // Medical lower limit for adults
  private readonly DEFAULT_MAX_BPM = 200; // Medical upper limit
  
  // Signal processing parameters
  private readonly DEFAULT_SIGNAL_THRESHOLD = 0.01; // Lowered for better sensitivity
  private readonly DEFAULT_MIN_CONFIDENCE = 0.85; // Increased for medical reliability
  private readonly DEFAULT_DERIVATIVE_THRESHOLD = -0.003; // Optimized for PPG signals
  private readonly DEFAULT_MIN_PEAK_TIME_MS = 300; // Physiologically appropriate
  private readonly WARMUP_TIME_MS = 2000; // Increased for stable readings
  private readonly SIGNAL_QUALITY_WINDOW = 3 * this.DEFAULT_SAMPLE_RATE; // 3-second window

  // Advanced signal processing parameters
  private readonly MEDIAN_FILTER_WINDOW = 5; // For spike removal
  private readonly MOVING_AVERAGE_WINDOW = 5; // For noise reduction
  private readonly EMA_ALPHA = 0.3; // For adaptive filtering
  private readonly BASELINE_FACTOR = 0.9; // For DC removal
  private readonly BANDPASS_LOW_CUTOFF = 0.7; // Hz (42 BPM)
  private readonly BANDPASS_HIGH_CUTOFF = 3.3; // Hz (200 BPM)
  private readonly SIGNAL_QUALITY_THRESHOLD = 0.7; // Minimum signal quality score (0-1)

  // Parámetros de beep y vibración
  private readonly BEEP_DURATION = 450; 
  private readonly BEEP_VOLUME = 1.0;
  private readonly MIN_BEEP_INTERVAL_MS = 600; // Restaurado para prevenir beeps excesivos
  private readonly VIBRATION_PATTERN = [极速增强版 3000 

<environment_details>
# VSCode Visible Files
src/modules/HeartBeatProcessor.ts

# VSCode Open Tabs
src/modules/signal-processing/BiophysicalValidator.ts
src/modules/signal-processing/SignalTrendAnalyzer.ts
src/modules/signal-processing/PPGSignalProcessor.ts
src/modules/signal-processing/SignalAnalyzer.ts
src/components/AnimatedHeartRate.tsx
src/components/CalibrationDialog.tsx
src/components/MonitorButton.tsx
src/components/SignalQualityIndicator.tsx
src/hooks/useHeartBeatProcessor.ts
src/main.tsx
src/modules/HeartBeatProcessor.ts

# Actively Running Terminals
## Original command: `npm run dev`

# Current Time
7/5/2025, 6:47:44 PM (America/Buenos_Aires, UTC-3:00)

# Current Mode
ACT MODE
</environment_details>
