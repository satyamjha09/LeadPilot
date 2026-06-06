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

function solutionCard(icon: string, title: string, description: string, badge?: string) {
  return `
    <td width="33.33%" valign="top" style="border:1px solid #dbe5f5; border-radius:12px; padding:20px; background:#ffffff;">
      <div style="font-size:30px; line-height:34px;">${icon}</div>
      <div style="font-size:20px; font-weight:800; color:#0052dc; line-height:24px; margin-top:8px;">${title}</div>
      <p style="font-size:14px; line-height:21px; color:#102b63; margin:10px 0 ${badge ? '12px' : '0'};">${description}</p>
      ${badge ? `<span style="display:inline-block; background:#e7f0ff; color:#0052dc; font-size:12px; font-weight:700; padding:6px 12px; border-radius:7px;">${badge}</span>` : ''}
    </td>
  `;
}

function buildTallyKonnectThankYouHtml(input: ThankYouEmailInput) {
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');

  return `<!doctype html>
<html lang="en">
  <body style="margin:0; padding:0; background:#eef3fb; font-family:Arial, Helvetica, sans-serif; color:#0b2458;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef3fb; margin:0; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:720px; max-width:720px; background:#ffffff; border:1px solid #d9e2f2; border-radius:14px; overflow:hidden;">
            <tr>
              <td style="padding:28px 34px 18px;">
                <div style="font-size:30px; line-height:36px; font-weight:700; color:#0647d8;">
                  <span style="display:inline-block; vertical-align:middle; margin-right:10px;">&#128187;</span>TallyKonnect
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:0 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#003ecb; background:linear-gradient(135deg,#0034a8,#0057ff); border-radius:10px 10px 0 0;">
                  <tr>
                    <td width="54%" style="padding:42px 30px 38px 34px;">
                      <div style="font-size:16px; font-weight:700; color:#ffd21a; letter-spacing:.5px;">THANK YOU</div>
                      <div style="width:36px; height:4px; background:#ffd21a; border-radius:4px; margin:12px 0 24px;"></div>
                      <div style="font-size:42px; line-height:52px; font-weight:800; color:#ffffff;">
                        Thank you for<br>
                        attending the<br>
                        <span style="color:#ffc400;">Smart TDS</span> demo
                      </div>
                      <div style="margin-top:22px; display:inline-block; background:rgba(255,255,255,.16); border-radius:8px; padding:11px 18px; color:#ffffff; font-weight:700; font-size:15px;">
                        &#10003;&nbsp; Demo Attended
                      </div>
                    </td>
                    <td width="46%" align="center" style="padding:30px 30px 30px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:270px; background:#ffffff; border-radius:14px; box-shadow:0 12px 28px rgba(0,0,0,.18);">
                        <tr>
                          <td style="padding:18px;">
                            <div style="color:#004bdc; font-size:14px; font-weight:700; margin-bottom:12px;">TDS Dashboard</div>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                              <tr>
                                <td width="45%" valign="top">
                                  <div style="font-size:0; margin-bottom:12px;">
                                    <span style="display:inline-block;width:14px;height:28px;background:#1f68ff;margin-right:6px;border-radius:2px;"></span>
                                    <span style="display:inline-block;width:14px;height:38px;background:#1f68ff;margin-right:6px;border-radius:2px;"></span>
                                    <span style="display:inline-block;width:14px;height:52px;background:#1f68ff;border-radius:2px;"></span>
                                  </div>
                                  <div style="width:72px;height:72px;border-radius:50%;background:#eaf0ff; border:14px solid #004bdc; box-sizing:border-box;"></div>
                                </td>
                                <td width="55%" valign="top" style="font-size:12px; color:#23375f; line-height:18px;">
                                  <div>TDS Collected</div>
                                  <div style="font-size:17px; font-weight:800; color:#111;">&#8377; 1,25,400</div>
                                  <div style="margin-top:8px;">TDS Deducted</div>
                                  <div style="font-size:17px; font-weight:800; color:#111;">&#8377; 18,300</div>
                                  <div style="margin-top:8px;">Pending Payments</div>
                                  <div style="font-size:17px; font-weight:800; color:#111;">&#8377; 7,100</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      <div style="margin-top:-42px; margin-left:130px; width:130px; background:#ffffff; border-radius:16px; padding:18px 14px; box-shadow:0 10px 24px rgba(0,0,0,.18); position:relative;">
                        <div style="color:#004bdc; font-weight:800; font-size:16px;">TDS RETURN</div>
                        <div style="height:7px;background:#e8eefc;border-radius:10px;margin:12px 0 8px;"></div>
                        <div style="height:7px;background:#e8eefc;border-radius:10px;margin-bottom:8px;width:80%;"></div>
                        <div style="height:7px;background:#e8eefc;border-radius:10px;margin-bottom:8px;width:70%;"></div>
                        <div style="font-size:24px;color:#0057ff;text-align:right;">&#10003;</div>
                      </div>
                    </td>
                  </tr>
                </table>
                <div style="height:5px; background:#ffc400;"></div>
              </td>
            </tr>

            <tr>
              <td style="padding:32px 48px 20px;">
                <div style="font-size:22px; line-height:30px; color:#071f57;">
                  Hello <strong style="color:#0057ff;">${customerName}</strong>,
                </div>
                <p style="font-size:17px; line-height:29px; color:#102b63; margin:18px 0 30px;">
                  Thank you for taking the time to join our Smart TDS demo. We hope the session gave you a clear view of how Smart TDS simplifies TDS calculations, auto-creates vouchers, and helps keep your returns ready inside Tally.
                </p>
                <div style="height:1px; background:#d9e4f7;"></div>
              </td>
            </tr>

            <tr>
              <td style="padding:8px 42px;">
                <div style="text-align:center; font-size:21px; font-weight:800; color:#002c8f; margin:8px 0 22px;">
                  You can also explore other automation solutions from TallyKonnect.
                </div>
                <table role="presentation" width="100%" cellspacing="12" cellpadding="0" border="0">
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
              <td align="center" style="padding:12px 48px;">
                <a href="https://tallykonnect.com" style="display:inline-block; background:#ffc000; color:#071f57; text-decoration:none; font-size:20px; font-weight:800; padding:15px 42px; border-radius:8px;">
                  Talk to Our Team &#8594;
                </a>
                <div style="font-size:16px; color:#102b63; margin-top:16px;">Need help choosing the right solution for your business?</div>
              </td>
            </tr>

            <tr>
              <td style="padding:10px 44px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #ffc000; border-radius:12px; background:#fffaf0;">
                  <tr>
                    <td style="padding:22px 24px; font-size:16px; color:#102b63;">
                      <div style="font-size:21px; font-weight:800; color:#071f57;">&#10024; Interested in more automation?</div>
                      <div style="margin-top:6px;">We would be happy to suggest the right TallyKonnect solutions for your workflow.</div>
                    </td>
                    <td align="right" style="padding:22px 24px;">
                      <a href="https://tallykonnect.com/contact" style="display:inline-block; background:#004bdc; color:#ffffff; text-decoration:none; font-size:18px; font-weight:800; padding:14px 24px; border-radius:8px;">
                        Book a Follow-up &#8594;
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:10px 44px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-radius:12px; background:#f2f7ff;">
                  <tr>
                    <td width="70" align="center" style="font-size:36px; padding:20px 0;">&#127911;</td>
                    <td style="padding:18px 20px 18px 0;">
                      <div style="font-size:21px; font-weight:800; color:#071f57;">Need help getting started?</div>
                      <div style="font-size:16px; color:#102b63; margin-top:6px;">
                        Write to us at <a href="mailto:info@tallykonnect.com" style="color:#0052dc; text-decoration:none;">info@tallykonnect.com</a> or visit <a href="https://tallykonnect.com" style="color:#0052dc; text-decoration:none;">tallykonnect.com</a>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 48px 28px; border-top:1px solid #d9e4f7;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td>
                      <div style="font-size:24px; font-weight:800; color:#0052dc;">TallyKonnect</div>
                      <div style="font-size:14px; color:#102b63;">Business Automation Made Simple</div>
                    </td>
                    <td align="right" style="font-size:15px;">
                      <a href="https://tallykonnect.com" style="color:#0052dc; text-decoration:none; margin-left:18px;">Website</a>
                      <a href="mailto:info@tallykonnect.com" style="color:#0052dc; text-decoration:none; margin-left:18px;">Contact</a>
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
