
-- Extend measurements table with full clinical metrics and traceability
ALTER TABLE public.measurements
  ADD COLUMN IF NOT EXISTS glucose numeric,
  ADD COLUMN IF NOT EXISTS hemoglobin numeric,
  ADD COLUMN IF NOT EXISTS total_cholesterol numeric,
  ADD COLUMN IF NOT EXISTS triglycerides numeric,
  ADD COLUMN IF NOT EXISTS sdnn numeric,
  ADD COLUMN IF NOT EXISTS rmssd numeric,
  ADD COLUMN IF NOT EXISTS pnn50 numeric,
  ADD COLUMN IF NOT EXISTS lf_power numeric,
  ADD COLUMN IF NOT EXISTS hf_power numeric,
  ADD COLUMN IF NOT EXISTS lf_hf_ratio numeric,
  ADD COLUMN IF NOT EXISTS signal_quality_index numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS measurement_confidence text DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS algorithm_version text DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS measurement_window_seconds numeric DEFAULT 60,
  ADD COLUMN IF NOT EXISTS calibration_id uuid REFERENCES public.calibration_settings(id) ON DELETE SET NULL;

-- Index for efficient querying by user + time
CREATE INDEX IF NOT EXISTS idx_measurements_user_measured 
  ON public.measurements (user_id, measured_at DESC);
