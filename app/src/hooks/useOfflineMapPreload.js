import { useEffect } from 'react';
import { preloadAllCatalogRegions } from '../lib/offlineMaps';

/**
 * Silently pre-downloads all catalog offline map packs when the user is online.
 * Keeps the app trip-agnostic — regions are data, not branding.
 */
export function useOfflineMapPreload({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return undefined;

    const timer = window.setTimeout(() => {
      void preloadAllCatalogRegions();
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [enabled]);
}
