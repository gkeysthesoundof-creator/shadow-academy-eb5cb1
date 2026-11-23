'use client';
import { useEffect } from 'react';

export function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol !== 'http:' || location.hostname === 'localhost') {
      navigator.serviceWorker?.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
