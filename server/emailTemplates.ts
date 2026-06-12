type EmailMessage = {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  html: string;
  eventKey?: string;
};

type DemoEmailInput = {
  fullName?: string;
  date: string;
  time: string;
  meetLink: string;
};

type RescheduleEmailInput = DemoEmailInput & {
  oldDate?: string;
  oldTime?: string;
};

type ThankYouEmailInput = {
  fullName?: string;
};

type NoResponseEmailInput = {
  fullName?: string;
};

const BRAND_NAME = 'TallyKonnect';
const SIGNATURE_NAME = 'Team TallyKonnect';
const BRAND_COLOR = '#18181b';
const MUTED_TEXT = '#64748b';
const WEBSITE_URL = 'https://tallykonnect.com';
const CONTACT_EMAIL = 'info@tallykonnect.com';
const UNSUBSCRIBE_URL = 'https://tallykonnect.com/unsubscribe';

function safeHeader(value: string) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function senderHeader() {
  const fromEmail = safeHeader(process.env.GMAIL_FROM_EMAIL || 'demo.tallykonnect@gmail.com');
  const fromName = safeHeader(process.env.GMAIL_FROM_NAME || BRAND_NAME);
  return `${fromName} <${fromEmail}>`;
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

function solutionCard(
  icon: string,
  title: string,
  description: string,
  badge?: string,
  muted = false
) {
  const borderColor = muted ? '#e0e0e0' : '#e5e7eb';
  const backgroundColor = muted ? '#f7f8fa' : '#ffffff';
  const iconBackground = muted ? '#ebebeb' : title === 'Smart Purchase' ? '#fff8e0' : '#eef1fb';
  const iconColor = muted ? '#999999' : title === 'Smart Purchase' ? '#f5a800' : '#1a3c8f';
  const titleColor = muted ? '#999999' : '#1a3c8f';
  const descriptionColor = muted ? '#aaaaaa' : '#666666';

  return `
    <td class="product-column" width="33.33%" valign="top" style="width:33.33%; padding:6px; vertical-align:top;">
      <table role="presentation" width="100%" height="176" cellpadding="0" cellspacing="0" border="0" style="width:100%; height:176px; min-height:176px; background:${backgroundColor}; border:1px solid ${borderColor}; border-radius:8px; border-collapse:separate;">
        <tr>
          <td valign="top" height="174" style="height:174px; padding:16px 14px 14px; vertical-align:top;">
            <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; height:100%;">
              <tr>
                <td valign="top" height="42" style="height:42px; vertical-align:top;">
                  <table role="presentation" width="40" height="40" cellpadding="0" cellspacing="0" border="0" style="width:40px; height:40px; background:${iconBackground}; border-radius:8px; border-collapse:separate;">
                    <tr>
                      <td align="center" valign="middle" style="width:40px; height:40px; color:${iconColor}; font-size:20px; line-height:40px; text-align:center;">
                        ${icon}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td valign="top" height="36" style="height:36px; vertical-align:top; font-size:13px; line-height:17px; font-weight:700; color:${titleColor}; padding-top:8px;">
                  ${escapeHtml(title)}
                </td>
              </tr>

              <tr>
                <td valign="top" height="58" style="height:58px; vertical-align:top; font-size:11.5px; line-height:17px; color:${descriptionColor}; padding-top:4px;">
                  ${escapeHtml(description)}
                </td>
              </tr>

              <tr>
                <td valign="bottom" height="22" style="height:22px; vertical-align:bottom;">
                  ${badge ? `<span style="display:inline-block; padding:3px 10px; background:#e02020; color:#ffffff; border-radius:20px; font-size:10px; line-height:14px; font-weight:700; letter-spacing:0.4px;">${escapeHtml(badge)}</span>` : '&nbsp;'}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  `;
}

function buildTallyKonnectThankYouHtml(input: ThankYouEmailInput) {
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const logoUrl = escapeHtml(publicAssetUrl('/images/logo.png'));
  const bannerUrl = escapeHtml(publicAssetUrl('/images/Smart.png'));
  const currentYear = new Date().getFullYear();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Thank You - TallyKonnect Smart TDS Demo</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-wrapper { width: 100% !important; }
        .body-padding { padding: 28px 18px 22px !important; }
        .product-column { display: block !important; width: 100% !important; padding: 6px 0 !important; }
        .followup-column { display: block !important; width: 100% !important; text-align: left !important; padding: 8px 16px 16px !important; }
        .footer-column { display: block !important; width: 100% !important; text-align: center !important; padding: 5px 0 !important; }
      }
    </style>
  </head>

  <body style="margin:0; padding:0; background:#f0f0f0; font-family:Arial, Helvetica, sans-serif; color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f0f0f0;">
      <tr>
        <td align="center" style="padding:20px 10px;">
          <table class="email-wrapper" role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:620px; background:#ffffff; border-radius:6px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.12);">

            <tr>
              <td style="padding:18px 30px; background:#ffffff; border-bottom:1px solid #f0f0f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="54" valign="middle" style="width:54px;">
                      <img src="${logoUrl}" alt="TallyKonnect logo" width="44" style="display:block; width:44px; height:auto; border:0; outline:none;">
                    </td>
                    <td valign="middle" style="font-size:20px; line-height:26px; font-weight:800; color:#1a3c8f; letter-spacing:-0.4px;">
                      TallyKonnect
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0; background:#e8edf5;">
                <img src="${bannerUrl}" alt="Smart TDS Demo" width="620" style="display:block; width:100%; max-width:620px; height:auto; border:0; outline:none;">
              </td>
            </tr>

            <tr>
              <td class="body-padding" style="padding:36px 36px 28px; background:#ffffff;">
                <div style="font-size:17px; line-height:24px; font-weight:700; color:#1a1a1a; margin-bottom:14px;">
                  Hello <span style="color:#1a3c8f;">${customerName},</span>
                </div>

                <p style="margin:0 0 28px; font-size:14px; line-height:24px; color:#555555;">
                  Thank you for taking the time to join our Smart TDS demo. We hope the session gave you a clear view of how Smart TDS simplifies TDS calculations, auto-creates vouchers, and helps keep your returns ready inside Tally.
                </p>

                <div style="height:1px; line-height:1px; background:#e8e8e8; margin-bottom:28px;">&nbsp;</div>

                <div style="text-align:center; font-size:14px; line-height:22px; font-weight:700; color:#1a1a1a;">
                  You can also explore other automation solutions from TallyKonnect. <span style="color:#f5c518;">&#9889;</span>
                </div>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-top:14px; table-layout:fixed;">
                  <tr>
                    ${solutionCard('&#127974;', 'Connected Banking', 'Pay vendors, check balances, and download statements directly inside Tally.')}
                    ${solutionCard('&#128196;', 'Smart Purchase', 'Read purchase invoices automatically and post them straight into Tally.')}
                    ${solutionCard('&#10003;', 'Smart Bank Recon', 'Upload bank statements and match entries inside Tally in about 30 minutes.')}
                  </tr>
                  <tr>
                    <td colspan="3" height="8" style="height:8px; line-height:8px; font-size:8px;">&nbsp;</td>
                  </tr>
                  <tr>
                    ${solutionCard('&#128202;', 'Smart Reports', 'Get godown-wise, receivables, performance, and MSME reports directly from Tally.')}
                    ${solutionCard('&#128172;', 'MessageAPI', 'Send invoices and challans on WhatsApp directly from Tally.')}
                    ${solutionCard('&#127760;', 'AnyWhereTally', 'Access Tally from any browser, anywhere, with real-time sync.', 'Coming Soon', true)}
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:22px auto 0;">
                  <tr>
                    <td align="center" style="background:#f5c518; border-radius:6px;">
                      <a href="https://wa.me/918375938947?text=Hi%20TallyKonnect%2C%20I%20would%20like%20to%20know%20more%20about%20Smart%20TDS%20and%20other%20solutions" style="display:inline-block; padding:14px 40px; color:#1a1a1a; text-decoration:none; font-size:15px; line-height:20px; font-weight:800;">
                        Talk to Our Team &nbsp;&#8594;
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:10px; margin-bottom:24px; text-align:center; font-size:12.5px; line-height:18px; color:#888888;">
                  Need help choosing the right solution for your business?
                </div>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#fffef5; border:1px solid #e8c84a; border-radius:12px;">
                  <tr>
                    <td width="72" valign="middle" style="width:72px; padding:18px 0 18px 18px;">
                      <table role="presentation" width="52" height="52" cellpadding="0" cellspacing="0" border="0" style="width:52px; height:52px; background:#fffbea; border:1px solid #f0c040; border-radius:50%;">
                        <tr>
                          <td align="center" valign="middle" style="font-size:24px; line-height:52px; color:#e8a800;">&#10024;</td>
                        </tr>
                      </table>
                    </td>

                    <td valign="middle" style="padding:18px 10px;">
                      <div style="font-size:14px; line-height:19px; font-weight:800; color:#111111; margin-bottom:4px;">
                        Interested in more automation?
                      </div>
                      <div style="font-size:12.5px; line-height:20px; color:#666666;">
                        We would be happy to suggest the right TallyKonnect solutions for your workflow.
                      </div>
                    </td>

                    <td class="followup-column" width="174" align="right" valign="middle" style="width:174px; padding:18px 18px 18px 6px;">
                      <a href="mailto:info@tallykonnect.com?subject=Book%20a%20Follow-up%20Meeting&body=Hi%2C%0A%0AI%20would%20like%20to%20book%20a%20meeting%20to%20discuss%20TallyKonnect%20solutions.%0A%0AThank%20you" style="display:inline-block; padding:13px 18px; background:#1535a0; color:#ffffff; text-decoration:none; border-radius:8px; font-size:13px; line-height:18px; font-weight:700; white-space:nowrap;">
                        Book a Follow-up &nbsp;&#8594;
                      </a>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-top:14px; background:#eef1fa; border-radius:12px;">
                  <tr>
                    <td width="66" valign="middle" style="width:66px; padding:16px 0 16px 18px;">
                      <table role="presentation" width="46" height="46" cellpadding="0" cellspacing="0" border="0" style="width:46px; height:46px; background:#2563eb; border-radius:50%;">
                        <tr>
                          <td align="center" valign="middle" style="font-size:21px; line-height:46px; color:#ffffff;">&#127911;</td>
                        </tr>
                      </table>
                    </td>
                    <td valign="middle" style="padding:16px 18px 16px 12px;">
                      <div style="font-size:14px; line-height:20px; font-weight:800; color:#111111; margin-bottom:3px;">
                        Need help getting started?
                      </div>
                      <div style="font-size:12.5px; line-height:19px; color:#555555;">
                        Write to us at <a href="mailto:info@tallykonnect.com" style="color:#1535a0; font-weight:600; text-decoration:none;">info@tallykonnect.com</a> or visit <a href="https://tallykonnect.com" style="color:#1535a0; font-weight:600; text-decoration:none;">tallykonnect.com</a>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 36px; background:#ffffff; border-top:1px solid #f0f0f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="footer-column" valign="middle">
                      <div style="font-size:15px; line-height:21px; font-weight:800; color:#1a3c8f;">TallyKonnect</div>
                      <div style="margin-top:2px; font-size:11.5px; line-height:17px; color:#aaaaaa;">Business Automation Made Simple</div>
                    </td>
                    <td class="footer-column" align="right" valign="middle" style="font-size:12.5px; line-height:20px;">
                      <a href="${WEBSITE_URL}" style="color:#555555; text-decoration:none; font-weight:500;">Website</a>
                      <span style="color:#cccccc;">&nbsp;&nbsp;&nbsp;</span>
                      <a href="mailto:${CONTACT_EMAIL}" style="color:#555555; text-decoration:none; font-weight:500;">Contact</a>
                      <span style="color:#cccccc;">&nbsp;&nbsp;&nbsp;</span>
                      <a href="${UNSUBSCRIBE_URL}" style="color:#555555; text-decoration:none; font-weight:500;">Unsubscribe</a>
                    </td>
                  </tr>
                </table>
                <div style="margin-top:16px; padding-top:14px; border-top:1px solid #f0f0f0; text-align:center; font-size:10px; line-height:16px; color:#bbbbbb;">
                  &copy; ${currentYear} TallyKonnect. All rights reserved.
                </div>
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
  const meetLink = escapeHtml(input.meetLink || '#');
  const demoDate = escapeHtml(input.date || '-');
  const demoTime = escapeHtml(input.time || '-');
  const logoUrl = escapeHtml(publicAssetUrl('/images/logo.png'));
  const currentYear = new Date().getFullYear();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Smart TDS Demo - TallyKonnect</title>
    <style>
      @media only screen and (max-width: 600px) {
        .email-container { width:100% !important; }
        .mobile-padding { padding-left:20px !important; padding-right:20px !important; }
        .footer-column { display:block !important; width:100% !important; text-align:center !important; padding:5px 0 !important; }
      }
    </style>
  </head>

  <body style="margin:0; padding:0; background:#f5f5f5; font-family:Arial, Helvetica, sans-serif; color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f5f5f5;">
      <tr>
        <td align="center" style="padding:20px 10px;">
          <table class="email-container" role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background:#ffffff; border-radius:4px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.10);">

            <tr>
              <td class="mobile-padding" style="padding:25px 40px; background:#ffffff; border-bottom:1px solid #f0f0f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="65" valign="middle" style="width:65px;">
                      <img src="${logoUrl}" alt="TallyKonnect logo" width="50" style="display:block; width:50px; height:auto; border:0; outline:none;">
                    </td>
                    <td valign="middle" style="font-size:18px; line-height:24px; font-weight:700; color:#004aad; letter-spacing:-0.5px;">
                      TallyKonnect
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="mobile-padding" style="padding:40px; color:#ffffff; background:#004aad; background-image:linear-gradient(135deg,#004aad 0%,#0066ff 100%);">
                <div style="font-size:12px; line-height:18px; font-weight:600; text-transform:uppercase; letter-spacing:1px; color:#e9f1ff; margin-bottom:15px;">
                  Welcome Aboard
                </div>
                <div style="font-size:32px; line-height:42px; font-weight:700; color:#ffffff; margin-bottom:8px;">
                  Your Smart TDS Demo
                </div>
                <div style="font-size:14px; line-height:22px; color:#edf4ff;">
                  Simplify TDS management inside Tally with automation
                </div>
              </td>
            </tr>

            <tr>
              <td class="mobile-padding" style="padding:40px; background:#ffffff;">
                <div style="font-size:16px; line-height:23px; color:#1a1a1a; margin-bottom:24px; font-weight:600;">
                  Hi ${customerName},
                </div>

                <p style="margin:0 0 24px; font-size:15px; line-height:27px; color:#6b7280;">
                  Your Smart TDS demo with TallyKonnect has been scheduled. In this session, we'll show you how our solution transforms TDS compliance into a seamless, automated process inside Tally.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f0f4ff; border-left:6px solid #004aad;">
                  <tr>
                    <td style="padding:24px;">
                      <div style="font-size:13px; line-height:18px; font-weight:700; color:#004aad; text-transform:uppercase; letter-spacing:1px; margin-bottom:18px;">
                        What We'll Cover
                      </div>

                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="28" valign="top" style="width:28px; padding-bottom:14px; color:#004aad; font-size:16px; font-weight:700;">&#10003;</td>
                          <td valign="top" style="padding-bottom:14px; font-size:15px; line-height:23px; color:#666666;">Section-wise TDS calculations automatically</td>
                        </tr>
                        <tr>
                          <td width="28" valign="top" style="width:28px; padding-bottom:14px; color:#004aad; font-size:16px; font-weight:700;">&#10003;</td>
                          <td valign="top" style="padding-bottom:14px; font-size:15px; line-height:23px; color:#666666;">Auto-creating TDS vouchers inside Tally</td>
                        </tr>
                        <tr>
                          <td width="28" valign="top" style="width:28px; padding-bottom:14px; color:#004aad; font-size:16px; font-weight:700;">&#10003;</td>
                          <td valign="top" style="padding-bottom:14px; font-size:15px; line-height:23px; color:#666666;">Real-time deduction tracking</td>
                        </tr>
                        <tr>
                          <td width="28" valign="top" style="width:28px; color:#004aad; font-size:16px; font-weight:700;">&#10003;</td>
                          <td valign="top" style="font-size:15px; line-height:23px; color:#666666;">Seamless 24Q and 26Q return preparation</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-top:24px; background:#f8f9fb; border:1px solid #e5e7eb; border-radius:8px;">
                  <tr>
                    <td style="padding:24px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="46" valign="middle" style="width:46px; padding-bottom:16px; font-size:18px;">&#128197;</td>
                          <td valign="middle" style="padding-bottom:16px;">
                            <div style="font-size:12px; line-height:17px; color:#6b7280; font-weight:500;">Meeting Date</div>
                            <div style="margin-top:2px; font-size:14px; line-height:20px; color:#1a1a1a; font-weight:600;">${demoDate}</div>
                          </td>
                        </tr>
                        <tr>
                          <td width="46" valign="middle" style="width:46px; padding-bottom:16px; font-size:18px;">&#128336;</td>
                          <td valign="middle" style="padding-bottom:16px;">
                            <div style="font-size:12px; line-height:17px; color:#6b7280; font-weight:500;">Meeting Time</div>
                            <div style="margin-top:2px; font-size:14px; line-height:20px; color:#1a1a1a; font-weight:600;">${demoTime}</div>
                          </td>
                        </tr>
                        <tr>
                          <td width="46" valign="middle" style="width:46px; font-size:18px;">&#128279;</td>
                          <td valign="middle">
                            <div style="font-size:12px; line-height:17px; color:#6b7280; font-weight:500;">Meet Link</div>
                            <div style="margin-top:2px; font-size:14px; line-height:20px; font-weight:600;">
                              <a href="${meetLink}" style="color:#008080; text-decoration:none;">Join Google Meet</a>
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-top:24px;">
                  <tr>
                    <td align="center" style="background:#004aad; background-image:linear-gradient(135deg,#004aad 0%,#0066ff 100%); border-radius:4px;">
                      <a href="${meetLink}" style="display:block; padding:13px 20px; color:#ffffff; text-decoration:none; text-align:center; font-size:14px; line-height:20px; font-weight:700;">
                        Join Meeting Now
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="height:1px; line-height:1px; background:#e8e8e8; margin:24px 0 0;">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td class="mobile-padding" style="padding:30px 40px; background:#ffffff; border-top:1px solid #f0f0f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="footer-column" valign="top">
                      <div style="font-size:16px; line-height:22px; font-weight:700; color:#1a1a1a; margin-bottom:4px;">TallyKonnect</div>
                      <div style="font-size:13px; line-height:19px; color:#999999;">Business Automation Made Simple</div>
                    </td>
                    <td class="footer-column" align="right" valign="top" style="font-size:13px; line-height:20px;">
                      <a href="${WEBSITE_URL}" style="color:#999999; text-decoration:none;">Website</a>
                      <span style="color:#d0d0d0;">&nbsp;&nbsp;&nbsp;</span>
                      <a href="mailto:${CONTACT_EMAIL}" style="color:#999999; text-decoration:none;">Contact</a>
                      <span style="color:#d0d0d0;">&nbsp;&nbsp;&nbsp;</span>
                      <a href="${UNSUBSCRIBE_URL}" style="color:#999999; text-decoration:none;">Unsubscribe</a>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:20px; padding-top:20px; border-top:1px solid #f0f0f0; text-align:center; font-size:11px; line-height:17px; color:#cccccc;">
                  &copy; ${currentYear} TallyKonnect. All rights reserved.
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildTallyKonnectRescheduleHtml(input: RescheduleEmailInput) {
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const meetLink = escapeHtml(input.meetLink || '#');
  const newDate = escapeHtml(input.date || '-');
  const newTime = escapeHtml(input.time || '-');
  const logoUrl = escapeHtml(publicAssetUrl('/images/logo.png'));
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Demo Rescheduled - TallyKonnect</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
 
        body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
 
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
 
        /* Header */
        .header {
            background: #ffffff;
            padding: 25px 40px;
            display: flex;
            align-items: center;
            border-bottom: 1px solid #f0f0f0;
        }
 
        .logo-space {
            width: 50px;
            height: 50px;
            background: #f0f0f0;
            border-radius: 4px;
            margin-right: 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #999;
            font-size: 12px;
            text-align: center;
            flex-shrink: 0;
        }
 
        .logo-placeholder {
            font-size: 11px;
            color: #999;
            padding: 5px;
        }
 
        .brand-name {
            font-size: 18px;
            font-weight: 700;
            color: #004aad;
            letter-spacing: -0.5px;
        }
 
        /* Hero — same blue as original */
        .hero {
            background: linear-gradient(135deg, #004aad 0%, #0066ff 100%);
            padding: 40px 40px;
            color: white;
            position: relative;
            overflow: hidden;
        }
 
        .hero::before {
            content: '';
            position: absolute;
            top: 20px;
            right: 40px;
            width: 40px;
            height: 40px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 50%;
            animation: float 3s ease-in-out infinite;
        }
 
        .hero::after {
            content: '';
            position: absolute;
            bottom: 40px;
            right: 80px;
            width: 50px;
            height: 50px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 50%;
            animation: float 4s ease-in-out infinite;
        }
 
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }
 
        .hero-content {
            position: relative;
            z-index: 2;
        }
 
        .hero-subtitle {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.9;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
 
        .hero-title {
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 8px;
            line-height: 1.3;
        }
 
        .hero-description {
            font-size: 14px;
            opacity: 0.95;
            line-height: 1.6;
        }
 
        /* Body */
        .body {
            padding: 40px;
        }
 
        .greeting {
            font-size: 16px;
            color: #1a1a1a;
            margin-bottom: 24px;
            font-weight: 600;
        }
 
        .content-text {
            font-size: 15px;
            line-height: 1.8;
            color: #6b7280;
            margin-bottom: 24px;
        }
 
        /* Reschedule notice box */
        .notice-box {
            background: #f0f4ff;
            border-left: 6px solid #004aad;
            padding: 20px 24px;
            margin: 24px 0;
            border-radius: 0;
        }
 
        .notice-icon {
            font-size: 20px;
            line-height: 20px;
            width: 34px;
            vertical-align: top;
        }
 
        .notice-text {
            font-size: 14px;
            color: #1e3a8a;
            line-height: 1.7;
            font-weight: 500;
        }
 
        .notice-text strong {
            font-weight: 700;
            color: #004aad;
        }

        /* New meeting details */
        .meeting-section {
            background: #f8f9fb;
            border: 1px solid #e5e7eb;
            padding: 24px;
            border-radius: 8px;
            margin: 24px 0;
        }
 
        .meeting-section-title {
            font-size: 12px;
            font-weight: 700;
            color: #004aad;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 18px;
        }
 
        .meeting-item {
            display: flex;
            align-items: center;
            margin-bottom: 16px;
        }
 
        .meeting-item:last-child { margin-bottom: 0; }
 
        .meeting-icon {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 14px;
            font-size: 16px;
            flex-shrink: 0;
        }
 
        .meeting-icon.date { color: #dc2626; }
        .meeting-icon.time { color: #0066cc; }
        .meeting-icon.link { color: #008080; }
 
        .meeting-info { flex: 1; }
 
        .meeting-label {
            font-size: 12px;
            color: #6b7280;
            font-weight: 500;
            margin-bottom: 2px;
        }
 
        .meeting-value {
            font-size: 14px;
            font-weight: 600;
            color: #1a1a1a;
        }
 
        .meeting-link-value {
            color: #008080;
            text-decoration: none;
            font-weight: 600;
        }
 
        .meeting-link-value:hover { text-decoration: underline; }
 
        /* CTA — same blue as original */
        .cta-button {
            display: block;
            background: linear-gradient(135deg, #004aad 0%, #0066ff 100%);
            color: white;
            padding: 13px 0;
            border-radius: 4px;
            text-align: center;
            text-decoration: none;
            font-size: 14px;
            font-weight: 700;
            margin: 24px 0;
            transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 4px 12px rgba(0, 74, 173, 0.3);
        }
 
        .cta-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0, 74, 173, 0.4);
        }
 
 
 
        .divider {
            height: 1px;
            background: #e8e8e8;
            margin: 24px 0;
        }
 
        /* Footer */
        .footer {
            background: #ffffff;
            padding: 30px 40px;
            border-top: 1px solid #f0f0f0;
        }
 
        .footer-brand-name {
            font-size: 16px;
            font-weight: 700;
            color: #1a1a1a;
            margin-bottom: 4px;
        }
 
        .footer-tagline {
            font-size: 13px;
            color: #999;
            font-weight: 400;
        }
 
        .footer-links a {
            font-size: 13px;
            color: #999;
            text-decoration: none;
            font-weight: 400;
            transition: color 0.2s;
        }
 
        .footer-links a:hover { color: #004aad; }
 
        .footer-bottom {
            text-align: center;
            padding-top: 20px;
            border-top: 1px solid #f0f0f0;
            font-size: 11px;
            color: #ccc;
        }
 
        @media (max-width: 600px) {
            .header, .body, .footer, .hero { padding-left: 20px; padding-right: 20px; }
            .hero { padding: 40px 20px; }
            .hero-title { font-size: 24px; }
            .header { padding: 20px; }
            .logo-space { width: 40px; height: 40px; }
            .brand-name { font-size: 16px; }
        }
    </style>
</head>
<body style="margin:0; padding:0; background:#f5f5f5; font-family:Arial, Helvetica, sans-serif; color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f5f5f5;">
      <tr>
        <td align="center" style="padding:20px 10px;">
          <table class="email-container" role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background:#ffffff; border-radius:4px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.10);">
 
            <!-- Header -->
            <tr>
              <td class="header" style="padding:25px 40px; background:#ffffff; border-bottom:1px solid #f0f0f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="65" valign="middle" style="width:65px;">
                      <img src="${logoUrl}" alt="TallyKonnect logo" width="50" style="display:block; width:50px; height:auto; border:0; outline:none;">
                    </td>
                    <td valign="middle" style="font-size:18px; line-height:24px; font-weight:700; color:#004aad; letter-spacing:-0.5px;">
                      TallyKonnect
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
 
            <!-- Hero -->
            <tr>
              <td class="hero" style="padding:40px; color:#ffffff; background:#004aad; background-image:linear-gradient(135deg,#004aad 0%,#0066ff 100%);">
            <div class="hero-content">
                <div class="hero-subtitle">🗓️ &nbsp;Demo Update</div>
                <div class="hero-title" style="font-size:32px; line-height:42px; font-weight:700; color:#ffffff; margin-bottom:8px;">Your Demo Has Been<br>Rescheduled</div>
                <div class="hero-description" style="font-size:14px; line-height:22px; color:#edf4ff;">
                    We've updated your Smart TDS demo to a new time slot
                </div>
            </div>
              </td>
            </tr>
 
        <!-- Body -->
            <tr>
              <td class="body" style="padding:40px; background:#ffffff;">
            <div class="greeting">Hi ${customerName},</div>
 
            <div class="content-text">
                We wanted to let you know that your upcoming Smart TDS demo has been rescheduled. Please find the updated meeting details below and make sure to add it to your calendar.
            </div>
 
            <!-- Notice banner -->
            <div class="notice-box">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td class="notice-icon" width="34" valign="top">&#9888;&#65039;</td>
                        <td class="notice-text" valign="top">
                            <strong>Your demo time has changed.</strong> The previous slot is no longer valid. Please use the new date and time below to join your session.
                        </td>
                    </tr>
                </table>
            </div>
 
 
 
            <!-- Full updated meeting details -->
            <div class="meeting-section">
                <div class="meeting-section-title">Updated Meeting Details</div>
                <div class="meeting-item">
                    <div class="meeting-icon date">📅</div>
                    <div class="meeting-info">
                        <div class="meeting-label">New Meeting Date</div>
                        <div class="meeting-value">${newDate}</div>
                    </div>
                </div>
                <div class="meeting-item">
                    <div class="meeting-icon time">🕐</div>
                    <div class="meeting-info">
                        <div class="meeting-label">New Meeting Time</div>
                        <div class="meeting-value">${newTime}</div>
                    </div>
                </div>
                <div class="meeting-item">
                    <div class="meeting-icon link">🔗</div>
                    <div class="meeting-info">
                        <div class="meeting-label">Meet Link</div>
                        <a href="${meetLink}" class="meeting-link-value">Join Google Meet</a>
                    </div>
                </div>
            </div>
 
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin:24px 0;">
                <tr>
                    <td align="center" style="background:#004aad; border-radius:4px;">
                        <a href="${meetLink}" style="display:block; padding:13px 20px; color:#ffffff; text-decoration:none; font-size:14px; line-height:20px; font-weight:700;">
                            Join Meeting Now
                        </a>
                    </td>
                </tr>
            </table>
 
 
 
            <div class="divider"></div>
              </td>
            </tr>
 
        <!-- Footer -->
            <tr>
              <td class="footer" style="padding:30px 40px; background:#ffffff; border-top:1px solid #f0f0f0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-bottom:20px;">
                <tr>
                    <td valign="top">
                        <div class="footer-brand-name">TallyKonnect</div>
                        <div class="footer-tagline">Business Automation Made Simple</div>
                    </td>
                    <td class="footer-links" align="right" valign="top" style="font-size:13px; line-height:20px; white-space:nowrap;">
                        <a href="${WEBSITE_URL}">Website</a>
                        <span style="display:inline-block; width:24px;">&nbsp;</span>
                        <a href="mailto:${CONTACT_EMAIL}">Contact</a>
                        <span style="display:inline-block; width:24px;">&nbsp;</span>
                        <a href="${UNSUBSCRIBE_URL}">Unsubscribe</a>
                    </td>
                </tr>
            </table>
            <div class="footer-bottom">
                &copy; ${currentYear} TallyKonnect. All rights reserved.
            </div>
              </td>
            </tr>
 
          </table>
        </td>
      </tr>
    </table>
</body>
</html>
 `;
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
    'Unsubscribe: https://tallykonnect.com/unsubscribe',
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

export function buildRescheduleEmail(input: RescheduleEmailInput) {
  const greeting = emailGreeting(input.fullName);
  const text = [
    greeting,
    '',
    'Your Smart TDS demo with TallyKonnect has been rescheduled.',
    '',
    `Previous Date: ${input.oldDate || 'Previous date'}`,
    `Previous Time: ${input.oldTime || 'Previous time'}`,
    '',
    `New Date: ${input.date || '-'}`,
    `New Time: ${input.time || '-'}`,
    `Google Meet Link: ${input.meetLink}`,
    '',
    'Please use the updated link above to join at the new scheduled time.',
    '',
    'Unsubscribe: https://tallykonnect.com/unsubscribe',
    '',
    `Regards,`,
    SIGNATURE_NAME
  ].join('\r\n');

  const html = buildTallyKonnectRescheduleHtml(input);

  return {
    subject: 'Smart TDS Demo Rescheduled',
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
    'Unsubscribe: https://tallykonnect.com/unsubscribe',
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

export function buildNoResponseEmail(input: NoResponseEmailInput) {
  const greeting = emailGreeting(input.fullName);
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const logoUrl = escapeHtml(publicAssetUrl('/images/logo.png'));
  const currentYear = new Date().getFullYear();
  const subject = 'We missed you at the Smart TDS demo';

  const text = [
    greeting,
    '',
    'We noticed that you were unable to attend the scheduled Smart TDS demo.',
    '',
    'No worries. Whenever you are ready, you can contact our team and we will help you arrange another demo at a time that works best for you.',
    '',
    'Contact: info@tallykonnect.com',
    'Website: https://tallykonnect.com',
    'Unsubscribe: https://tallykonnect.com/unsubscribe',
    '',
    'Regards,',
    'Team TallyKonnect'
  ].join('\r\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Missed Demo - TallyKonnect</title>
    <style>
      @media only screen and (max-width: 600px) {
        .email-container { width:100% !important; }
        .mobile-padding { padding-left:20px !important; padding-right:20px !important; }
        .steps-column { display:block !important; width:100% !important; padding:0 0 12px !important; }
        .footer-column { display:block !important; width:100% !important; text-align:center !important; padding:5px 0 !important; }
      }
    </style>
  </head>
 
  <body style="margin:0; padding:0; background:#f5f5f5; font-family:Arial, Helvetica, sans-serif; color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f5f5f5;">
      <tr>
        <td align="center" style="padding:20px 10px;">
          <table class="email-container" role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background:#ffffff; border-radius:4px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.10);">
 
            <!-- HEADER -->
            <tr>
              <td class="mobile-padding" style="padding:25px 40px; background:#ffffff; border-bottom:1px solid #f0f0f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="65" valign="middle" style="width:65px;">
                      <img src="${logoUrl}" alt="TallyKonnect logo" width="50" style="display:block; width:50px; height:auto; border:0; outline:none;">
                    </td>
                    <td valign="middle" style="font-size:18px; line-height:24px; font-weight:700; color:#004aad; letter-spacing:-0.5px;">
                      TallyKonnect
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
 
            <!-- HERO -->
            <tr>
              <td class="mobile-padding" style="padding:40px; color:#ffffff; background:#004aad; background-image:linear-gradient(135deg,#004aad 0%,#0066ff 100%);">
                <div style="font-size:12px; line-height:18px; font-weight:600; text-transform:uppercase; letter-spacing:1px; color:#e9f1ff; margin-bottom:15px;">
                  We Missed You &#x1F979;
                </div>
                <div style="font-size:32px; line-height:42px; font-weight:700; color:#ffffff; margin-bottom:8px;">
                  Sorry We Couldn't<br>Connect This Time
                </div>
                <div style="font-size:14px; line-height:22px; color:#edf4ff;">
                  We're here whenever you're ready for your Smart TDS demo
                </div>
              </td>
            </tr>
 
            <!-- BODY -->
            <tr>
              <td class="mobile-padding" style="padding:40px; background:#ffffff;">
 
                <!-- Greeting -->
                <div style="font-size:16px; line-height:23px; color:#1a1a1a; margin-bottom:20px; font-weight:600;">
                  Hi ${customerName},
                </div>
 
                <!-- Intro text -->
                <p style="margin:0 0 24px; font-size:15px; line-height:27px; color:#6b7280;">
                  We noticed that you were unable to attend the scheduled Smart TDS demo. We completely understand that things come up!
                </p>
 
                <!-- Info box -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f0f4ff; border-left:6px solid #004aad; margin-bottom:28px;">
                  <tr>
                    <td style="padding:22px 24px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="36" valign="top" style="width:36px; font-size:22px; line-height:1; padding-top:2px;">
                            &#x1F4A1;
                          </td>
                          <td valign="top" style="font-size:14px; line-height:25px; color:#374151;">
                            <strong style="display:block; font-weight:700; color:#004aad; margin-bottom:4px;">No worries, we've got you covered.</strong>
                            Whenever you are ready, you can contact our team and we will help you arrange another demo at a time that works best for you.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
 
                <!-- 3 Step Cards -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-bottom:28px;">
                  <tr>
                    <td class="steps-column" width="33%" valign="top" style="width:33%; padding-right:8px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border:1px solid #e5e7eb; border-radius:10px;">
                        <tr>
                          <td style="padding:18px 14px; text-align:center;">
                            <div style="font-size:26px; line-height:1; margin-bottom:10px;">&#x1F4E9;</div>
                            <div style="font-size:13px; line-height:19px; font-weight:700; color:#1a1a1a; margin-bottom:6px;">Reach Out</div>
                            <div style="font-size:11.5px; line-height:18px; color:#6b7280;">Drop us an email or call us anytime</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td class="steps-column" width="33%" valign="top" style="width:33%; padding-right:8px; padding-left:4px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border:1px solid #e5e7eb; border-radius:10px;">
                        <tr>
                          <td style="padding:18px 14px; text-align:center;">
                            <div style="font-size:26px; line-height:1; margin-bottom:10px;">&#x1F5D3;&#xFE0F;</div>
                            <div style="font-size:13px; line-height:19px; font-weight:700; color:#1a1a1a; margin-bottom:6px;">Pick a Slot</div>
                            <div style="font-size:11.5px; line-height:18px; color:#6b7280;">Choose a date and time that suits you</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td class="steps-column" width="34%" valign="top" style="width:34%; padding-left:4px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border:1px solid #e5e7eb; border-radius:10px;">
                        <tr>
                          <td style="padding:18px 14px; text-align:center;">
                            <div style="font-size:26px; line-height:1; margin-bottom:10px;">&#x1F680;</div>
                            <div style="font-size:13px; line-height:19px; font-weight:700; color:#1a1a1a; margin-bottom:6px;">Get Started</div>
                            <div style="font-size:11.5px; line-height:18px; color:#6b7280;">We will walk you through Smart TDS live</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
 
                <!-- CTA Button -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-bottom:28px;">
                  <tr>
                    <td align="center" style="background:#004aad; background-image:linear-gradient(135deg,#004aad 0%,#0066ff 100%); border-radius:4px;">
                      <a href="mailto:${CONTACT_EMAIL}" style="display:block; padding:13px 20px; color:#ffffff; text-decoration:none; text-align:center; font-size:14px; line-height:20px; font-weight:700;">
                        &#x1F4EC;&nbsp;&nbsp;Contact Our Team
                      </a>
                    </td>
                  </tr>
                </table>
 
                <!-- Divider -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-bottom:28px;">
                  <tr>
                    <td style="height:1px; background:#e8e8e8; font-size:0; line-height:0;">&nbsp;</td>
                  </tr>
                </table>
 
                <!-- Regards -->
                <div style="font-size:14px; line-height:25px; color:#6b7280;">Regards,</div>
                <div style="font-size:14px; line-height:25px; font-weight:700; color:#004aad; margin-top:4px;">Team TallyKonnect</div>
 
              </td>
            </tr>
 
            <!-- FOOTER -->
            <tr>
              <td class="mobile-padding" style="padding:30px 40px; background:#ffffff; border-top:1px solid #f0f0f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="footer-column" valign="top">
                      <div style="font-size:16px; line-height:22px; font-weight:700; color:#1a1a1a; margin-bottom:4px;">TallyKonnect</div>
                      <div style="font-size:13px; line-height:19px; color:#999999;">Business Automation Made Simple</div>
                    </td>
                    <td class="footer-column" align="right" valign="top" style="font-size:13px; line-height:20px;">
                      <a href="${WEBSITE_URL}" style="color:#999999; text-decoration:none;">Website</a>
                      <span style="color:#d0d0d0;">&nbsp;&nbsp;&nbsp;</span>
                      <a href="mailto:${CONTACT_EMAIL}" style="color:#999999; text-decoration:none;">Contact</a>
                      <span style="color:#d0d0d0;">&nbsp;&nbsp;&nbsp;</span>
                      <a href="${UNSUBSCRIBE_URL}" style="color:#999999; text-decoration:none;">Unsubscribe</a>
                    </td>
                  </tr>
                </table>
 
                <div style="margin-top:20px; padding-top:20px; border-top:1px solid #f0f0f0; text-align:center; font-size:11px; line-height:17px; color:#cccccc;">
                  &copy; ${currentYear} TallyKonnect. All rights reserved.
                </div>
              </td>
            </tr>
 
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject,
    text,
    html
  };
}

export function buildRawEmail(message: EmailMessage) {
  const boundary = `tallykonnect_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${senderHeader()}`,
    `To: ${safeHeader(message.to)}`,
    message.cc ? `Cc: ${safeHeader(message.cc)}` : '',
    `Subject: ${safeHeader(message.subject)}`,
    message.eventKey ? `X-TallyKonnect-Event-ID: ${safeHeader(message.eventKey)}` : '',
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
