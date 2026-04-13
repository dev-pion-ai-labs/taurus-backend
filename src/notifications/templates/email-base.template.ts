export function wrapEmailTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; color: #18181b; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .logo { font-size: 24px; font-weight: 700; color: #7c3aed; margin-bottom: 24px; }
    h2 { font-size: 20px; font-weight: 600; margin: 0 0 16px; }
    p { font-size: 15px; line-height: 1.6; color: #3f3f46; margin: 0 0 12px; }
    .btn { display: inline-block; background: #7c3aed; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; }
    .footer { text-align: center; padding: 24px 0 0; font-size: 13px; color: #a1a1aa; }
    .stat { display: inline-block; text-align: center; padding: 8px 16px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #7c3aed; }
    .stat-label { font-size: 12px; color: #71717a; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">TAURUS</div>
      ${content}
    </div>
    <div class="footer">
      <p>Powered by MARQAIT AI &mdash; Your AI Transformation Partner</p>
    </div>
  </div>
</body>
</html>`;
}
