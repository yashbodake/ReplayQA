import { chromium } from 'playwright';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import type { RawSnapshot } from '../models/snapshot.js';
import type { NavLink } from '../models/nav.js';
import type { FormInfo, InputInfo, TableInfo } from '../models/result.js';
import type { Selector } from './selector.js';
import { canonicalUrl, extractMaterials, ROLE_BY_TAG } from './materials.js';
import type { StateMaterials } from './materials.js';
import type { ActionCandidate } from './selector.js';

/** Playwright does not export `AriaRole`; derive it from getByRole's signature. */
type AriaRole = Parameters<Page['getByRole']>[0];

/**
 * tsx (esbuild) injects a `__name(target, value)` helper into function bodies
 * for name preservation. Functions passed to `page.evaluate` are serialized
 * and run in the browser, where that helper does not exist. Defining it here
 * (as a plain string so tsx leaves it alone) makes every `page.evaluate` work.
 */
const INIT_SCRIPT =
  'globalThis.__name = (t, v) => { try { Object.defineProperty(t, "name", { value: v, configurable: true }); } catch (e) {} return t; };';

export interface BrowserControllerOptions {
  headed?: boolean;
  /** The target app's origin; used for same-origin link filtering. */
  origin: string;
}

/**
 * The ONLY module that imports Playwright. All browser interaction in the
 * Discovery Engine goes through this class. It owns no discovery semantics —
 * it exposes generic primitives (open/close/goto/click/fill/waitForStable/
 * currentSnapshot/currentNavLinks) and returns plain data shapes.
 *
 * Corresponds to docs/discovery/03-modules.md §3.2 (Browser Controller). This
 * is the Milestone-0.5 seed: no budget enforcement, no origin/safety policy
 * beyond link filtering — those arrive with the full architecture.
 */
export class BrowserController {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private readonly origin: string;
  private readonly headed: boolean;

  constructor(options: BrowserControllerOptions) {
    this.origin = options.origin;
    this.headed = options.headed ?? false;
  }

  async open(): Promise<void> {
    this.browser = await chromium.launch({
      headless: !this.headed,
      slowMo: this.headed ? 200 : 0,
    });
    this.context = await this.browser.newContext();
    await this.context.addInitScript(INIT_SCRIPT);
    this.page = await this.context.newPage();
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
  }

