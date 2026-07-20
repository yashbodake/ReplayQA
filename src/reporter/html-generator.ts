import { ReportData } from './types';

function escapeHtml(input: string): string {
  return input
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

export function generateHtmlReport(data: ReportData): string {
  const { summary, tests, generatedAt } = data;

  const testRows = tests
    .map((test) => {
      const artifactLinks = test.artifacts
        .map((artifact) => {
          const label = artifactTypeLabel(artifact.type);
          return `<a class="artifact-link" href="${escapeHtml(artifact.path)}" target="_blank">
            <span class="artifact-type">${escapeHtml(label)}</span> ${escapeHtml(artifact.name)}
          </a>`;
        })
        .join('');

      return `
        <tr>
          <td>${escapeHtml(test.title)}</td>
          <td>${escapeHtml(test.project)}</td>
          <td><span class="status ${statusClass(test.status)}">${escapeHtml(test.status)}</span></td>
          <td>${test.duration}ms</td>
          <td>${artifactLinks}</td>
        </tr>
      `;
    })
    .join('');

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
      --text: #e2e8f0;
      --muted: #94a3b8;
      --pass: #22c55e;
      --fail: #ef4444;
      --skip: #eab308;
      --accent: #38bdf8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      padding: 1.5rem 2rem;
      border-bottom: 1px solid #334155;
      background: var(--surface);
    }
    header h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
    header p { margin: 0; color: var(--muted); font-size: 0.875rem; }
    main { padding: 2rem; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .card {
      background: var(--surface);
      padding: 1rem;
      border-radius: 0.5rem;
      text-align: center;
    }
    .card .value {
      font-size: 2rem;
      font-weight: 700;
      display: block;
    }
    .card .label {
      color: var(--muted);
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border-radius: 0.5rem;
      overflow: hidden;
    }
    th, td {
      padding: 0.875rem 1rem;
      text-align: left;
      border-bottom: 1px solid #334155;
    }
    th {
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      background: #0f172a;
    }
    tr:last-child td { border-bottom: none; }
    .status {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-passed { background: rgba(34, 197, 94, 0.15); color: var(--pass); }
    .status-failed { background: rgba(239, 68, 68, 0.15); color: var(--fail); }
    .status-skipped { background: rgba(234, 179, 8, 0.15); color: var(--skip); }
    .status-unknown { background: rgba(148, 163, 184, 0.15); color: var(--muted); }
    .artifact-link {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      margin-right: 0.75rem;
      color: var(--accent);
      text-decoration: none;
      font-size: 0.875rem;
    }
    .artifact-link:hover { text-decoration: underline; }
    .artifact-type {
      display: inline-block;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      background: #334155;
      color: var(--muted);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  </style>
</head>
<body>
  <header>
    <h1>ReplayQA Report</h1>
    <p>Generated at ${escapeHtml(generatedAt)}</p>
  </header>
  <main>
    <div class="summary">
      <div class="card"><span class="value">${summary.total}</span><span class="label">Total</span></div>
      <div class="card"><span class="value" style="color: var(--pass)">${summary.passed}</span><span class="label">Passed</span></div>
      <div class="card"><span class="value" style="color: var(--fail)">${summary.failed}</span><span class="label">Failed</span></div>
      <div class="card"><span class="value" style="color: var(--skip)">${summary.skipped}</span><span class="label">Skipped</span></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Test</th>
          <th>Project</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Artifacts</th>
        </tr>
      </thead>
      <tbody>
        ${testRows}
      </tbody>
    </table>
  </main>
</body>
</html>
`;
}

function artifactTypeLabel(type: string): string {
  switch (type) {
    case 'video':
      return 'video';
    case 'screenshot':
      return 'png';
    case 'trace':
      return 'trace';
    case 'console':
      return 'console';
    case 'network':
      return 'network';
    default:
      return 'file';
  }
}
