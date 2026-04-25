import { wrapEmailTemplate, emailStyles } from './email-base.template';

interface OtpData {
  code: string;
  expiresInMinutes?: number;
}

export function otpTemplate(data: OtpData): string {
  const minutes = data.expiresInMinutes ?? 10;

  const content = `
    <h2 style="${emailStyles.h2}">Your sign-in code</h2>
    <p style="${emailStyles.p}">Use the code below to finish signing in to Taurus. It expires in <strong style="color: #1C1917;">${minutes} minutes</strong>.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 22px 0;">
      <tr>
        <td align="center" style="background: #FAFAF9; border: 1px solid #E7E5E4; border-radius: 12px; padding: 28px 20px;">
          <div style="font-size: 11px; font-weight: 600; letter-spacing: 1.5px; color: #A8A29E; text-transform: uppercase; margin-bottom: 12px;">Verification code</div>
          <div class="otp-code" style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 42px; font-weight: 700; letter-spacing: 14px; color: #1C1917; line-height: 1; padding-left: 14px;">${data.code}</div>
          <div style="margin-top: 14px; height: 3px; width: 64px; margin-left: auto; margin-right: auto; background-image: linear-gradient(90deg, #E11D48 0%, #F59E0B 100%); border-radius: 999px;"></div>
        </td>
      </tr>
    </table>

    <p style="${emailStyles.pMuted}">If you didn&rsquo;t request this code, you can safely ignore this email &mdash; someone may have typed your address by mistake.</p>
  `;

  return wrapEmailTemplate(content, {
    minimalHeader: true,
    preheader: `Your Taurus sign-in code: ${data.code} (expires in ${minutes} min)`,
  });
}