  async goto(url: string, options: { timeout?: number } = {}): Promise<void> {
    await this.requirePage().goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeout ?? 30000,
    });
  }

  /**
   * Click the first match of `selector`. Returns true if an element existed
   * and was clicked, false if no element matched (so callers can fall back).
   * Throws on Playwright action errors, matching raw Playwright behaviour.
   */
  async click(selector: Selector, options: { timeout?: number } = {}): Promise<boolean> {
    const locator = this.resolve(selector);
    if ((await locator.count()) === 0) return false;
    await locator.click(this.clickOptions(options));
    return true;
  }

  async fill(
    selector: Selector,
    value: string,
    options: { timeout?: number } = {}
  ): Promise<void> {
    await this.resolve(selector).fill(value, this.clickOptions(options));
  }

  async pressEnter(selector: Selector): Promise<void> {
    await this.resolve(selector).press('Enter');
  }

  /** Wait for the page to settle (network idle). No-op-ish on timeout. */
  async waitForStable(timeoutMs = 8000): Promise<void> {
    await this.requirePage()
      .waitForLoadState('networkidle', { timeout: timeoutMs })
      .catch(() => undefined);
  }

  /** Current absolute URL of the page (empty string before open()). */
  currentUrl(): string {
    return this.page?.url() ?? '';
  }

  /** Raw DOM observation of the current page, in a single round-trip. */
  async currentSnapshot(): Promise<RawSnapshot> {
    const page = this.requirePage();
    return page.evaluate((): RawSnapshot => {
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

      const labelOf = (el: Element): string =>
        (el.textContent || '').trim() ||
        el.getAttribute('aria-label') ||
        el.getAttribute('value') ||
        el.getAttribute('title') ||
        '';

      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"]')
      )
        .filter(isVisible)
        .map(labelOf)
        .filter(Boolean);

      const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(isVisible)
        .map(labelOf)
        .filter(Boolean);

      const forms: FormInfo[] = Array.from(document.querySelectorAll('form'))
        .filter(isVisible)
        .map((form) => {
          const fields = Array.from(
            form.querySelectorAll('input, select, textarea')
          )
            .filter(isVisible)
            .map(
              (i) =>
                i.getAttribute('aria-label') ||
                i.getAttribute('placeholder') ||
                i.getAttribute('name') ||
                i.getAttribute('id') ||
                ''
            )
            .filter(Boolean);

          const submitEl = form.querySelector(
            'button[type="submit"], input[type="submit"], button'
          );
          const submit = submitEl
            ? (submitEl.textContent || '').trim() ||
              submitEl.getAttribute('aria-label') ||
              ''
            : '';

          return { fields, submit: submit || undefined };
        });

      const tables: TableInfo[] = Array.from(document.querySelectorAll('table'))
        .filter(isVisible)
        .map((table) => {
          const headers = Array.from(table.querySelectorAll('th'))
            .map((h) => (h.textContent || '').trim())
            .filter(Boolean);
          const rowCount = table.querySelectorAll('tbody tr').length;
          return { headers, rowCount };
        });

      const inputs: InputInfo[] = Array.from(
        document.querySelectorAll('input, select, textarea')
      )
        .filter(isVisible)
        .map((i) => ({
          name:
            i.getAttribute('aria-label') ||
            i.getAttribute('placeholder') ||
            i.getAttribute('name') ||
            i.getAttribute('id') ||
            undefined,
          type: i.getAttribute('type') || i.tagName.toLowerCase(),
        }));

      const h1 = document.querySelector('h1');
      const h2 = document.querySelector('h2');
      const heading =
        h1 && isVisible(h1)
          ? (h1.textContent || '').trim()
          : h2 && isVisible(h2)
          ? (h2.textContent || '').trim()
          : '';

      const hasPassword = Array.from(
        document.querySelectorAll('input[type="password"]')
      ).some(isVisible);

      return { heading, hasPassword, buttons, links, forms, tables, inputs };
    });
  }

  /**
   * State-fingerprint materials for the current page (Strategy E inputs), in a
   * single round-trip. Used by the StateManager to compute `stateId`. The
   * extraction function and role map live in `./materials.ts` and are shared
   * with the state-lab so production and regression tests cannot drift.
   */
  async currentMaterials(): Promise<StateMaterials> {
    const page = this.requirePage();
    const extracted = await page.evaluate(extractMaterials, ROLE_BY_TAG);
    return { ...extracted, url: canonicalUrl(page.url()) };
  }

  /**
   * Visible same-origin navigable anchors. The controller filters
   * cross-origin and non-navigable schemes (mailto/tel/javascript).
   * Exploration policy (e.g. logout) is left to the caller.
   */
  async currentNavLinks(): Promise<NavLink[]> {
    const page = this.requirePage();
    const raw = await page.evaluate((): { text: string; href: string }[] => {
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
      return Array.from(document.querySelectorAll('a[href]'))
        .filter(isVisible)
        .map((a) => ({
          text:
            (a.textContent || '').trim() || a.getAttribute('aria-label') || '',
          href: (a as HTMLAnchorElement).href,
        }))
        .filter((l) => l.text && l.href);
    });

    const out: NavLink[] = [];
    for (const link of raw) {
      const lower = link.href.toLowerCase();
      if (
        lower.startsWith('mailto:') ||
        lower.startsWith('tel:') ||
        lower.startsWith('javascript:')
      ) {
        continue;
      }
      let url: URL;
      try {
        url = new URL(link.href);
      } catch {
        continue;
      }
      if (url.origin !== this.origin) continue;
      out.push({
        text: link.text,
        href: link.href,
        path: url.pathname + url.search,
      });
    }
    return out;
  }

  /**
   * Enumerate ALL visible interactive elements on the page, tagged by type:
   * buttons, action-links, text-inputs, tabs, and expanders. Deduped by
   * label within each type. This generalizes the old button-only enumeration
   * so the probe system can discover interactions regardless of HTML tag.
   */
  async currentActions(): Promise<ActionCandidate[]> {
    const page = this.requirePage();
    const raw = await page.evaluate((): Array<{
      label: string;
      type: string;
      role?: string;
      name?: string;
      placeholder?: string;
      labelText?: string;
      css?: string;
    }> => {
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
      const seen = new Set<string>();
      const out: Array<{ label: string; type: string; role?: string; name?: string; placeholder?: string; labelText?: string; css?: string }> = [];
      const push = (entry: typeof out[0]) => {
        const key = `${entry.type}:${entry.label}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(entry);
        }
      };

      // 1. Buttons (<button>, [role="button"])
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        if (!isVisible(el)) return;
        const label = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        const clean = label.split('\n')[0].trim().slice(0, 80);
        if (clean) push({ label: clean, type: 'button', role: 'button', name: clean });
      });

      // 2. Action Links (<a> NOT in nav landmarks, NOT external/download/mailto)
      document.querySelectorAll('a[href]').forEach((el) => {
        if (!isVisible(el)) return;
        if (el.closest('nav, [role="navigation"]')) return; // nav links handled separately
        const href = el.getAttribute('href') || '';
        if (/^(javascript:|mailto:|tel:)/i.test(href)) return;
        // Note: href="#" is NOT filtered — SPA apps (SauceDemo, React Router)
        // use href="#" with click handlers for in-app navigation.
        try {
          const url = new URL((el as HTMLAnchorElement).href);
          if (url.origin !== location.origin) return; // external
        } catch { return; }
        const label = (el.textContent || '').trim() || el.getAttribute('aria-label') || '';
        const clean = label.split('\n')[0].trim().slice(0, 80);
        if (clean) push({ label: clean, type: 'link', role: 'link', name: clean });
      });

      // 3. Text Inputs (text/search/textarea, not password/readonly/disabled)
      document.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="range"]):not([type="color"]):not([type="date"]):not([type="time"]):not([type="datetime-local"]):not([type="month"]):not([type="week"]), textarea').forEach((el) => {
        if (!isVisible(el)) return;
        if (el.getAttribute('readonly') || el.getAttribute('disabled')) return;
        const ph = el.getAttribute('placeholder') || '';
        const aria = el.getAttribute('aria-label') || '';
        const name = el.getAttribute('name') || '';
        const id = el.getAttribute('id') || '';
        const label = ph || aria || name || id || 'text input';
        const clean = label.slice(0, 60);
        if (ph) push({ label: clean, type: 'input', placeholder: ph });
        else if (aria) push({ label: clean, type: 'input', labelText: aria });
        else if (id) push({ label: clean, type: 'input', css: `#${id}` });
        else if (name) push({ label: clean, type: 'input', css: `input[name="${name}"]` });
      });

      // 4. Tabs ([role="tab"])
      document.querySelectorAll('[role="tab"]').forEach((el) => {
        if (!isVisible(el)) return;
        if (el.getAttribute('aria-selected') === 'true') return; // already active
        const label = (el.textContent || '').trim() || el.getAttribute('aria-label') || 'tab';
        push({ label, type: 'tab', role: 'tab', name: label });
      });

      // 5. Expanders (details > summary, [aria-expanded], [aria-controls])
      document.querySelectorAll('details > summary, [aria-expanded], [aria-controls]').forEach((el) => {
        if (!isVisible(el)) return;
        const expanded = el.getAttribute('aria-expanded');
        if (expanded === 'true') return; // already expanded
        const label = (el.textContent || '').trim() || el.getAttribute('aria-label') || 'expander';
        const clean = label.split('\n')[0].trim().slice(0, 60);
        if (clean) push({ label: clean, type: 'expander', role: 'button', name: clean });
      });

      return out;
    });

    return raw.map((r) => {
      let selector: import('./selector.js').Selector;
      if (r.role) selector = { role: r.role, name: r.name };
      else if (r.placeholder) selector = { placeholder: r.placeholder };
      else if (r.labelText) selector = { label: r.labelText };
      else if (r.css) selector = r.css;
      else selector = r.label;
      return {
        label: r.label,
        selector,
        type: r.type as ActionCandidate['type'],
      };
    });
  }

  /** Press Escape — used by the probe runner to dismiss modals/drawers. */
  async pressEscape(): Promise<void> {
    await this.requirePage().keyboard.press('Escape');
  }

  /** Reload the current page — the reliable "reset to base" for SPAs. */
  async reload(): Promise<void> {
    await this.requirePage().reload({ waitUntil: 'domcontentloaded' });
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error('BrowserController is not open. Call open() first.');
    }
    return this.page;
  }

  private resolve(selector: Selector): Locator {
    const page = this.requirePage();
    if (typeof selector === 'string') {
      return page.locator(selector).first();
    }
    if ('role' in selector) {
      return page.getByRole(selector.role as AriaRole, { name: selector.name }).first();
    }
    if ('placeholder' in selector) {
      return page.getByPlaceholder(selector.placeholder).first();
    }
    if ('label' in selector) {
      return page.getByLabel(selector.label).first();
    }
    return page.locator('body').first();
  }

  private clickOptions(options: { timeout?: number }):
    | { timeout: number }
    | undefined {
    return options.timeout !== undefined ? { timeout: options.timeout } : undefined;
  }
}
