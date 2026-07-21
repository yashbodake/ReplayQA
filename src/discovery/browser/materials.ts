/**
 * State-fingerprint materials — the DOM observation that the StateManager's
 * fingerprint (Strategy E) is computed from.
 *
 * This module is PURE: it imports no Playwright types and contains no Node
 * side-effects. `extractMaterials` is a browser-side function (it runs via
 * `page.evaluate`); defining it here lets both the BrowserController
 * (production) and the state-lab (regression) run the EXACT same extraction,
 * so the lab cannot drift from production.
 *
 * Design rules (validated in docs/discovery/state-fingerprint-report.md):
 *   - Text content is ignored.
 *   - Classes / ids / inline styles are ignored.
 *   - Repeated identical sibling subtrees are COLLAPSED to one representative
 *     (so "4 contacts" and "1 contact" produce the same signature).
 *   - The interactive surface is DEDUPED (a set of role|name entries, not a count).
 *
 * Strategy C note: Playwright's `page.accessibility.snapshot()` was removed
 * from the typed API in 1.61. The role tree is derived directly from the DOM
 * (explicit `role` attr, else role inferred from tag) — deterministic and
 * dependency-free.
 */
export interface StateMaterials {
  /** Canonical absolute URL (sorted query, hash kept). */
  url: string;
  /** Depth-first tag tree of visible elements (with explicit roles), collapsed. */
  domTagTree: string;
  /** Depth-first ARIA role+level tree (names dropped), collapsed. */
  a11yRoleTree: string;
  /** Deduped, sorted "role|name" entries of visible interactive elements. */
  interactive: string[];
  /** Component-presence flags as a stable string. */
  components: string;
  /** Deduped, sorted labels of items inside nav landmarks. */
  navSignature: string;
}

/** Tag → ARIA role inference fallback (used only when no explicit `role` attr). */
export const ROLE_BY_TAG: Record<string, string> = {
  button: 'button',
  a: 'link',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  header: 'banner',
  footer: 'contentinfo',
  form: 'form',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  thead: 'rowgroup',
  tbody: 'rowgroup',
  tr: 'row',
  td: 'cell',
  th: 'columnheader',
  select: 'combobox',
  textarea: 'textbox',
  dialog: 'dialog',
  summary: 'button',
  img: 'img',
  figure: 'figure',
  section: 'region',
  article: 'article',
  search: 'search',
};

/**
 * Browser-side extraction. Runs inside `page.evaluate`. Receives `roleByTag`
 * as an argument (it cannot close over Node-side values once serialized).
 * Returns everything EXCEPT the URL, which is canonicalized on the Node side.
 */
export function extractMaterials(
  roleByTag: Record<string, string>
): {
  domTagTree: string;
  a11yRoleTree: string;
  interactive: string[];
  components: string;
  navSignature: string;
} {
  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    );
  };

  /** Collapse consecutive identical sibling signatures → count-invariant. */
  const collapse = (sigs: string[]): string[] => {
    const out: string[] = [];
    for (const sig of sigs) {
      if (out.length === 0 || out[out.length - 1] !== sig) out.push(sig);
    }
    return out;
  };

  const inferRole = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'button';
      if (type === 'search') return 'searchbox';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    return roleByTag[tag] || 'generic';
  };

  const inferLevel = (el: Element): number | undefined => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return Number(tag[1]);
    const aria = el.getAttribute('aria-level');
    return aria ? Number(aria) : undefined;
  };

  // DOM tag tree (visible only, collapsed).
  const walkTags = (el: Element, depth: number): string => {
    if (!isVisible(el)) return '';
    const tag = el.tagName.toLowerCase();
    const explicit = el.getAttribute('role');
    const self = '\n' + '  '.repeat(depth) + (explicit ? `${tag}[${explicit}]` : tag);
    const childSigs = Array.from(el.children)
      .map((c) => walkTags(c, depth + 1))
      .filter((s) => s !== '');
    return self + collapse(childSigs).join('');
  };

  // ARIA role tree (visible only, names dropped, collapsed).
  const walkRoles = (el: Element, depth: number): string => {
    if (!isVisible(el)) return '';
    const role = inferRole(el);
    const level = inferLevel(el);
    const self = '\n' + '  '.repeat(depth) + role + (level ? `[${level}]` : '');
    const childSigs = Array.from(el.children)
      .map((c) => walkRoles(c, depth + 1))
      .filter((s) => s !== '');
    return self + collapse(childSigs).join('');
  };

  const domTagTree = walkTags(document.body, 0);
  const a11yRoleTree = walkRoles(document.body, 0);

  // Interactive surface (deduped).
  const interactive = new Set<string>();
  document.querySelectorAll(
    'button, [role="button"], a[href], input, select, textarea, [role="link"], [role="tab"], [role="menuitem"]'
  ).forEach((el) => {
    if (!isVisible(el)) return;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name =
      (el.textContent || '').trim() ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.getAttribute('id') ||
      '';
    interactive.add(`${role}|${name}`);
  });

  // Component flags.
  const modalEls = document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  );
  const searchEls = Array.from(
    document.querySelectorAll('input, [role="searchbox"], [role="search"]')
  ).filter((el) => {
    const hint =
      (el.getAttribute('role') || '') +
      ' ' +
      (el.getAttribute('aria-label') || '') +
      ' ' +
      (el.getAttribute('placeholder') || '') +
      ' ' +
      (el.getAttribute('type') || '');
    return /search/i.test(hint);
  });
  const components =
    `form:${document.querySelectorAll('form').length}` +
    `|table:${document.querySelectorAll('table').length}` +
    `|modal:${Array.from(modalEls).filter(isVisible).length}` +
    `|search:${searchEls.filter(isVisible).length}` +
    `|nav:${document.querySelectorAll('nav, [role="navigation"]').length}`;

  // Navigation signature.
  const navItems = new Set<string>();
  document.querySelectorAll('nav, [role="navigation"]').forEach((nav) => {
    nav.querySelectorAll(
      'a[href], button, [role="link"], [role="button"], [role="menuitem"]'
    ).forEach((el) => {
      if (!isVisible(el)) return;
      const label =
        (el.textContent || '').trim() || el.getAttribute('aria-label') || '';
      if (label) navItems.add(label);
    });
  });

  return {
    domTagTree,
    a11yRoleTree,
    interactive: Array.from(interactive).sort(),
    components,
    navSignature: Array.from(navItems).sort().join('|'),
  };
}

/**
 * Canonical URL: origin + pathname + sorted query + hash. Query params are
 * sorted so `?b=2&a=1` and `?a=1&b=2` produce the same fingerprint. The hash
 * is kept because SPA hash-routing encodes the route there.
 */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const params = Array.from(u.searchParams.entries())
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
      .map(([k, v]) => `${k}=${v}`);
    return (
      u.origin +
      u.pathname +
      (params.length ? `?${params.join('&')}` : '') +
      u.hash
    );
  } catch {
    return raw;
  }
}
