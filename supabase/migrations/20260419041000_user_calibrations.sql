-- =====================================================
-- USER CALIBRATIONS — per-user, per-modality persistence
-- =====================================================
-- Stores serialized calibration payloads (JSON) for each measurement
-- modality (SpO2 V3, BP V3, Glucose V3, Lipids V3, Hemoglobin, Device profile).
-- Row-level security ensures each user can only read/write their own rows.

CREATE TABLE IF NOT EXISTS public.user_calibrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modality TEXT NOT NULL CHECK (modality IN (
    'spo2_v3',
    'bp_v3',
    'glucose_v3',
    'lipids_v3',
    'hemoglobin_v1',
    'device_profile_v1'
  )),
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- One active calibration per (user, modality)
CREATE UNIQUE INDEX IF NOT EXISTS user_calibrations_user_modality_idx
  ON public.user_calibrations (user_id, modality);

-- RLS
ALTER TABLE public.user_calibrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user owns calibrations select"
  ON public.user_calibrations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user owns calibrations insert"
  ON public.user_calibrations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user owns calibrations update"
  ON public.user_calibrations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user owns calibrations delete"
  ON public.user_calibrations FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- updated_at trigger reuses function created in initial migration
CREATE TRIGGER update_user_calibrations_updated_at
  BEFORE UPDATE ON public.user_calibrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
