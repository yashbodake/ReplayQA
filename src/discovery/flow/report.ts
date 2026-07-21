import type { Journey, FlowGraph } from './journey-builder.js';

/**
 * Render a self-contained HTML report visualizing the flow graph and
 * discovered journeys. States are boxes; actions are labeled arrows;
 * journeys are listed with step-by-step descriptions.
 */
export function renderFlowReport(graph: FlowGraph, journeys: Journey[], appName: string): string {
  const lines: string[] = [];
  lines.push('<!doctype html><html lang="en"><head><meta charset="utf-8">');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  lines.push(`<title>ReplayQA Flow Report — ${esc(appName)}</title>`);
  lines.push('<style>');
  lines.push('body{font:14px/1.5 -apple-system,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1f2937;background:#fafafa}');
  lines.push('h1{font-size:22px} h2{font-size:17px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-top:28px}');
  lines.push('.node{display:inline-block;background:#fff;border:2px solid #3b82f6;border-radius:8px;padding:8px 14px;margin:6px;font-weight:600}');
  lines.push('.arrow{color:#6b7280;font-size:13px;text-align:center;margin:2px 0}');
  lines.push('.changes{color:#059669;font-size:12px;margin-left:20px}');
  lines.push('.journey{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;margin:10px 0}');
  lines.push('.skip{color:#dc2626;font-size:12px} pre{background:#1e293b;color:#e2e8f0;padding:12px;border-radius:6px;overflow:auto;font-size:12px}');
  lines.push('</style></head><body>');

  lines.push(`<h1>ReplayQA Flow Report</h1>`);
  lines.push(`<p><b>Application:</b> ${esc(appName)} · <b>States:</b> ${graph.nodes.length} · <b>Transitions:</b> ${graph.edges.length} · <b>Journeys:</b> ${journeys.length}</p>`);

  // Flow graph visualization
  lines.push('<h2>State Transition Graph</h2>');
  if (graph.edges.length === 0) {
    lines.push('<p><i>No transitions recorded.</i></p>');
  } else {
    for (const e of graph.edges) {
      const fromNode = graph.nodes.find((n) => n.stateId === e.from);
      const toNode = graph.nodes.find((n) => n.stateId === e.to);
      lines.push(`<div class="node">${esc(fromNode?.label ?? e.from.slice(0, 8))}</div>`);
      lines.push(`<div class="arrow">↓ <b>${esc(e.action)}</b> ↓</div>`);
      if (e.changes && e.changes.length > 0) {
        lines.push(`<div class="changes">${e.changes.map((c) => '• ' + esc(c)).join('<br>')}</div>`);
      }
      lines.push(`<div class="node">${esc(toNode?.label ?? e.to.slice(0, 8))}</div>`);
      lines.push('<hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0">');
    }
  }

  // Skipped actions
  if (graph.skipped.length > 0) {
    lines.push('<h2>Skipped Actions (Safety Policy)</h2>');
    lines.push('<ul>');
    for (const s of graph.skipped) {
      lines.push(`<li class="skip"><b>${esc(s.action)}</b> [${esc(s.classification)}] — ${esc(s.reason)}</li>`);
    }
    lines.push('</ul>');
  }

  // Journeys
  lines.push('<h2>Discovered Journeys</h2>');
  if (journeys.length === 0) {
    lines.push('<p><i>No complete journeys discovered.</i></p>');
  } else {
    for (const j of journeys) {
      lines.push(`<div class="journey">`);
      lines.push(`<b>${esc(j.description)}</b> <span style="color:#6b7280">(${j.length} steps)</span>`);
      lines.push(`<pre>${esc(j.steps.map((s) => `${s.fromLabel} —${s.action}→ ${s.toLabel}${s.changes.length ? '\n  changes: ' + s.changes.join('; ') : ''}`).join('\n'))}</pre>`);
      lines.push(`</div>`);
    }
  }

  lines.push('</body></html>');
  return lines.join('\n');
}

function esc(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
