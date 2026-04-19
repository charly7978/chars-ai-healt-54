/**
 * CALIBRATION STORE — per-user, per-modality persistence
 *
 * Two-tier storage:
 *  1. Supabase (when the user is authenticated) — table `user_calibrations`
 *     keyed by (user_id, modality), one active row per user/modality.
 *  2. localStorage (always, even when authenticated) — fast L1 cache so the
 *     app can recover the calibration on next load even before the auth
 *     session re-attaches.
 *
 * Modalities use the V3 naming so older shapes can coexist:
 *   'spo2_v3', 'bp_v3', 'glucose_v3', 'lipids_v3', 'hemoglobin_v1',
 *   'device_profile_v1'
 *
 * No Math.random, no simulation. All payloads are JSON-serializable.
 */

import { supabase } from '@/integrations/supabase/client';

export type CalibrationModality =
  | 'spo2_v3'
  | 'bp_v3'
  | 'glucose_v3'
  | 'lipids_v3'
  | 'hemoglobin_v1'
  | 'device_profile_v1';

const LS_PREFIX = 'cppg.calibration.';

function lsKey(modality: CalibrationModality): string {
  return `${LS_PREFIX}${modality}`;
}

function safeLocalStorageGet<T = any>(modality: CalibrationModality): T | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(lsKey(modality));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch { return null; }
}

function safeLocalStorageSet(modality: CalibrationModality, payload: any): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(lsKey(modality), JSON.stringify(payload));
  } catch { /* private mode etc. */ }
}

function safeLocalStorageDelete(modality: CalibrationModality): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(lsKey(modality));
  } catch { /* */ }
}

async function getUserId(): Promise<string | null> {
  try {
    const { data, error } = await (supabase as any).auth.getUser();
    if (error) return null;
    return data?.user?.id ?? null;
  } catch { return null; }
}

/**
 * Save (upsert) a calibration payload. Always writes to localStorage; writes
 * to Supabase too when a user session exists. Returns true if at least one
 * tier succeeded.
 */
export async function saveCalibration(modality: CalibrationModality, payload: any): Promise<boolean> {
  if (payload === undefined) return false;
  // Local first — never block the UI on the network
  safeLocalStorageSet(modality, payload);

  const userId = await getUserId();
  if (!userId) return true; // local-only is OK when not authenticated

  try {
    // Try update first; if no row exists, insert.
    const { data: updated, error: updErr } = await (supabase as any)
      .from('user_calibrations')
      .update({ payload, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('modality', modality)
      .select('id')
      .maybeSingle();
    if (updErr) {
      // ignore — try insert path
    } else if (updated && updated.id) {
      return true;
    }
    const { error: insErr } = await (supabase as any)
      .from('user_calibrations')
      .insert({ user_id: userId, modality, payload });
    if (insErr) {
      console.warn('[calibrationStore] insert failed:', insErr.message ?? insErr);
      return true; // local already saved
    }
    return true;
  } catch (e: any) {
    console.warn('[calibrationStore] saveCalibration error:', e?.message ?? e);
    return true; // local already saved
  }
}

/**
 * Load a calibration payload. Tries Supabase first when authenticated; falls
 * back to localStorage. Returns null when no calibration exists in either tier.
 */
export async function loadCalibration<T = any>(modality: CalibrationModality): Promise<T | null> {
  const userId = await getUserId();
  if (userId) {
    try {
      const { data, error } = await (supabase as any)
        .from('user_calibrations')
        .select('payload')
        .eq('user_id', userId)
        .eq('modality', modality)
        .maybeSingle();
      if (!error && data?.payload) {
        // Refresh L1 cache
        safeLocalStorageSet(modality, data.payload);
        return data.payload as T;
      }
    } catch (e: any) {
      console.warn('[calibrationStore] loadCalibration error:', e?.message ?? e);
    }
  }
  return safeLocalStorageGet<T>(modality);
}

/**
 * Delete a calibration. Removes from both tiers (best-effort).
 */
export async function deleteCalibration(modality: CalibrationModality): Promise<void> {
  safeLocalStorageDelete(modality);
  const userId = await getUserId();
  if (!userId) return;
  try {
    await (supabase as any)
      .from('user_calibrations')
      .delete()
      .eq('user_id', userId)
      .eq('modality', modality);
  } catch { /* */ }
}

/**
 * List all available calibration modalities for the current tier (online > local).
 */
export async function listCalibrations(): Promise<CalibrationModality[]> {
  const userId = await getUserId();
  if (userId) {
    try {
      const { data, error } = await (supabase as any)
        .from('user_calibrations')
        .select('modality')
        .eq('user_id', userId);
      if (!error && Array.isArray(data)) return data.map((r: any) => r.modality as CalibrationModality);
    } catch { /* */ }
  }
  // Fallback: enumerate localStorage
  const out: CalibrationModality[] = [];
  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LS_PREFIX)) {
        out.push(key.substring(LS_PREFIX.length) as CalibrationModality);
      }
    }
  }
  return out;
}

/** Synchronous local-only access for boot-time hydration of processors. */
export function loadCalibrationLocal<T = any>(modality: CalibrationModality): T | null {
  return safeLocalStorageGet<T>(modality);
}
