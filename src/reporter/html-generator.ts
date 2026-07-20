import { ReportData, ArtifactEntry } from './types';

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusClass(status: string): string {
  switch (status) {
    case 'passed':
      return 'status-passed';
    case 'failed':
    case 'timedOut':
    case 'interrupted':
      return 'status-failed';
    case 'skipped':
      return 'status-skipped';
    default:
      return 'status-unknown';
  }
}

function renderVideo(artifact: ArtifactEntry): string {
  return `<div class="artifact-section">
    <h4>Video Recording</h4>
    <video controls class="video-player" preload="metadata">
      <source src="${escapeHtml(artifact.path)}" type="video/webm">
    </video>
  </div>`;
}

function renderScreenshot(artifact: ArtifactEntry): string {
  return `<div class="screenshot-item">
    <a href="${escapeHtml(artifact.path)}" target="_blank">
      <img src="${escapeHtml(artifact.path)}" alt="${escapeHtml(artifact.name)}" loading="lazy" />
    </a>
  </div>`;
}

function renderConsoleLog(artifact: ArtifactEntry): string {
  const entries = Array.isArray(artifact.content) ? artifact.content : [];
  if (entries.length === 0) return '';

  const rows = entries
    .map((entry: any) => {
      const typeClass = `log-${escapeHtml(entry.type || 'info')}`;
      const time = entry.timestamp
        ? new Date(entry.timestamp).toLocaleTimeString()
        : '';
      return `<div class="log-row ${typeClass}">
        <span class="log-time">${escapeHtml(time)}</span>
        <span class="log-type">${escapeHtml(entry.type || 'info')}</span>
        <span class="log-text">${escapeHtml(entry.text || '')}</span>
      </div>`;
    })
    .join('');

  return `<div class="artifact-section">
    <h4>Console Logs <span class="count-badge">${entries.length}</span></h4>
    <div class="log-container">${rows}</div>
  </div>`;
}

