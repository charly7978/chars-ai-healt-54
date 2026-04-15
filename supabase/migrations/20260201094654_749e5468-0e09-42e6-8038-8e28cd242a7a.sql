-- =====================================================
-- CREAR TABLAS CON RLS HABILITADO
-- =====================================================

-- 1. CREAR TABLA PROFILES
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. CREAR TABLA MEASUREMENTS (datos de salud)
CREATE TABLE public.measurements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  heart_rate INTEGER NOT NULL,
  spo2 INTEGER NOT NULL,
  systolic INTEGER NOT NULL,
  diastolic INTEGER NOT NULL,
  arrhythmia_count INTEGER NOT NULL DEFAULT 0,
  quality INTEGER NOT NULL DEFAULT 0,
  measured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. CREAR ENUM PARA CALIBRATION STATUS
CREATE TYPE public.calibration_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- 4. CREAR TABLA CALIBRATION_SETTINGS
CREATE TABLE public.calibration_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  systolic_reference INTEGER,
  diastolic_reference INTEGER,
  quality_threshold NUMERIC,
  stability_threshold NUMERIC,
  perfusion_index NUMERIC,
  red_threshold_min NUMERIC,
  red_threshold_max NUMERIC,
  is_active BOOLEAN DEFAULT true,
  status public.calibration_status DEFAULT 'pending',
  last_calibration_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 5. HABILITAR RLS EN TODAS LAS TABLAS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibration_settings ENABLE ROW LEVEL SECURITY;

-- 6. POLÍTICAS PARA PROFILES
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 7. POLÍTICAS PARA MEASUREMENTS
CREATE POLICY "Users can view own measurements"
ON public.measurements FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own measurements"
ON public.measurements FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own measurements"
ON public.measurements FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own measurements"
ON public.measurements FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- 8. POLÍTICAS PARA CALIBRATION_SETTINGS
CREATE POLICY "Users can view own calibration"
ON public.calibration_settings FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own calibration"
ON public.calibration_settings FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own calibration"
ON public.calibration_settings FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own calibration"
ON public.calibration_settings FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- 9. TRIGGER PARA CREAR PERFIL AUTOMÁTICAMENTE
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 10. TRIGGER PARA UPDATED_AT
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_calibration_updated_at
  BEFORE UPDATE ON public.calibration_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();