export const isDebugEnabled = (): boolean => {
  try {
    return typeof window !== 'undefined' && (window as any).__ppgDebug__ === true;
  } catch {
    return false;
  }
};


