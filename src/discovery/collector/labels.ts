import type { RawSnapshot } from '../models/snapshot.js';

/** Pure text helpers used to turn a RawSnapshot into a DiscoveredPage. */

export function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

/** Absolute URL → pathname + search + hash (the form stored on output). */
export function toRelativePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Derive a human label for a page: prefer its first visible heading, then the
 * presence of a password field (→ "Login"), then the URL path segment,
 * finally "Home".
 */
export function deriveLabel(snapshot: RawSnapshot, relativeUrl: string): string {
  if (snapshot.heading) return snapshot.heading;
  if (snapshot.hasPassword) return 'Login';
  const segment = relativeUrl
    .replace(/[?#].*$/, '')
    .split('/')
    .filter(Boolean)
    .pop();
  if (segment) return capitalize(decodeURIComponent(segment));
  return 'Home';
}

/** Exploration-policy classifier: links whose target ends the session. */
export function isLogoutLabel(text: string): boolean {
  return /log\s*out|sign\s*out|signout|logout/i.test(text);
}
