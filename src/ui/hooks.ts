import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './format';

/** Runs an async action, tracking busy state and a local error message. Resolves true on success. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (mounted.current) setError(errorText(e));
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function usePrefersFinePointer() {
  const [fine] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches);
  return fine;
}

export function readSession(key: string) {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function writeSession(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode, quota) — drafts are best effort */
  }
}
