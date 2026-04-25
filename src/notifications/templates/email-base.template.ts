/**
 * Brand palette (mirrored from frontend landing page / globals.css):
 *   stone-900 #1C1917  (foreground)
 *   stone-500 #78716C  (muted)
 *   stone-200 #E7E5E4  (border)
 *   rose-50  #FFF1F2 / rose-200 #FECACA / rose-600 #E11D48
 *   amber-100 #FEF3C7 / amber-200 #FDE68A / amber-700 #B45309
 *   orange-50 #FFF7ED
 *
 * Signature hero gradient: linear-gradient(135deg, #FEF3C7 0%, #FECACA 50%, #FDE68A 100%)
 * Email clients (esp. Outlook) ignore CSS gradients in style blocks; we keep a solid
 * fallback colour and layer the gradient on top so both worlds look intentional.
 */

interface WrapOptions {
  /** Visually subdues the header (smaller, no glow). Use for transactional emails like OTP. */
  minimalHeader?: boolean;
  /** Optional preheader — shown in inbox preview, hidden in body. */
  preheader?: string;
}

export function wrapEmailTemplate(
  content: string,
  options: WrapOptions = {},
): string {
  const { minimalHeader = false, preheader } = options;

  const headerBlock = minimalHeader
    ? `
      <tr>
        <td style="padding: 28px 32px 0; text-align: left;">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: linear-gradient(135deg, #E11D48 0%, #F59E0B 100%);"></span>
            <span style="font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #1C1917; text-transform: uppercase;">Taurus</span>
            <span style="font-size: 12px; color: #A8A29E; font-weight: 500;">by Marqait AI</span>
          </div>
        </td>
      </tr>`
    : `
      <tr>
        <td style="padding: 0;">
          <div style="background-color: #FEF3C7; background-image: linear-gradient(135deg, #FEF3C7 0%, #FECACA 45%, #FDE68A 100%); padding: 40px 32px 36px; border-radius: 16px 16px 0 0;">
            <div style="display: inline-flex; align-items: center; gap: 10px; padding: 6px 12px; background: rgba(255,255,255,0.65); border: 1px solid rgba(255,255,255,0.9); border-radius: 999px; backdrop-filter: blur(8px);">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: linear-gradient(135deg, #E11D48 0%, #F59E0B 100%); box-shadow: 0 0 0 3px rgba(225,29,72,0.15);"></span>
              <span style="font-size: 11px; font-weight: 600; letter-spacing: 1.5px; color: #78716C; text-transform: uppercase;">AI Transformation OS</span>
            </div>
            <div style="margin-top: 18px; font-size: 30px; font-weight: 800; letter-spacing: -0.02em; color: #1C1917; line-height: 1;">
              Taurus
            </div>
            <div style="margin-top: 6px; font-size: 13px; color: #78716C; font-weight: 500;">
              by Marqait AI
            </div>
          </div>
        </td>
      </tr>`;

  const preheaderBlock = preheader
    ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; visibility:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F5F5F4;">${preheader}</div>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Taurus</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
    a { color: #E11D48; text-decoration: none; }
    h1, h2, h3, p { margin: 0; }
    .btn:hover { transform: translateY(-1px); }
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; padding: 16px !important; }
      .card { padding: 24px !important; }
      .header-pad { padding: 32px 24px 28px !important; }
      .otp-code { font-size: 36px !important; letter-spacing: 10px !important; }
      .stat-row { display: block !important; }
      .stat { display: block !important; padding: 12px 0 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #FAFAF9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1C1917;">
  ${preheaderBlock}
  <div style="background-color: #FAFAF9; background-image: linear-gradient(180deg, #FFF7ED 0%, #FAFAF9 220px); padding: 32px 16px;">
    <table role="presentation" class="container" cellpadding="0" cellspacing="0" border="0" width="600" align="center" style="width: 600px; max-width: 600px; margin: 0 auto;">
      <tr>
        <td>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 2px rgba(28,25,23,0.04), 0 8px 24px rgba(28,25,23,0.06); border: 1px solid #E7E5E4;">
            ${headerBlock}
            <tr>
              <td class="card" style="padding: 36px 36px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1C1917; font-size: 15px; line-height: 1.6;">
                ${content}
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 36px 28px; border-top: 1px solid #F5F5F4; background: #FAFAF9;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="font-size: 12px; color: #A8A29E; line-height: 1.6;">
                      <div style="font-weight: 600; color: #78716C; margin-bottom: 4px;">Taurus &middot; AI Transformation OS</div>
                      <div>Built by Marqait AI &mdash; your partner from assessment to outcome.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <div style="text-align: center; padding: 20px 0 0; font-size: 11px; color: #A8A29E; letter-spacing: 0.3px;">
            You received this because you signed up for Taurus. &nbsp;&middot;&nbsp; <a href="https://marqait.ai" style="color: #78716C; text-decoration: none;">marqait.ai</a>
          </div>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Reusable inline-style snippets                                     */
/*  Email clients strip <style> in many cases — inline is safer.       */
/* ------------------------------------------------------------------ */

export const emailStyles = {
  h1: 'font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: #1C1917; margin: 0 0 12px;',
  h2: 'font-size: 19px; font-weight: 700; letter-spacing: -0.01em; color: #1C1917; margin: 0 0 12px;',
  p: 'font-size: 15px; line-height: 1.65; color: #44403C; margin: 0 0 14px;',
  pMuted: 'font-size: 14px; line-height: 1.6; color: #78716C; margin: 0 0 12px;',
  // Primary CTA — solid stone (matches landing primary button)
  btnPrimary:
    'display: inline-block; background: #1C1917; color: #FFFFFF !important; text-decoration: none; padding: 13px 28px; border-radius: 10px; font-weight: 600; font-size: 14px; letter-spacing: 0.01em; line-height: 1; box-shadow: 0 4px 14px rgba(28,25,23,0.18);',
  // Secondary CTA — warm gradient pill (matches landing accent)
  btnGradient:
    'display: inline-block; background-color: #E11D48; background-image: linear-gradient(135deg, #E11D48 0%, #F59E0B 100%); color: #FFFFFF !important; text-decoration: none; padding: 13px 28px; border-radius: 10px; font-weight: 600; font-size: 14px; letter-spacing: 0.01em; line-height: 1; box-shadow: 0 6px 18px rgba(225,29,72,0.25);',
  // Stat row container
  statsRow:
    'border-top: 1px solid #E7E5E4; border-bottom: 1px solid #E7E5E4; padding: 18px 0; margin: 22px 0;',
  statValue:
    'font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: #1C1917; line-height: 1.1;',
  statLabel:
    'font-size: 11px; color: #78716C; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 600; margin-top: 4px;',
  // Callout boxes by tone
  calloutAmber:
    'background-color: #FEF3C7; background-image: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border: 1px solid #FDE68A; border-left: 4px solid #B45309; padding: 16px 18px; border-radius: 10px; margin: 18px 0; color: #1C1917;',
  calloutRose:
    'background-color: #FFF1F2; background-image: linear-gradient(135deg, #FFF1F2 0%, #FECACA 100%); border: 1px solid #FECACA; border-left: 4px solid #E11D48; padding: 16px 18px; border-radius: 10px; margin: 18px 0; color: #1C1917;',
  calloutNeutral:
    'background: #FAFAF9; border: 1px solid #E7E5E4; border-left: 4px solid #78716C; padding: 16px 18px; border-radius: 10px; margin: 18px 0; color: #1C1917;',
};
