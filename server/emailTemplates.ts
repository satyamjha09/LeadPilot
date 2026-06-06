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

const BRAND_NAME = 'TallyKonnect';
const SIGNATURE_NAME = 'Team TallyKonnect';
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

function publicAssetUrl(pathname: string) {
  const publicBaseUrl = (
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '')
  ).replace(/\/+$/, '');
  return publicBaseUrl ? `${publicBaseUrl}${pathname}` : pathname;
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

function solutionCard(icon: string, title: string, description: string, badge?: string) {
  return `
    <td width="33.33%" valign="top" style="border:1px solid #dbe5f5; border-radius:14px; padding:22px; background:#ffffff;">
      <div style="font-size:34px; line-height:38px;">${icon}</div>
      <div style="font-size:21px; font-weight:800; color:#0052dc; line-height:25px; margin-top:10px;">${title}</div>
      <p style="font-size:15px; line-height:23px; color:#102b63; margin:12px 0 ${badge ? '12px' : '0'};">${description}</p>
      ${badge ? `<span style="display:inline-block; background:#e7f0ff; color:#0052dc; font-size:12px; font-weight:700; padding:6px 12px; border-radius:7px;">${badge}</span>` : ''}
    </td>
  `;
}

function buildTallyKonnectThankYouHtml(input: ThankYouEmailInput) {
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const logoUrl = escapeHtml(publicAssetUrl('/images/logo.png'));
  const bannerUrl = escapeHtml(publicAssetUrl('/images/Smart.png'));

  return `<!doctype html>
<html lang="en">
  <body style="margin:0; padding:0; background:#eef3fb; font-family:Arial, Helvetica, sans-serif; color:#0b2458;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3fb; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="900" cellpadding="0" cellspacing="0" border="0" style="width:900px; max-width:900px; background:#ffffff; border-radius:14px; overflow:hidden; border:1px solid #dce6f5;">
            <tr>
              <td style="padding:28px 36px 22px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td>
                      <img src="${logoUrl}" alt="TallyKonnect" height="44" style="display:block; height:44px; width:auto; max-width:260px; border:0;">
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0;">
                <img src="${bannerUrl}" alt="Smart TDS Demo" width="900" style="display:block; width:100%; max-width:900px; height:auto; border:0;">
              </td>
            </tr>

            <tr>
              <td style="height:6px; background:#ffc400; font-size:0; line-height:0;">&nbsp;</td>
            </tr>

            <tr>
              <td style="padding:38px 52px 20px;">
                <div style="font-size:24px; line-height:32px; color:#071f57;">
                  Hello <strong style="color:#0057ff;">${customerName}</strong>,
                </div>
                <p style="font-size:18px; line-height:30px; color:#102b63; margin:18px 0 30px;">
                  Thank you for taking the time to join our Smart TDS demo. We hope the session gave you a clear view of how Smart TDS simplifies TDS calculations, auto-creates vouchers, and helps keep your returns ready inside Tally.
                </p>
                <div style="height:1px; background:#d9e4f7;"></div>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 52px 8px; text-align:center;">
                <div style="font-size:22px; line-height:30px; font-weight:800; color:#002c8f;">
                  You can also explore other automation solutions from TallyKonnect.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:12px 42px 10px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="14" border="0">
                  <tr>
                    ${solutionCard('&#127974;', 'Connected<br>Banking', 'Pay vendors, check balances, and download statements directly inside Tally.')}
                    ${solutionCard('&#128196;', 'Smart<br>Purchase', 'Read purchase invoices automatically and post them straight into Tally.')}
                    ${solutionCard('&#127963;', 'Smart Bank<br>Recon', 'Upload bank statements and match entries inside Tally in about 30 minutes.')}
                  </tr>
                  <tr>
                    ${solutionCard('&#128202;', 'Smart<br>Reports', 'Get godown-wise, receivables, performance, and MSME reports directly from Tally.')}
                    ${solutionCard('&#127760;', 'AnyWhereTally', 'Access Tally from any browser, anywhere, with real-time sync.', 'Coming Soon')}
                    ${solutionCard('&#128172;', 'MessageAPI', 'Send invoices and challans on WhatsApp directly from Tally.')}
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:20px 52px 10px;">
                <a href="https://tallykonnect.com" style="display:inline-block; background:#ffc000; color:#071f57; text-decoration:none; font-size:22px; font-weight:800; padding:16px 46px; border-radius:8px;">
                  Talk to Our Team &#8594;
                </a>
                <div style="font-size:17px; color:#102b63; margin-top:16px;">Need help choosing the right solution for your business?</div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 52px 12px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ffc000; border-radius:14px; background:#fffaf0;">
                  <tr>
                    <td style="padding:24px 26px;">
                      <div style="font-size:22px; font-weight:800; color:#071f57;">&#10024; Interested in more automation?</div>
                      <div style="font-size:17px; line-height:25px; color:#102b63; margin-top:6px;">We would be happy to suggest the right TallyKonnect solutions for your workflow.</div>
                    </td>
                    <td align="right" style="padding:24px 26px;">
                      <a href="https://tallykonnect.com/contact" style="display:inline-block; background:#004bdc; color:#ffffff; text-decoration:none; font-size:19px; font-weight:800; padding:15px 26px; border-radius:8px;">
                        Book a Follow-up &#8594;
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:12px 52px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f7ff; border-radius:14px;">
                  <tr>
                    <td width="80" align="center" style="font-size:38px; padding:22px 0;">&#127911;</td>
                    <td style="padding:22px 24px 22px 0;">
                      <div style="font-size:22px; font-weight:800; color:#071f57;">Need help getting started?</div>
                      <div style="font-size:17px; color:#102b63; margin-top:7px;">
                        Write to us at <a href="mailto:info@tallykonnect.com" style="color:#0052dc; text-decoration:none;">info@tallykonnect.com</a> or visit <a href="https://tallykonnect.com" style="color:#0052dc; text-decoration:none;">tallykonnect.com</a>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 52px 32px; border-top:1px solid #d9e4f7;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td>
                      <div style="font-size:25px; font-weight:800; color:#0052dc;">TallyKonnect</div>
                      <div style="font-size:15px; color:#102b63; margin-top:4px;">Business Automation Made Simple</div>
                    </td>
                    <td align="right" style="font-size:16px;">
                      <a href="https://tallykonnect.com" style="color:#0052dc; text-decoration:none; margin-left:20px;">Website</a>
                      <a href="mailto:info@tallykonnect.com" style="color:#0052dc; text-decoration:none; margin-left:20px;">Contact</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildTallyKonnectScheduledHtml(input: DemoEmailInput) {
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const date = escapeHtml(input.date || '-');
  const time = escapeHtml(input.time || '-');
  const meetLink = escapeHtml(input.meetLink || '#');
  const logoUrl = escapeHtml(publicAssetUrl('/images/logo.png'));

  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f4f7fb; font-family:Arial, Helvetica, sans-serif; color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb; padding:30px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 8px 24px rgba(15, 23, 42, 0.08);">
            <tr>
              <td style="background:#0f766e; background:linear-gradient(135deg,#0f766e,#14b8a6); padding:28px 32px; color:#ffffff;">
                <img src="${logoUrl}" alt="TallyKonnect" height="38" style="display:block; height:38px; width:auto; max-width:240px; border:0; margin-bottom:12px;">
                <h1 style="margin:8px 0 0; font-size:26px; line-height:1.3; font-weight:700;">
                  Smart TDS Demo Scheduled
                </h1>
                <p style="margin:8px 0 0; font-size:15px; opacity:0.95;">
                  Your demo meeting details are ready.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px; font-size:16px; line-height:1.7;">
                  Hi <strong>${customerName}</strong>,
                </p>

                <p style="margin:0 0 16px; font-size:16px; line-height:1.7;">
                  Your <strong>Smart TDS demo with TallyKonnect</strong> has been scheduled.
                </p>

                <p style="margin:0 0 22px; font-size:15px; line-height:1.7; color:#4b5563;">
                  We will show you how Smart TDS helps make TDS work simpler by reducing manual calculation,
                  tracking deductions, and keeping your process ready for returns and compliance.
                </p>

                <p style="margin:0 0 22px; font-size:15px; line-height:1.7; color:#4b5563;">
                  Please join the meeting at the scheduled time using the Google Meet link below.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:14px; padding:0; margin:0 0 24px;">
                  <tr>
                    <td style="padding:20px 22px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding:8px 0; font-size:14px; color:#6b7280; width:130px;">
                            &#128197; Meeting Date
                          </td>
                          <td style="padding:8px 0; font-size:15px; color:#111827; font-weight:600;">
                            ${date}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:8px 0; font-size:14px; color:#6b7280;">
                            &#128338; Meeting Time
                          </td>
                          <td style="padding:8px 0; font-size:15px; color:#111827; font-weight:600;">
                            ${time}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:8px 0; font-size:14px; color:#6b7280;">
                            &#128279; Meet Link
                          </td>
                          <td style="padding:8px 0; font-size:15px;">
                            <a href="${meetLink}" style="color:#0f766e; font-weight:700; text-decoration:none;">
                              Join Google Meet
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">
                  <tr>
                    <td style="background:#0f766e; border-radius:10px;">
                      <a href="${meetLink}" style="display:inline-block; padding:14px 24px; color:#ffffff; font-size:15px; font-weight:700; text-decoration:none;">
                        Join Meeting
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 8px; font-size:15px; line-height:1.7; color:#4b5563;">
                  Regards,
                </p>
                <p style="margin:0; font-size:16px; line-height:1.7; color:#111827; font-weight:700;">
                  Team TallyKonnect
                </p>

                <p style="margin:8px 0 0; font-size:14px;">
                  <a href="https://tallykonnect.com" style="color:#0f766e; text-decoration:none; font-weight:600;">
                    https://tallykonnect.com
                  </a>
                </p>
              </td>
            </tr>

            <tr>
              <td style="background:#f9fafb; padding:18px 32px; border-top:1px solid #e5e7eb; text-align:center;">
                <p style="margin:0; font-size:12px; color:#6b7280; line-height:1.6;">
                  This email was sent by TallyKonnect for your scheduled Smart TDS demo.
                </p>
              </td>
            </tr>
          </table>
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
    'Your Smart TDS demo with TallyKonnect has been scheduled.',
    '',
    'We will show you how Smart TDS helps make TDS work simpler by reducing manual calculation, tracking deductions, and keeping your process ready for returns and compliance.',
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

  const html = buildTallyKonnectScheduledHtml(input);

  return {
    subject: 'Smart TDS Demo Scheduled',
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
    'Thank you for attending the Smart TDS demo.',
    '',
    'We hope the session gave you a clear view of how Smart TDS simplifies TDS calculations, auto-creates vouchers, and helps keep your returns ready inside Tally.',
    '',
    'You can also explore TallyKonnect automation solutions such as Connected Banking, Smart Purchase, Smart Bank Recon, Smart Reports, AnyWhereTally, and MessageAPI.',
    '',
    'Website: https://tallykonnect.com',
    'Contact: info@tallykonnect.com',
    '',
    `Regards,`,
    'TallyKonnect Team'
  ].join('\r\n');

  const html = buildTallyKonnectThankYouHtml(input);

  return {
    subject: 'Thank you for attending the Smart TDS demo',
    text,
    html
  };
}

export function buildRawEmail(message: EmailMessage) {
  const boundary = `tallykonnect_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
