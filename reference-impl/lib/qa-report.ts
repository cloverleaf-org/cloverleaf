export interface QaRunResult {
  ruleId: string;
  command: string;
  cwd: string;
  durationMs: number;
  passed: boolean;
  stdoutTail: string;
  stderrTail: string;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRow(r: QaRunResult): string {
  const status = r.passed ? 'PASS' : 'FAIL';
  const statusClass = r.passed ? 'pass' : 'fail';
  return `
    <tr class="${statusClass}">
      <td>${escape(r.ruleId)}</td>
      <td><code>${escape(r.command)}</code></td>
      <td>${escape(r.cwd)}</td>
      <td>${r.durationMs}ms</td>
      <td class="status">${status}</td>
    </tr>
    <tr class="detail ${statusClass}">
      <td colspan="5">
        ${r.stdoutTail ? `<details><summary>stdout (tail)</summary><pre>${escape(r.stdoutTail)}</pre></details>` : ''}
        ${r.stderrTail ? `<details open><summary>stderr (tail)</summary><pre>${escape(r.stderrTail)}</pre></details>` : ''}
      </td>
    </tr>
  `;
}

export function renderQaReport(runs: QaRunResult[]): string {
  const empty = runs.length === 0
    ? `<p class="empty">No runs / results.</p>`
    : '';
  const rows = runs.map(renderRow).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Cloverleaf QA Report</title>
  <style>
    body { font: 14px/1.4 system-ui, sans-serif; margin: 2rem; color: #111; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.5rem; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
    .status { font-weight: 600; }
    .pass .status { color: #0a7; }
    .fail .status { color: #c33; }
    tr.detail td { background: #fafafa; padding-top: 0; }
    pre { overflow: auto; background: #f4f4f4; padding: 0.5rem; }
    .empty { color: #888; }
  </style>
</head>
<body>
  <h1>Cloverleaf QA Report</h1>
  ${empty}
  ${runs.length > 0 ? `
  <table>
    <thead>
      <tr><th>Rule</th><th>Command</th><th>CWD</th><th>Duration</th><th>Status</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  ` : ''}
</body>
</html>`;
}
