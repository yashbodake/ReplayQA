import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Inject a multi-scenario summary + run overview into the HTML report.
 *
 * Shows:
 *   - Run Overview: app name, URL, discovery stats, AI understanding, plan,
 *     audio config — a beautiful hero card at the top
 *   - Each scenario's test result (pass/fail) with its preserved video
 *   - The narration script text
 *
 * This is injected AFTER the Playwright reporter generates index.html (which
 * only shows the LAST test's results). We add the full picture on top.
 */

export interface ScenarioResult {
  id: string;
  title: string;
  passed: boolean;
  attempts: number;
  repairsUsed: number;
  durationMs: number;
}

export interface RunOverview {
  targetUrl: string;
  timestamp: string;
  pagesDiscovered: number;
  flowsDiscovered: number;
  appType?: string;
  entities?: string[];
  capabilities?: string[];
  reasoningConfidence?: number;
  totalScenarios: number;
  selectedCount: number;
  passedCount: number;
  failedCount: number;
  planConfidence?: number;
  ttsProvider?: string;
  ttsVoice?: string;
  narrationStyle?: string;
  musicTrack?: string;
  summaryDurationMs?: number;
}

export interface injectScenarioSummaryOptions {
  reportPath: string;
  scenarios: ScenarioResult[];
  videosDir: string;
  scriptPath?: string;
  narrationVideoPath?: string;
  overview?: RunOverview;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function injectScenarioSummary(opts: injectScenarioSummaryOptions): boolean {
  if (!existsSync(opts.reportPath)) return false;
  let html = readFileSync(opts.reportPath, 'utf-8');

  const START = '<!-- SCENARIO-SUMMARY-START -->';
  const END = '<!-- SCENARIO-SUMMARY-END -->';

  // Build the section.
  const parts: string[] = [];

  // ── RUN OVERVIEW (hero card at the top) ──────────────────────────────────
  if (opts.overview) {
    const ov = opts.overview;
    const appDomain = (() => { try { return new URL(ov.targetUrl).hostname; } catch { return ov.targetUrl; } })();
    const dateStr = (() => { try { return new Date(ov.timestamp).toLocaleString(); } catch { return ov.timestamp; } })();
    const durStr = ov.summaryDurationMs ? `${(ov.summaryDurationMs / 1000).toFixed(1)}s` : '';

    parts.push('<section class="run-overview" style="background:linear-gradient(135deg,#1a2236,#0f1421);border:1px solid #2a3450;border-radius:0.75rem;padding:1.5rem 2rem;margin-bottom:1.5rem;">');

    // Title row
    parts.push('<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">');
    parts.push('<div>');
    parts.push(`<div style="font-size:0.7rem;color:#6b7589;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.25rem;">ReplayQA Report</div>`);
    parts.push(`<h2 style="font-size:1.4rem;font-weight:700;margin:0;color:#e8edf5;">${esc(appDomain)}</h2>`);
    parts.push(`<div style="font-size:0.82rem;color:#6b7589;margin-top:0.2rem;"><a href="${esc(ov.targetUrl)}" target="_blank" style="color:#3b82f6;text-decoration:none;">${esc(ov.targetUrl)}</a></div>`);
    parts.push('</div>');
    parts.push(`<div style="text-align:right;font-size:0.78rem;color:#6b7589;">${esc(dateStr)}${durStr ? `<br><span style="color:#3b82f6;">▶ ${durStr} summary</span>` : ''}</div>`);
    parts.push('</div>');

    // Stats row
    parts.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;margin-bottom:1rem;">');
    parts.push(overviewStat('States', String(ov.pagesDiscovered)));
    parts.push(overviewStat('Flows', String(ov.flowsDiscovered)));
    parts.push(overviewStat('Scenarios', `${ov.selectedCount}/${ov.totalScenarios}`));
    parts.push(overviewStat('Passed', String(ov.passedCount), '#22c55e'));
    parts.push(overviewStat('Failed', String(ov.failedCount), ov.failedCount > 0 ? '#ef4444' : '#6b7589'));
    if (ov.reasoningConfidence !== undefined) parts.push(overviewStat('Confidence', `${Math.round(ov.reasoningConfidence * 100)}%`));
    parts.push('</div>');

    // App understanding
    if (ov.appType) {
      parts.push('<div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:0.5rem;padding:0.75rem 1rem;margin-bottom:0.75rem;">');
      parts.push(`<div style="font-size:0.7rem;color:#6b7589;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.3rem;">AI Understanding</div>`);
      parts.push(`<div style="font-size:0.9rem;color:#e8edf5;">${esc(ov.appType)}</div>`);
      if (ov.entities && ov.entities.length) {
        parts.push('<div style="margin-top:0.4rem;display:flex;gap:0.4rem;flex-wrap:wrap;">');
        for (const ent of ov.entities) {
          parts.push(`<span style="background:rgba(139,92,246,0.12);color:#a78bfa;padding:0.15rem 0.6rem;border-radius:9999px;font-size:0.72rem;">${esc(ent)}</span>`);
        }
        parts.push('</div>');
      }
    if (ov.capabilities && ov.capabilities.length) {
        parts.push('<div style="margin-top:0.4rem;display:flex;gap:0.4rem;flex-wrap:wrap;">');
        for (const cap of ov.capabilities.slice(0, 5)) {
          parts.push(`<span style="background:rgba(34,197,94,0.1);color:#22c55e;padding:0.12rem 0.5rem;border-radius:0.25rem;font-size:0.7rem;">${esc(cap)}</span>`);
        }
        if (ov.capabilities.length > 5) parts.push(`<span style="color:#6b7589;font-size:0.7rem;padding:0.12rem 0.5rem;">+${ov.capabilities.length - 5} more</span>`);
        parts.push('</div>');
      }
      parts.push('</div>');
    }

    // Audio config row
    if (ov.ttsProvider || ov.narrationStyle || ov.musicTrack) {
      parts.push('<div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:0.75rem;color:#6b7589;padding-top:0.5rem;border-top:1px solid #252e42;">');
      if (ov.ttsProvider) parts.push(`<span>🎤 <strong style="color:#e8edf5;">${esc(ov.ttsProvider)}</strong>${ov.ttsVoice ? ` (${esc(ov.ttsVoice)})` : ''}</span>`);
      if (ov.narrationStyle) parts.push(`<span>🎨 <strong style="color:#e8edf5;">${esc(ov.narrationStyle)}</strong></span>`);
      if (ov.musicTrack) parts.push(`<span>🎵 <strong style="color:#e8edf5;">${esc(ov.musicTrack)}</strong></span>`);
      parts.push('</div>');
    }

    parts.push('</section>');
  }

  // ── SCENARIO CARDS ───────────────────────────────────────────────────────
  parts.push('<section class="scenario-summary-section" style="margin-bottom:1.5rem;">');
  parts.push('<div class="artifact-section">');
  parts.push('<h4>Test Scenarios <span class="count-badge">' + opts.scenarios.length + '</span></h4>');

  const passed = opts.scenarios.filter(s => s.passed).length;
  const failed = opts.scenarios.length - passed;
  parts.push('<div style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">');
  parts.push('<div class="summary-card"><div class="value">' + opts.scenarios.length + '</div><div class="label">Total</div></div>');
  parts.push('<div class="summary-card"><div class="value" style="color:var(--pass)">' + passed + '</div><div class="label">Passed</div></div>');
  parts.push('<div class="summary-card"><div class="value" style="color:var(--fail)">' + failed + '</div><div class="label">Failed</div></div>');
  parts.push('</div>');

  // Per-scenario cards with videos
  for (const scn of opts.scenarios) {
    const statusColor = scn.passed ? 'var(--pass)' : 'var(--fail)';
    const statusText = scn.passed ? 'PASSED' : 'FAILED';
    const videoFile = scn.id + '.webm';
    const videoPath = resolve(opts.videosDir, videoFile);
    const hasVideo = existsSync(videoPath);
    // Compute relative path from reports/ to artifacts/videos/
    const videoRel = '../artifacts/videos/' + videoFile;

    parts.push('<div class="test-card status-' + (scn.passed ? 'passed' : 'failed') + '" style="margin-bottom:0.75rem;">');
    parts.push('<div class="test-header" onclick="this.parentElement.classList.toggle(\'expanded\')" style="display:flex;justify-content:space-between;align-items:center;padding:0.875rem 1rem;cursor:pointer;gap:0.5rem;flex-wrap:wrap;">');
    parts.push('<div class="test-info" style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">');
    parts.push('<span class="status status-' + (scn.passed ? 'passed' : 'failed') + '" style="display:inline-block;padding:0.2rem 0.6rem;border-radius:9999px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:' + (scn.passed ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)') + ';color:' + statusColor + ';">' + statusText + '</span>');
    parts.push('<span class="test-title" style="font-weight:600;font-size:0.95rem;">' + esc(scn.id) + ': ' + esc(scn.title) + '</span>');
    parts.push('</div>');
    parts.push('<div class="test-meta" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">');
    if (hasVideo) parts.push('<span class="badge badge-video">Video</span>');
    parts.push('<span style="color:var(--muted);font-size:0.8rem;">' + (scn.attempts > 1 ? scn.attempts + ' attempts, ' + scn.repairsUsed + ' repair(s)' : 'first try') + ' · ' + (scn.durationMs / 1000).toFixed(1) + 's</span>');
    parts.push('<span class="chevron" style="color:var(--muted);font-size:0.7rem;">▼</span>');
    parts.push('</div>');
    parts.push('</div>');
    parts.push('<div class="test-body" style="max-height:0;overflow:hidden;transition:max-height 0.3s ease;">');
    parts.push('<div style="padding:0 1rem 1rem 1rem;">');

    if (hasVideo) {
      parts.push('<div class="artifact-section" style="margin-top:0.5rem;">');
      parts.push('<h4>Execution Video</h4>');
      parts.push('<video controls class="video-player" preload="metadata" style="width:100%;max-width:640px;border-radius:0.5rem;border:1px solid var(--border);background:#000;">');
      parts.push('<source src="' + esc(videoRel) + '" type="video/webm">');
      parts.push('</video>');
      parts.push('</div>');
    }

    parts.push('</div>');
    parts.push('</div>');
    parts.push('</div>');
  }

  // Narration script text
  if (opts.scriptPath && existsSync(opts.scriptPath)) {
    const script = readFileSync(opts.scriptPath, 'utf-8');
    parts.push('<div class="artifact-section" style="margin-top:1rem;">');
    parts.push('<h4>Narration Script</h4>');
    parts.push('<div style="background:#0d1117;border-radius:0.5rem;border:1px solid var(--border);padding:1rem;font-size:0.82rem;line-height:1.7;white-space:pre-wrap;max-height:400px;overflow-y:auto;">' + esc(script) + '</div>');
    parts.push('</div>');
  }

  parts.push('</div>');
  parts.push('</section>');

  // CSS for expanded class
  parts.push('<style>.scenario-summary-section .test-card.expanded .test-body{max-height:2000px !important;}.scenario-summary-section .test-card.expanded .chevron{transform:rotate(180deg);}</style>');

  const section = START + '\n' + parts.join('\n') + '\n' + END;

  // Remove any prior scenario summary (idempotent).
  const re = new RegExp(escapeReg(START) + '[\\s\\S]*?' + escapeReg(END), 'g');
  html = html.replace(re, '');

  // Insert before </main> or at end of body.
  if (html.includes('</main>')) {
    html = html.replace('</main>', section + '\n</main>');
  } else {
    html = html.replace('</body>', section + '\n</body>');
  }

  writeFileSync(opts.reportPath, html, 'utf-8');
  return true;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function overviewStat(label: string, value: string, color?: string): string {
  const vColor = color || '#e8edf5';
  return `<div style="background:rgba(255,255,255,0.03);border:1px solid #252e42;border-radius:0.5rem;padding:0.6rem;text-align:center;">
    <div style="font-size:1.25rem;font-weight:700;color:${vColor};">${esc(value)}</div>
    <div style="font-size:0.68rem;color:#6b7589;text-transform:uppercase;letter-spacing:0.05em;margin-top:0.15rem;">${esc(label)}</div>
  </div>`;
}
