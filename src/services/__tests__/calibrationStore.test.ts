import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub the supabase client to a "no-session" state so the store falls back
// to localStorage-only behavior. Mock must be set up before importing the
// module under test.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  },
}));

import {
  saveCalibration,
  loadCalibration,
  deleteCalibration,
  listCalibrations,
  loadCalibrationLocal,
} from '../calibrationStore';

describe('calibrationStore (no-session, localStorage fallback)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('saves and loads a payload via localStorage', async () => {
    await saveCalibration('spo2_v3', { A: 110, B: -25, C: 0 });
    const r = await loadCalibration<{ A: number }>('spo2_v3');
    expect(r).toEqual({ A: 110, B: -25, C: 0 });
  });

  it('loadCalibrationLocal works synchronously', async () => {
    await saveCalibration('bp_v3', { weights: [1, 2, 3], intercept: 80 });
    const r = loadCalibrationLocal<{ weights: number[] }>('bp_v3');
    expect(r?.weights).toEqual([1, 2, 3]);
  });

  it('returns null when nothing was saved', async () => {
    const r = await loadCalibration('glucose_v3');
    expect(r).toBeNull();
  });

  it('deleteCalibration removes the local copy', async () => {
    await saveCalibration('lipids_v3', { foo: 'bar' });
    await deleteCalibration('lipids_v3');
    const r = await loadCalibration('lipids_v3');
    expect(r).toBeNull();
  });

  it('listCalibrations enumerates locally-saved modalities', async () => {
    await saveCalibration('spo2_v3', { A: 1 });
    await saveCalibration('hemoglobin_v1', { foo: 1 });
    const list = await listCalibrations();
    expect(list).toContain('spo2_v3');
    expect(list).toContain('hemoglobin_v1');
  });

  it('saveCalibration is a no-op when payload is undefined', async () => {
    const ok = await saveCalibration('spo2_v3', undefined as any);
    expect(ok).toBe(false);
  });
});
