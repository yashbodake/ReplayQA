import type {
  FailureCategory,
  StaticValidationResult,
  ValidationFinding,
} from './types.js';

/**
 * Static validation of generated Playwright code, BEFORE execution.
 *
 * Two kinds of work happen here:
 *   1. Deterministic AUTO-FIXES — safe, semantics-preserving transforms that
 *      remove trivial failures without invoking the LLM (e.g. wrapping a bare
 *      `.toBeVisible()` call in `expect(...)`).
 *   2. FINDINGS — issues flagged for the repair engine if execution still
 *      fails (e.g. `getByText` ambiguity, a hardcoded `toHaveCount`).
 *
 * The objective is to eliminate trivial failures before they ever reach
 * Playwright, so the LLM only gets invoked for genuinely hard mistakes.
 */
export function staticValidate(code: string): StaticValidationResult {
  const findings: ValidationFinding[] = [];
  let working = code;
  let changed = false;

  // 1 ── Syntax: bracket / quote balance. (A real parse is overkill; this
  // catches the common "truncated generation" and stray-token cases, and true
  // parse errors will also be caught + diagnosed at execution time.)
  const syntaxFinding = checkSyntax(code);
  if (syntaxFinding) findings.push(syntaxFinding);

  // 2 ── Auto-fix: wrap bare assertion calls in expect(...).
  const fixResult = autoWrapAssertions(working);
  working = fixResult.code;
  if (fixResult.findings.length > 0) {
    changed = true;
    findings.push(...fixResult.findings);
  }

  // 3 ── Flag (do not auto-fix) the patterns that commonly cause failures.
  findings.push(...flagPatterns(working));

  return {
    code: working,
    findings,
    hasSyntaxError: Boolean(syntaxFinding && syntaxFinding.severity === 'blocker'),
    changed,
  };
}

// ---------------------------------------------------------------------------

const SYNTAX_ERRORS = new Set<FailureCategory>(['syntax']);

function checkSyntax(code: string): ValidationFinding | null {
  const pairs: Array<[string, string]> = [['(', ')'], ['{', '}'], ['[', ']']];
  for (const [open, close] of pairs) {
    const depth = balance(code, open, close);
    if (depth !== 0) {
      return {
        category: 'syntax',
        severity: 'blocker',
        message: `Unbalanced '${open}${close}' (depth ${depth > 0 ? '+' : ''}${depth})`,
      };
    }
  }
  return null;
}

/** Depth != 0 means unbalanced (ignores brackets inside strings/regex roughly). */
function balance(code: string, open: string, close: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (inString) {
      if (c === inString && code[i - 1] !== '\\') inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) depth--;
  }
  return depth;
}

const ASSERTION_METHODS = [
  'toBeVisible', 'toBeHidden', 'toBeEnabled', 'toBeDisabled', 'toBeEditable',
  'toBeChecked', 'toBeEmpty', 'toBeFocused', 'toBe', 'toHaveText',
  'toContainText', 'toHaveValue', 'toHaveAttribute', 'toHaveClass', 'toHaveCount',
  'toHaveCSS', 'toHaveId', 'toHaveLength', 'toHaveTitle', 'toHaveURL',
].join('|');

const ASSERT_CALL =
  new RegExp(`^(\\s*await\\s+)(.+?)\\.(${ASSERTION_METHODS})\\(([\\s\\S]*?)\\);?\\s*$`);

/** Deterministic fix: `await EXPR.toBeVisible(...)` → `await expect(EXPR).toBeVisible(...)`. */
function autoWrapAssertions(code: string): { code: string; findings: ValidationFinding[] } {
  const findings: ValidationFinding[] = [];
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('expect(')) continue; // already wrapped
    const m = line.match(ASSERT_CALL);
    if (!m) continue;
    const [, prefix, expr, method, args] = m;
    lines[i] = `${prefix}expect(${expr.trim()}).${method}(${args});`;
    findings.push({
      category: 'api-misuse',
      severity: 'fixable',
      message: `Bare ".${method}()" called on a locator instead of via expect().`,
      autoFixed: `Wrapped in expect(...).${method}()`,
    });
  }
  return { code: lines.join('\n'), findings };
}

/** Flag (not auto-fix) common generation anti-patterns. */
function flagPatterns(code: string): ValidationFinding[] {
  const out: ValidationFinding[] = [];
  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // getByText(...) without exact / .first() → strict-mode risk
    if (/\.getByText\(/.test(line) && !/exact\s*:/.test(line) && !/\.first\(\)/.test(line)) {
      out.push({
        category: 'strict-mode',
        severity: 'warning',
        message: `getByText() can match multiple elements; prefer exact:{true} or .first().`,
      });
    }
    // getByRole / getByLabel in a toBeVisible/toBe without .first() → strict-mode risk
    if (
      /(toBeVisible|toBe)\(\)/.test(line) &&
      /\.(getByRole|getByLabel)\(/.test(line) &&
      !/\.first\(\)/.test(line) &&
      !/exact\s*:/.test(line)
    ) {
      out.push({
        category: 'strict-mode',
        severity: 'warning',
        message: `Locator in assertion may resolve to multiple elements; add .first() or scope it.`,
      });
    }
    // Hardcoded toHaveCount(N)
    const countMatch = line.match(/\.toHaveCount\(\s*(\d+)\s*\)/);
    if (countMatch) {
      out.push({
        category: 'hardcoded-count',
        severity: 'warning',
        message: `Hardcoded toHaveCount(${countMatch[1]}); use .first().toBeVisible() unless the count is observed.`,
      });
    }
    // Brittle CSS / XPath selectors
    if (/page\.\$[\("]/.test(line) || (/page\.locator\(/.test(line) && !/data-testid/.test(line))) {
      out.push({
        category: 'brittle-selector',
        severity: 'warning',
        message: `CSS/locator selector is brittle; prefer getByRole / getByLabel.`,
      });
    }
    // Calling an assertion method directly on a locator (post-auto-fix: should be gone)
    if (ASSERT_CALL.test(line) && !line.includes('expect(')) {
      out.push({
        category: 'api-misuse',
        severity: 'warning',
        message: `Assertion method called on a locator across multiple lines (not auto-fixed).`,
      });
    }
  }
  return out;
}

/** Public helper: were any findings deterministically auto-fixed? */
export function countAutoFixed(findings: ValidationFinding[]): number {
  return findings.filter((f) => f.autoFixed).length;
}

export const _categoriesForTests = SYNTAX_ERRORS; // keep import-meaningful
