import { useEffect } from 'react'

export function useBodyScrollLock(shouldLock: boolean) {
  useEffect(() => {
    if (!shouldLock || typeof document === 'undefined') {
      return undefined;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [shouldLock]);
}
