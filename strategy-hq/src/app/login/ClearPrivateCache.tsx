'use client';
import { useEffect } from 'react';

/** Reaching the sign-in page means no active session on this device: drop any
 *  offline copies of private pages so a shared phone/PC never shows them. */
export function ClearPrivateCache() {
  useEffect(() => {
    if (typeof caches === 'undefined') return;
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
  }, []);
  return null;
}