function renderNetworkLog(artifact: ArtifactEntry): string {
  const entries = Array.isArray(artifact.content) ? artifact.content : [];
  if (entries.length === 0) return '';

  const rows = entries
    .map((entry: any, index: number) => {
      const req = entry.request || {};
      const resp = entry.response || {};
      const status = resp.status || '—';
      const statusClass = resp.status
        ? resp.status < 300
          ? 'net-pass'
          : resp.status < 400
            ? 'net-redirect'
            : 'net-fail'
        : 'net-pending';
      const method = escapeHtml(req.method || '—');
      const url = escapeHtml(req.url || '—');
      const truncatedUrl =
        url.length > 80 ? url.slice(0, 77) + '...' : url;

      return `<tr>
        <td>${index + 1}</td>
        <td><span class="method-badge">${method}</span></td>
        <td class="url-cell" title="${url}">${truncatedUrl}</td>
        <td><span class="status-badge ${statusClass}">${status}</span></td>
      </tr>`;
    })
    .join('');

  return `<div class="artifact-section">
    <h4>Network Logs <span class="count-badge">${entries.length}</span></h4>
    <div class="network-container">
      <table class="network-table">
        <thead>
          <tr><th>#</th><th>Method</th><th>URL</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function renderTrace(artifact: ArtifactEntry): string {
  return `<div class="artifact-section">
    <h4>Trace</h4>
    <a href="${escapeHtml(artifact.path)}" class="trace-link" target="_blank">
      Download trace.zip (open with <code>npx playwright show-trace trace.zip</code>)
    </a>
  </div>`;
}

function renderTestCard(
  test: any,
  index: number
): string {
  const videos = test.artifacts.filter((a: ArtifactEntry) => a.type === 'video');
  const screenshots = test.artifacts.filter((a: ArtifactEntry) => a.type === 'screenshot');
  const consoleLogs = test.artifacts.filter((a: ArtifactEntry) => a.type === 'console');
  const networkLogs = test.artifacts.filter((a: ArtifactEntry) => a.type === 'network');
  const traces = test.artifacts.filter((a: ArtifactEntry) => a.type === 'trace');

  const artifactBadges: string[] = [];
  if (videos.length) artifactBadges.push(`<span class="badge badge-video">Video</span>`);
  if (screenshots.length) artifactBadges.push(`<span class="badge badge-screenshot">Screenshots (${screenshots.length})</span>`);
  if (consoleLogs.length) artifactBadges.push(`<span class="badge badge-console">Console</span>`);
  if (networkLogs.length) artifactBadges.push(`<span class="badge badge-network">Network</span>`);
  if (traces.length) artifactBadges.push(`<span class="badge badge-trace">Trace</span>`);

  const details = [
    ...videos.map(renderVideo),
    `<div class="artifact-section"><h4>Screenshots</h4><div class="screenshot-grid">${screenshots.map(renderScreenshot).join('')}</div></div>`,
    ...consoleLogs.map(renderConsoleLog),
    ...networkLogs.map(renderNetworkLog),
    ...traces.map(renderTrace),
  ]
    .filter((s) => s.length > 0)
    .join('');

  return `<div class="test-card ${statusClass(test.status)}" data-index="${index}">
    <div class="test-header" onclick="this.parentElement.classList.toggle('expanded')">
      <div class="test-info">
        <span class="status ${statusClass(test.status)}">${escapeHtml(test.status)}</span>
        <span class="test-title">${escapeHtml(test.title)}</span>
      </div>
      <div class="test-meta">
        ${artifactBadges.join('')}
        <span class="duration">${test.duration}ms</span>
        <span class="chevron">&#9660;</span>
      </div>
    </div>
    <div class="test-body">${details}</div>
  </div>`;
}

export function generateHtmlReport(data: ReportData): string {
  const { summary, tests, generatedAt } = data;

  const testCards = tests.map((test, index) => renderTestCard(test, index)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReplayQA Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface-2: #243349;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --border: #334155;
      --pass: #22c55e;
      --fail: #ef4444;
      --skip: #eab308;
      --accent: #38bdf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      padding: 1.5rem 2rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    header h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    header p { color: var(--muted); font-size: 0.85rem; }
    main { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
    .summary {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .summary-card {
      background: var(--surface);
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      text-align: center;
      min-width: 100px;
      border: 1px solid var(--border);
    }
    .summary-card .value { font-size: 1.75rem; font-weight: 700; }
    .summary-card .label {
      color: var(--muted);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .test-card {
      background: var(--surface);
      border-radius: 0.5rem;
      margin-bottom: 0.75rem;
      border: 1px solid var(--border);
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .test-card.status-passed { border-left: 3px solid var(--pass); }
    .test-card.status-failed { border-left: 3px solid var(--fail); }
    .test-card.status-skipped { border-left: 3px solid var(--skip); }
    .test-card.status-unknown { border-left: 3px solid var(--muted); }
    .test-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.875rem 1rem;
      cursor: pointer;
      user-select: none;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .test-header:hover { background: var(--surface-2); }
    .test-info { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .test-title { font-weight: 600; font-size: 0.95rem; }
    .test-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .duration { color: var(--muted); font-size: 0.8rem; }
    .chevron { color: var(--muted); font-size: 0.7rem; transition: transform 0.2s; }
    .test-card.expanded .chevron { transform: rotate(180deg); }
    .status {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-passed { background: rgba(34,197,94,0.15); color: var(--pass); }
    .status-failed { background: rgba(239,68,68,0.15); color: var(--fail); }
    .status-skipped { background: rgba(234,179,8,0.15); color: var(--skip); }
    .status-unknown { background: rgba(148,163,184,0.15); color: var(--muted); }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.7rem;
      font-weight: 600;
    }
    .badge-video { background: rgba(56,189,248,0.15); color: var(--accent); }
    .badge-screenshot { background: rgba(168,85,247,0.15); color: #c084fc; }
    .badge-console { background: rgba(34,197,94,0.15); color: var(--pass); }
    .badge-network { background: rgba(251,146,60,0.15); color: #fb923c; }
    .badge-trace { background: rgba(234,179,8,0.15); color: var(--skip); }
    .test-body {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }
    .test-card.expanded .test-body { max-height: 100000px; }
    .test-body-inner { padding: 0 1rem 1rem 1rem; }
    .test-body > * { padding: 0 1rem 1rem 1rem; }
    .artifact-section { margin-top: 1rem; }
    .artifact-section h4 {
      font-size: 0.85rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .count-badge {
      background: var(--border);
      padding: 0.1rem 0.4rem;
      border-radius: 9999px;
      font-size: 0.7rem;
    }
    .video-player {
      width: 100%;
      max-width: 640px;
      border-radius: 0.5rem;
      border: 1px solid var(--border);
      background: #000;
    }
    .screenshot-grid { display: flex; flex-wrap: wrap; gap: 0.75rem; }
    .screenshot-item img {
      max-width: 320px;
      border-radius: 0.5rem;
      border: 1px solid var(--border);
      cursor: pointer;
      transition: transform 0.2s;
    }
    .screenshot-item img:hover { transform: scale(1.03); }
    .log-container {
      max-height: 400px;
      overflow-y: auto;
      background: #0d1117;
      border-radius: 0.5rem;
      border: 1px solid var(--border);
      padding: 0.5rem;
    }
    .log-row {
      display: flex;
      gap: 0.75rem;
      padding: 0.25rem 0.5rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      border-bottom: 1px solid rgba(51,65,85,0.3);
    }
    .log-time { color: var(--muted); white-space: nowrap; }
    .log-type {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.7rem;
      min-width: 50px;
    }
    .log-text { color: var(--text); word-break: break-word; }
    .log-error .log-type, .log-error .log-text { color: var(--fail); }
    .log-warning .log-type, .log-warning .log-text { color: var(--skip); }
    .log-info .log-type { color: var(--accent); }
    .network-container {
      max-height: 400px;
      overflow-y: auto;
      background: #0d1117;
      border-radius: 0.5rem;
      border: 1px solid var(--border);
    }
    .network-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .network-table th {
      background: var(--surface);
      padding: 0.5rem;
      text-align: left;
      font-size: 0.75rem;
      color: var(--muted);
      text-transform: uppercase;
      position: sticky;
      top: 0;
    }
    .network-table td {
      padding: 0.4rem 0.5rem;
      border-bottom: 1px solid rgba(51,65,85,0.3);
    }
    .url-cell {
      max-width: 350px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--muted);
    }
    .method-badge {
      background: var(--border);
      padding: 0.1rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .status-badge {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .net-pass { background: rgba(34,197,94,0.15); color: var(--pass); }
    .net-redirect { background: rgba(56,189,248,0.15); color: var(--accent); }
    .net-fail { background: rgba(239,68,68,0.15); color: var(--fail); }
    .net-pending { background: rgba(148,163,184,0.15); color: var(--muted); }
    .trace-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--accent);
      text-decoration: none;
      font-size: 0.85rem;
      padding: 0.5rem 0.75rem;
      background: var(--surface-2);
      border-radius: 0.375rem;
      border: 1px solid var(--border);
    }
    .trace-link:hover { background: var(--border); }
    .trace-link code {
      background: var(--bg);
      padding: 0.1rem 0.3rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
    }
    .no-tests { color: var(--muted); text-align: center; padding: 3rem; }
    .toolbar {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .toolbar button {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s;
    }
    .toolbar button:hover { background: var(--surface-2); border-color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <h1>ReplayQA Report</h1>
    <p>Generated at ${escapeHtml(generatedAt)}</p>
  </header>
  <main>
    <div class="summary">
      <div class="summary-card"><div class="value">${summary.total}</div><div class="label">Total</div></div>
      <div class="summary-card"><div class="value" style="color: var(--pass)">${summary.passed}</div><div class="label">Passed</div></div>
      <div class="summary-card"><div class="value" style="color: var(--fail)">${summary.failed}</div><div class="label">Failed</div></div>
      <div class="summary-card"><div class="value" style="color: var(--skip)">${summary.skipped}</div><div class="label">Skipped</div></div>
    </div>
    <div class="toolbar">
      <button onclick="document.querySelectorAll('.test-card').forEach(c => c.classList.add('expanded'))">Expand All</button>
      <button onclick="document.querySelectorAll('.test-card').forEach(c => c.classList.remove('expanded'))">Collapse All</button>
    </div>
    ${testCards || '<div class="no-tests">No tests found.</div>'}
  </main>
</body>
</html>`;
}
