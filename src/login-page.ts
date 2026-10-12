function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function loginPage(error: string | null): string {
  const message = error === null ? "" : `<p class="error">${escapeHtml(error)}</p>`;
  return page(`<form method="post" action="/login">
  <h1>sub2api</h1>
  <p>Sign in to open the CPA dashboard.</p>
  ${message}
  <input type="password" name="password" autocomplete="current-password" placeholder="Dashboard password" required autofocus>
  <button type="submit">Sign in</button>
</form>`);
}

export function messagePage(title: string, text: string, failed: boolean): string {
  return page(`<form method="get" action="/management.html">
  <h1>${escapeHtml(title)}</h1>
  <p${failed ? ' class="error"' : ""}>${escapeHtml(text)}</p>
  <button type="submit">Open the dashboard</button>
</form>`);
}

function page(content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sub2api</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f4; --card: #fff; --text: #1d1d1b; --muted: #6b6b66; --line: #d9d9d4; --accent: #2f5bd3; --error: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151514; --card: #1f1f1d; --text: #ededea; --muted: #a3a39d; --line: #3a3a36; --accent: #8aa8ff; --error: #ff8a80; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  form { width: min(360px, calc(100vw - 32px)); background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px; box-sizing: border-box; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0 0 16px; color: var(--muted); }
  .error { color: var(--error); }
  input, button { width: 100%; box-sizing: border-box; font: inherit; padding: 10px 12px; border-radius: 8px; }
  input { border: 1px solid var(--line); background: transparent; color: inherit; margin-bottom: 12px; }
  button { border: 0; background: var(--accent); color: #fff; cursor: pointer; }
</style>
</head>
<body>
${content}
</body>
</html>
`;
}
