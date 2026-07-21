import type { GenerationOutcome } from './types.js';
import type { TestScenario } from '../../qa-planning-lab/types.js';
import type { Aggregate } from './metrics.js';

/**
 * Extended reliability HTML report. Alongside the existing execution dashboard
 * (reports/index.html), this document explains HOW ReplayQA reached a passing
 * test: every attempt, its failure category, the repair explanation, the
 * reliability metrics, and the final generated code.
 */
export function renderReliabilityReport(args: {
  scenario: TestScenario;
  outcome: GenerationOutcome;
  aggregate: Aggregate;
  appName: string;
}): string {
  const { scenario, outcome, aggregate, appName } = args;
  const lines: string[] = [];
  const status = outcome.passed ? 'PASSED' : 'FAILED';
  const statusColor = outcome.passed ? '#16a34a' : '#dc2626';

  lines.push('<!doctype html>');
  lines.push('<html lang="en"><head><meta charset="utf-8">');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  lines.push(`<title>ReplayQA Reliability Report — ${esc(scenario.title)}</title>`);
  lines.push('<style>');
  lines.push('body{font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:980px;margin:0 auto;padding:24px;color:#1f2937;background:#fafafa}');
  lines.push('h1,h2,h3{margin:24px 0 8px} h1{font-size:22px} h2{font-size:17px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}');
  lines.push('.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff}');
  lines.push('table{border-collapse:collapse;width:100%;background:#fff} th,td{border:1px solid #e5e7eb;padding:6px 9px;text-align:left;font-size:13px}');
  lines.push('th{background:#f3f4f6} code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}');
  lines.push('pre{background:#1e293b;color:#e2e8f0;padding:12px;border-radius:6px;overflow:auto;font-size:12px;line-height:1.45}');
  lines.push('.attempt{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;margin:10px 0}');
  lines.push('.meta{color:#6b7280;font-size:12px} .kv{display:flex;gap:6px} .kv b{min-width:120px;display:inline-block;color:#374151}');
  lines.push('.fail{color:#dc2626} .ok{color:#16a34a} .warn{color:#d97706}');
  lines.push('</style></head><body>');

  lines.push(`<h1>ReplayQA Reliability Report</h1>`);
  lines.push(`<div class="kv"><b>Status</b><span class="badge" style="background:${statusColor}">${status}</span></div>`);
  lines.push(`<div class="kv"><b>Application</b>${esc(appName)}</div>`);
  lines.push(`<div class="kv"><b>Scenario</b>${esc(scenario.title)} <span class="meta">[${scenario.priority}]</span></div>`);
  lines.push(`<div class="kv"><b>Attempts</b>${outcome.attempts.length} <span class="meta">(first-pass ${outcome.firstPassSuccess ? '✓' : '✗'}, repairs used ${outcome.repairAttemptsUsed})</span></div>`);
  lines.push(`<div class="kv"><b>Duration</b>${(outcome.totalDurationMs / 1000).toFixed(1)}s</div>`);

  // Metrics
  lines.push('<h2>Reliability Metrics (across all recorded runs)</h2>');
  lines.push('<table>');
  lines.push(`<tr><th>Total runs</th><td>${aggregate.totalRuns}</td></tr>`);
  lines.push(`<tr><th>Passed</th><td>${aggregate.passed} / ${aggregate.totalRuns}</td></tr>`);
  lines.push(`<tr><th>First-pass success rate</th><td><b>${pct(aggregate.firstPassSuccessRate)}</b></td></tr>`);
  lines.push(`<tr><th>Repair success rate</th><td>${pct(aggregate.repairSuccessRate)}</td></tr>`);
  lines.push(`<tr><th>Avg attempts</th><td>${aggregate.avgAttempts.toFixed(2)}</td></tr>`);
  lines.push(`<tr><th>Avg / median repairs used</th><td>${aggregate.avgRepairsUsed.toFixed(2)} / ${aggregate.medianRepairsUsed}</td></tr>`);
  lines.push(`<tr><th>Deterministic fixes applied</th><td>${aggregate.totalDeterministicallyFixed}</td></tr>`);
  lines.push('</table>');

  // Failure categories
  const cats = Object.entries(aggregate.failureCategoryCounts).sort((a, b) => b[1] - a[1]);
  if (cats.length > 0) {
    lines.push('<h2>Most Common Failure Categories</h2><table><tr><th>Category</th><th>Occurrences</th></tr>');
    for (const [k, v] of cats) lines.push(`<tr><td>${esc(k)}</td><td>${v}</td></tr>`);
    lines.push('</table>');
  }

  // Timeline
  lines.push('<h2>Repair Timeline</h2>');
  outcome.attempts.forEach((a, i) => {
    const passed = a.execution.passed;
    const head = `Attempt ${a.attemptNumber} — ${passed ? '<span class="ok">PASSED</span>' : '<span class="fail">FAILED</span>'} <span class="meta">(${a.source}, ${(a.execution.durationMs / 1000).toFixed(1)}s)</span>`;
    lines.push(`<div class="attempt"><div>${head}</div>`);
    const autoFixed = a.validation.findings.filter((f) => f.autoFixed);
    if (autoFixed.length > 0) {
      lines.push(`<div class="meta" style="margin-top:6px"><b>Deterministically fixed before execution:</b></div><ul class="meta">`);
      for (const f of autoFixed) lines.push(`<li>${esc(f.autoFixed)} — ${esc(f.message)}</li>`);
      lines.push('</ul>');
    }
    const warnings = a.validation.findings.filter((f) => !f.autoFixed);
    if (warnings.length > 0) {
      lines.push(`<div class="meta warn" style="margin-top:6px"><b>Static findings:</b> ${warnings.map((w) => esc(w.category)).join(', ')}</div>`);
    }
    if (a.execution.diagnostics) {
      const d = a.execution.diagnostics;
      lines.push(`<div class="meta" style="margin-top:6px">`);
      lines.push(`<div><b class="fail">Failure:</b> [${esc(d.errorType)}] ${esc(d.message)}</div>`);
      if (d.locator) lines.push(`<div><b>Locator:</b> <code>${esc(d.locator)}</code></div>`);
      if (d.codeLine) lines.push(`<div><b>Line:</b> <code>${esc(d.codeLine)}</code></div>`);
      if (d.expected) lines.push(`<div><b>Expected:</b> ${esc(d.expected)} · <b>Received:</b> ${esc(d.received)}</div>`);
      lines.push('</div>');
    }
    if (a.repair) {
      lines.push(`<div class="meta" style="margin-top:8px;padding-top:6px;border-top:1px dashed #e5e7eb"><b>Repair applied:</b></div>`);
      lines.push(`<div class="meta"><b>Why failed:</b> ${esc(a.repair.whyFailed)}</div>`);
      lines.push(`<div class="meta"><b>What changed:</b> ${esc(a.repair.whatChanged)}</div>`);
      lines.push(`<div class="meta"><b>Why it should succeed:</b> ${esc(a.repair.whyShouldSucceed)}</div>`);
    }
    lines.push('</div>');
    if (i < outcome.attempts.length - 1) lines.push('<hr style="border:none;border-top:1px solid #e5e7eb">');
  });

  // Final code
  lines.push('<h2>Final Generated Test</h2>');
  lines.push(`<pre>${esc(outcome.finalCode)}</pre>`);

  lines.push('</body></html>');
  return lines.join('\n');
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function esc(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
