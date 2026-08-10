import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * History-backed navigation stack.
 *
 * The app is a PWA installed to the home screen, so the hardware/gesture back
 * button is the primary "up" affordance. Screens live in a stack mirrored into
 * window.history: push() adds a history entry, back() pops it, and a popstate
 * listener keeps our state in sync when the user swipes or taps back.
 *
 * A route is { screen, params } — params carry ids (tripId, locationId, eventId)
 * so a screen can be restored from a cold load or a shared URL.
 */

const STATE_KEY = 'tr_nav';

function readInitialRoute(defaultRoute, parseUrl) {
  if (typeof window === 'undefined') return defaultRoute;

  const fromHistory = window.history.state?.[STATE_KEY];
  if (fromHistory?.screen) return fromHistory;

  const fromUrl = parseUrl?.(new URL(window.location.href));
  return fromUrl || defaultRoute;
}

export function useAppNavigation({
  defaultRoute = { screen: 'home', params: {} },
  parseUrl = null,
  buildUrl = null,
} = {}) {
  const [stack, setStack] = useState(() => [readInitialRoute(defaultRoute, parseUrl)]);
  // Guards the popstate handler from reacting to history writes we made ourselves.
  const skipNextPop = useRef(false);

  const route = stack[stack.length - 1];

  // Seed the first history entry so the initial screen is restorable on reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.history.state?.[STATE_KEY]) return;
    const url = buildUrl?.(stack[0]) ?? null;
    window.history.replaceState({ ...window.history.state, [STATE_KEY]: stack[0] }, '', url || undefined);
    // Intentionally first-mount only — later writes go through push/replace/back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function onPop(e) {
      if (skipNextPop.current) {
        skipNextPop.current = false;
        return;
      }
      const target = e.state?.[STATE_KEY];
      setStack((prev) => {
        if (!target?.screen) return prev.length > 1 ? prev.slice(0, -1) : prev;

        // Walk back to the matching entry if it is already in our stack,
        // otherwise treat it as a fresh root (deep link / restored session).
        const idx = prev.findIndex((r) => sameRoute(r, target));
        if (idx >= 0) return prev.slice(0, idx + 1);
        return [...prev, target];
      });
    }

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const push = useCallback((screen, params = {}) => {
    const next = { screen, params };
    setStack((prev) => [...prev, next]);
    if (typeof window !== 'undefined') {
      const url = buildUrl?.(next) ?? null;
      window.history.pushState({ [STATE_KEY]: next }, '', url || undefined);
    }
  }, [buildUrl]);

  /** Swap the current screen without growing the stack (tab switches). */
  const replace = useCallback((screen, params = {}) => {
    const next = { screen, params };
    setStack((prev) => [...prev.slice(0, -1), next]);
    if (typeof window !== 'undefined') {
      const url = buildUrl?.(next) ?? null;
      window.history.replaceState({ [STATE_KEY]: next }, '', url || undefined);
    }
  }, [buildUrl]);

  /** Reset to a single root screen — used after destructive actions (trip deleted). */
  const reset = useCallback((screen, params = {}) => {
    const next = { screen, params };
    setStack([next]);
    if (typeof window !== 'undefined') {
      const url = buildUrl?.(next) ?? null;
      window.history.replaceState({ [STATE_KEY]: next }, '', url || undefined);
    }
  }, [buildUrl]);

  const back = useCallback(() => {
    if (typeof window === 'undefined') {
      setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      return;
    }
    // Let the browser drive: history.back() fires popstate, which trims the stack.
    // This keeps our stack and the browser's in agreement.
    window.history.back();
  }, []);

  const canGoBack = stack.length > 1;

  return { route, screen: route.screen, params: route.params, stack, push, replace, reset, back, canGoBack };
}

function sameRoute(a, b) {
  if (!a || !b) return false;
  if (a.screen !== b.screen) return false;
  const ap = a.params || {};
  const bp = b.params || {};
  const keys = new Set([...Object.keys(ap), ...Object.keys(bp)]);
  for (const k of keys) {
    if (ap[k] !== bp[k]) return false;
  }
  return true;
}
