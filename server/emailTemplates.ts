type EmailMessage = {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  html: string;
};

type DemoEmailInput = {
  fullName?: string;
  date: string;
  time: string;
  meetLink: string;
};

type ThankYouEmailInput = {
  fullName?: string;
};

const BRAND_NAME = 'LeadPilot';
const SIGNATURE_NAME = 'LeadPilot Team';
const BRAND_COLOR = '#18181b';
const MUTED_TEXT = '#64748b';

function safeHeader(value: string) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailGreeting(fullName?: string) {
  const name = String(fullName || '').trim();
  return name ? `Hi ${name},` : 'Hi there,';
}

function htmlGreeting(fullName?: string) {
  return escapeHtml(emailGreeting(fullName));
}

function detailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding: 10px 0; color: ${MUTED_TEXT}; font-size: 13px;">${escapeHtml(label)}</td>
      <td style="padding: 10px 0; color: #0f172a; font-size: 14px; font-weight: 700; text-align: right;">${escapeHtml(value || '-')}</td>
    </tr>
  `;
}

function emailShell(options: {
  eyebrow: string;
  title: string;
  intro: string;
  details?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  closing: string;
}) {
  const ctaUrl = options.ctaUrl ? escapeHtml(options.ctaUrl) : '';
  return `<!doctype html>
<html>
  <body style="margin: 0; padding: 0; background: #f8fafc; font-family: Arial, Helvetica, sans-serif; color: #0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f8fafc; padding: 32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
            <tr>
              <td style="padding: 28px 28px 18px;">
                <div style="font-size: 12px; font-weight: 700; color: ${MUTED_TEXT}; text-transform: uppercase; letter-spacing: 0.08em;">${escapeHtml(options.eyebrow)}</div>
                <h1 style="margin: 10px 0 12px; color: #0f172a; font-size: 24px; line-height: 1.25; font-weight: 800;">${escapeHtml(options.title)}</h1>
                <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.7;">${options.intro}</p>
              </td>
            </tr>
            ${options.details ? `
            <tr>
              <td style="padding: 0 28px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px 16px;">
                  ${options.details}
                </table>
              </td>
            </tr>` : ''}
            ${options.ctaLabel && ctaUrl ? `
            <tr>
              <td align="center" style="padding: 2px 28px 24px;">
                <a href="${ctaUrl}" style="display: inline-block; background: ${BRAND_COLOR}; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 800; padding: 13px 22px; border-radius: 10px;">${escapeHtml(options.ctaLabel)}</a>
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding: 0 28px 28px;">
                <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.7;">${options.closing}</p>
                <p style="margin: 18px 0 0; color: #0f172a; font-size: 14px; line-height: 1.6; font-weight: 700;">Regards,<br>${escapeHtml(SIGNATURE_NAME)}</p>
              </td>
            </tr>
          </table>
          <p style="margin: 16px 0 0; color: #94a3b8; font-size: 12px;">Sent by ${escapeHtml(BRAND_NAME)}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildMeetingInviteEmail(input: DemoEmailInput) {
  const greeting = emailGreeting(input.fullName);
  const text = [
    greeting,
    '',
    'Your demo meeting has been scheduled.',
    '',
    `Date: ${input.date || '-'}`,
    `Time: ${input.time || '-'}`,
    `Google Meet Link: ${input.meetLink}`,
    '',
    'Please use the link above to join at the scheduled time.',
    '',
    `Regards,`,
    SIGNATURE_NAME
  ].join('\r\n');

  const html = emailShell({
    eyebrow: 'Demo scheduled',
    title: 'Your demo meeting is confirmed',
    intro: `${htmlGreeting(input.fullName)}<br>Your demo meeting has been scheduled. Please use the button below to join at the scheduled time.`,
    details: [
      detailRow('Date', input.date),
      detailRow('Time', input.time),
      detailRow('Meeting', 'Google Meet')
    ].join(''),
    ctaLabel: 'Join Google Meet',
    ctaUrl: input.meetLink,
    closing: 'We are looking forward to speaking with you.'
  });

  return {
    subject: 'Your Demo Meeting is Scheduled',
    text,
    html
  };
}

export function buildReminderEmail(input: DemoEmailInput) {
  const greeting = emailGreeting(input.fullName);
  const text = [
    greeting,
    '',
    'This is a quick reminder that your demo meeting is starting soon.',
    '',
    `Date: ${input.date || '-'}`,
    `Time: ${input.time || '-'}`,
    `Google Meet Link: ${input.meetLink}`,
    '',
    'Please use the link above to join.',
    '',
    `Regards,`,
    SIGNATURE_NAME
  ].join('\r\n');

  const html = emailShell({
    eyebrow: 'Meeting reminder',
    title: 'Your demo starts soon',
    intro: `${htmlGreeting(input.fullName)}<br>This is a quick reminder that your demo meeting is starting soon.`,
    details: [
      detailRow('Date', input.date),
      detailRow('Time', input.time),
      detailRow('Meeting', 'Google Meet')
    ].join(''),
    ctaLabel: 'Join Google Meet',
    ctaUrl: input.meetLink,
    closing: 'Please join when you are ready. We will meet you there.'
  });

  return {
    subject: 'Reminder: Your Demo Meeting is starting soon',
    text,
    html
  };
}

export function buildThankYouEmail(input: ThankYouEmailInput) {
  const greeting = emailGreeting(input.fullName);
  const text = [
    greeting,
    '',
    'Thank you for attending the demo.',
    '',
    'It was a pleasure connecting with you and sharing the details with you.',
    '',
    'If you have any questions or need any further information, feel free to reply to this email.',
    '',
    `Regards,`,
    SIGNATURE_NAME
  ].join('\r\n');

  const html = emailShell({
    eyebrow: 'Thank you',
    title: 'Thank you for attending the demo',
    intro: `${htmlGreeting(input.fullName)}<br>Thank you for attending the demo. It was a pleasure connecting with you and sharing the details with you.`,
    closing: 'If you have any questions or need any further information, feel free to reply to this email.'
  });

  return {
    subject: 'Thank you for attending the demo',
    text,
    html
  };
}

export function buildRawEmail(message: EmailMessage) {
  const boundary = `leadpilot_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `To: ${safeHeader(message.to)}`,
    message.cc ? `Cc: ${safeHeader(message.cc)}` : '',
    `Subject: ${safeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ].filter(Boolean);

  const rawMessage = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    message.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    message.html,
    '',
    `--${boundary}--`
  ].join('\r\n');

  return Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
