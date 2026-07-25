import { coerceStoredEmailBrand, type EmailBrandKey } from '../src/lib/emailBrand';

type EmailMessage = {
  to: string;
  cc?: string;
  fromEmail?: string;
  fromName?: string;
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
  brand?: EmailBrandKey | string;
};

type RescheduleEmailInput = DemoEmailInput & {
  oldDate?: string;
  oldTime?: string;
};

type ThankYouEmailInput = {
  fullName?: string;
  brand?: EmailBrandKey | string;
};

type NoResponseEmailInput = {
  fullName?: string;
  brand?: EmailBrandKey | string;
};

const BRAND_NAME = 'TallyKonnect';
const SIGNATURE_NAME = 'Team TallyKonnect';
const BRAND_COLOR = '#18181b';
const MUTED_TEXT = '#64748b';
const WEBSITE_URL = 'https://tallykonnect.com';
const CONTACT_EMAIL = 'info@tallykonnect.com';
const UNSUBSCRIBE_URL = 'https://tallykonnect.com/unsubscribe';

type EmailBrandConfig = {
  key: EmailBrandKey;
  name: string;
  signatureName: string;
  logoPath: string;
  websiteUrl: string;
  websiteLabel: string;
  contactEmail: string;
  phone?: string;
  tagline?: string;
  unsubscribeUrl: string;
};

const EMAIL_BRANDS: Record<EmailBrandKey, EmailBrandConfig> = {
  tallykonnect: {
    key: 'tallykonnect',
    name: 'TallyKonnect',
    signatureName: 'Team TallyKonnect',
    logoPath: '/images/logo.png',
    websiteUrl: 'https://tallykonnect.com',
    websiteLabel: 'tallykonnect.com',
    contactEmail: 'info@tallykonnect.com',
    phone: '+91 83759 38947',
    tagline: 'Business Automation Made Simple',
    unsubscribeUrl: 'https://tallykonnect.com/unsubscribe'
  },
  anywheretally: {
    key: 'anywheretally',
    name: 'AnyWhereTally',
    signatureName: 'Team AnyWhereTally',
    logoPath: '/images/anywheretally.png',
    websiteUrl: 'https://anywheretally.com',
    websiteLabel: 'anywheretally.com',
    contactEmail: 'info@anywheretally.com',
    phone: '+91 83759 38947',
    tagline: 'Your Tally. Anywhere. Anytime.',
    unsubscribeUrl: 'https://anywheretally.com/unsubscribe'
  }
};

const AWT_EMAIL_LOGO_PATH = '/images/email/anywheretally-logo.png';
const AWT_CONFIRMATION_IMAGE_PATH = '/images/email/anywheretally-demo-confirmation.png';
const AWT_THANK_YOU_IMAGE_PATH = '/images/email/anywheretally-demo-thankyou.png';

function getEmailBrand(value: unknown): EmailBrandConfig {
  return EMAIL_BRANDS[coerceStoredEmailBrand(value)];
}

function safeHeader(value: string) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function senderEmailForName(fromName?: string) {
  if (/anywhere\s*tally|anywheretally/i.test(String(fromName || ''))) {
    return process.env.GMAIL_ANYWHERETALLY_FROM_EMAIL || 'info.anywheretally@gmail.com';
  }
  return process.env.GMAIL_TALLYKONNECT_FROM_EMAIL || process.env.GMAIL_FROM_EMAIL || 'demo.tallykonnect@gmail.com';
}

function senderHeader(fromName?: string, fromEmail?: string) {
  const senderEmail = safeHeader(fromEmail || senderEmailForName(fromName));
  const displayName = safeHeader(fromName || process.env.GMAIL_FROM_NAME || BRAND_NAME);
  return `${displayName} <${senderEmail}>`;
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

function brandLogoUrl(brand: EmailBrandConfig) {
  return publicAssetUrl(brand.logoPath);
}

function applyEmailBrand(content: string, brand: EmailBrandConfig) {
  if (brand.key === 'tallykonnect') return content;

  const defaultBrand = EMAIL_BRANDS.tallykonnect;
  const replacements: Array<[string, string]> = [
    [escapeHtml(publicAssetUrl(defaultBrand.logoPath)), escapeHtml(brandLogoUrl(brand))],
    [publicAssetUrl(defaultBrand.logoPath), brandLogoUrl(brand)],
    ['Team TallyKonnect', brand.signatureName],
    ['TallyKonnect Team', brand.signatureName],
    ['TallyKonnect%2C', `${encodeURIComponent(brand.name)}%2C`],
    ['TallyKonnect%20solutions', `${encodeURIComponent(brand.name)}%20solutions`],
    ['TallyKonnect', brand.name],
    ['info@tallykonnect.com', brand.contactEmail],
    ['https://tallykonnect.com/unsubscribe', brand.unsubscribeUrl],
    ['https://tallykonnect.com', brand.websiteUrl],
    ['tallykonnect.com', brand.websiteLabel]
  ];

  return replacements.reduce(
    (next, [from, to]) => next.split(from).join(to),
    content
  );
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
  const iconBackground = muted ? '#f1f5fb' : title === 'Smart Purchase' ? '#fff8e0' : '#eef1fb';
  const iconColor = muted ? '#22b8e8' : title === 'Smart Purchase' ? '#f5a800' : '#1a3c8f';
  const titleColor = muted ? '#999999' : '#1a3c8f';
  const descriptionColor = muted ? '#aaaaaa' : '#666666';
  const ribbon = badge
    ? `<div style="position:absolute; top:12px; right:-42px; z-index:2; width:138px; padding:4px 0; background:#d60000; border-top:1px solid #ff7a7a; border-bottom:1px solid #9f0000; color:#ffffff; font-size:9px; line-height:12px; font-weight:900; letter-spacing:0.6px; text-align:center; text-transform:uppercase; transform:rotate(45deg); -webkit-transform:rotate(45deg); transform-origin:center; -webkit-transform-origin:center; box-shadow:0 2px 4px rgba(0,0,0,0.22);">${escapeHtml(badge).toUpperCase()}</div>`
    : '';

  return `
    <td class="product-column" width="33.33%" valign="top" style="width:33.33%; padding:6px; vertical-align:top;">
      <table role="presentation" width="100%" height="176" cellpadding="0" cellspacing="0" border="0" style="width:100%; height:176px; min-height:176px; background:${backgroundColor}; border:1px solid ${borderColor}; border-radius:8px; border-collapse:separate; position:relative; overflow:hidden;">
        <tr>
          <td valign="top" height="174" style="height:174px; padding:16px 14px 14px; vertical-align:top; position:relative; overflow:hidden;">
            ${ribbon}
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
                  &nbsp;
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

function buildAnyWhereTallyScheduledHtml(input: DemoEmailInput, brand: EmailBrandConfig) {
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const meetLink = escapeHtml(input.meetLink || '#');
  const demoDate = escapeHtml(input.date || '-');
  const demoTime = escapeHtml(input.time || '-');
  const logoUrl = escapeHtml(publicAssetUrl(AWT_EMAIL_LOGO_PATH));
  const sideImageUrl = escapeHtml(publicAssetUrl(AWT_CONFIRMATION_IMAGE_PATH));
  const websiteUrl = escapeHtml(brand.websiteUrl);
  const websiteLabel = escapeHtml(brand.websiteLabel);
  const tagline = escapeHtml(brand.tagline || 'Your Tally. Anywhere. Anytime.');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AnyWhereTally - Demo Confirmation</title>
</head>
<body style="margin:0; padding:0; background-color:#eef1f6; font-family:'Segoe UI', Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef1f6; padding:30px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#f5b400; height:5px; line-height:5px; font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 40px 20px 40px; border-bottom:1px solid #eef1f6;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" valign="middle">
                    <img src="${logoUrl}" alt="AnyWhereTally Logo" height="46" style="display:block; border:0; outline:none;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 10px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="top" width="58%" style="padding-right:20px;">
                    <p style="margin:0 0 14px 0; font-size:17px; color:#2b2f38;">Hi ${customerName},</p>
                    <h1 style="margin:0 0 18px 0; font-size:30px; line-height:1.25; color:#1a56db; font-weight:800;">
                      Your Tally Mobile App demo is confirmed.
                    </h1>
                    <p style="margin:0; font-size:15px; line-height:1.6; color:#5a6270;">
                      We're excited to show you how AnyWhereTally can simplify your business on the go.
                    </p>
                  </td>
                  <td valign="top" width="42%" align="center">
                    <img src="${sideImageUrl}" alt="App preview" width="220" style="display:block; max-width:220px; width:100%; height:auto; border:0; outline:none;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f9fc; border-left:4px solid #f5b400; border-radius:8px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 16px 0; font-size:14px; letter-spacing:0.5px; color:#1a56db; font-weight:700;">WHAT WE'LL COVER</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
                      <tr>
                        <td valign="top" style="padding-right:10px; font-size:15px; color:#1a56db;">&#10003;</td>
                        <td style="font-size:14.5px; color:#3a3f4b; line-height:1.5;">Real-time Tally data sync across devices</td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
                      <tr>
                        <td valign="top" style="padding-right:10px; font-size:15px; color:#1a56db;">&#10003;</td>
                        <td style="font-size:14.5px; color:#3a3f4b; line-height:1.5;">Live access to sales, profit, receivables, and payables</td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
                      <tr>
                        <td valign="top" style="padding-right:10px; font-size:15px; color:#1a56db;">&#10003;</td>
                        <td style="font-size:14.5px; color:#3a3f4b; line-height:1.5;">Automatically create vouchers in Tally by simply uploading your bills.</td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="top" style="padding-right:10px; font-size:15px; color:#1a56db;">&#10003;</td>
                        <td style="font-size:14.5px; color:#3a3f4b; line-height:1.5;">Secure multi-user access with role-based permissions</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8ebf0; border-radius:8px;">
                <tr>
                  <td style="padding:16px 24px; border-bottom:1px solid #eef1f6;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:15px; padding-right:12px;">&#128197;</td>
                        <td style="font-size:14px; color:#1a1f29; font-weight:700; padding-right:8px;">Date:</td>
                        <td style="font-size:14px; color:#5a6270;">${demoDate}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 24px; border-bottom:1px solid #eef1f6;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:15px; padding-right:12px;">&#128337;</td>
                        <td style="font-size:14px; color:#1a1f29; font-weight:700; padding-right:8px;">Time:</td>
                        <td style="font-size:14px; color:#5a6270;">${demoTime}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:15px; padding-right:12px;">&#128205;</td>
                        <td style="font-size:14px; color:#1a1f29; font-weight:700; padding-right:8px;">Venue:</td>
                        <td style="font-size:14px; color:#5a6270;"><a href="${meetLink}" target="_blank" style="color:#1a56db; text-decoration:none;">Google Meet</a></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-radius:8px; background-color:#1a56db;">
                    <a href="${meetLink}" target="_blank" style="display:block; padding:16px 0; font-size:16px; font-weight:700; color:#ffffff; text-decoration:none;">
                      Join Meeting Now &nbsp;&#8594;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 40px 30px 40px;">
              <p style="margin:0 0 4px 0; font-size:14px; color:#5a6270;">Looking forward to meeting you!</p>
              <p style="margin:0; font-size:14px; color:#1a1f29;">&ndash; Team <span style="color:#1a56db; font-weight:700;">AnyWhereTally</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f7f9fc; padding:18px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="font-size:13px; color:#1a56db; font-weight:600;">${tagline}</td>
                  <td align="right" style="font-size:13px; color:#1a56db;"><a href="${websiteUrl}" target="_blank" style="color:#1a56db; text-decoration:none;">www.${websiteLabel}</a></td>
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

function buildAnyWhereTallyRescheduleHtml(input: RescheduleEmailInput, brand: EmailBrandConfig) {
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const meetLink = escapeHtml(input.meetLink || '#');
  const newDate = escapeHtml(input.date || '-');
  const newTime = escapeHtml(input.time || '-');
  const logoUrl = escapeHtml(brandLogoUrl(brand));
  const websiteUrl = escapeHtml(brand.websiteUrl);
  const contactEmail = escapeHtml(brand.contactEmail);
  const unsubscribeUrl = escapeHtml(brand.unsubscribeUrl);
  const tagline = escapeHtml(brand.tagline || 'Your Tally. Anywhere. Anytime.');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>AnyWhereTally Demo Rescheduled</title>
    <style>
      @media only screen and (max-width: 640px) {
        .awt-wrapper { width:100% !important; }
        .awt-pad { padding-left:22px !important; padding-right:22px !important; }
        .awt-hero-title { font-size:34px !important; line-height:43px !important; }
        .awt-detail-icon { width:52px !important; }
        .awt-footer-column { display:block !important; width:100% !important; text-align:left !important; padding:7px 0 !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:#f4f7fb; font-family:Arial, Helvetica, sans-serif; color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f4f7fb;">
      <tr>
        <td align="center" style="padding:18px 10px;">
          <table class="awt-wrapper" role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:640px; background:#ffffff; overflow:hidden;">
            <tr>
              <td class="awt-pad" style="padding:30px 32px 24px; background:#ffffff;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="88" valign="middle" style="width:88px;">
                      <img src="${logoUrl}" alt="AnyWhereTally logo" width="76" style="display:block; width:76px; height:auto; border:0; outline:none;">
                    </td>
                    <td valign="middle" style="font-size:25px; line-height:32px; color:#004aad; font-weight:900; letter-spacing:-0.4px;">AnyWhereTally</td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="awt-pad" style="padding:0 22px 34px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#005bd7; background-image:linear-gradient(135deg,#004aad 0%,#0066ff 100%); border-radius:7px;">
                  <tr>
                    <td style="padding:42px 36px 48px;">
                      <div style="font-size:17px; line-height:24px; color:#ffffff; font-weight:700; text-transform:uppercase; margin-bottom:26px;">&#128197;&nbsp; Demo Update</div>
                      <div class="awt-hero-title" style="font-size:40px; line-height:52px; color:#ffffff; font-weight:900; letter-spacing:-0.7px;">
                        Your Demo Has Been<br>Rescheduled
                      </div>
                      <div style="margin-top:20px; font-size:20px; line-height:28px; color:#ffffff;">Connect with Tally Mobile App</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="awt-pad" style="padding:0 48px 26px;">
                <div style="font-size:20px; line-height:28px; font-weight:900; color:#111827; margin-bottom:28px;">Hi ${customerName},</div>
                <p style="margin:0; font-size:18px; line-height:34px; color:#334155;">
                  We wanted to let you know that your upcoming Tally Mobile App demo has been rescheduled. Please find the updated meeting details below and make sure to add it to your calendar.
                </p>
              </td>
            </tr>

            <tr>
              <td class="awt-pad" style="padding:0 48px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f3f7ff; border:1px solid #dce7f6; border-left:6px solid #005bd7; border-radius:7px;">
                  <tr>
                    <td width="78" align="center" valign="middle" style="width:78px; padding:24px 8px; font-size:31px; line-height:36px;">&#9888;</td>
                    <td valign="middle" style="padding:24px 24px 24px 0; font-size:16px; line-height:27px; color:#002d91;">
                      <strong style="color:#0050c8;">Your demo time has changed.</strong> The previous slot is no longer valid.<br>
                      Please use the new date and time below to join your session.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="awt-pad" style="padding:0 48px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border:1px solid #d6dee9; border-radius:9px;">
                  <tr>
                    <td colspan="2" style="padding:28px 28px 14px; font-size:17px; line-height:24px; color:#0050c8; font-weight:900; text-transform:uppercase;">Updated Meeting Details</td>
                  </tr>
                  <tr>
                    <td class="awt-detail-icon" width="78" align="center" valign="top" style="width:78px; padding:15px 0 10px; font-size:30px; line-height:36px;">&#128197;</td>
                    <td valign="top" style="padding:15px 26px 10px 0;">
                      <div style="font-size:16px; line-height:24px; color:#475569;">New Meeting Date</div>
                      <div style="font-size:18px; line-height:27px; color:#111827; font-weight:900;">${newDate}</div>
                    </td>
                  </tr>
                  <tr>
                    <td class="awt-detail-icon" width="78" align="center" valign="top" style="width:78px; padding:15px 0 10px; font-size:30px; line-height:36px;">&#128336;</td>
                    <td valign="top" style="padding:15px 26px 10px 0;">
                      <div style="font-size:16px; line-height:24px; color:#475569;">New Meeting Time</div>
                      <div style="font-size:18px; line-height:27px; color:#111827; font-weight:900;">${newTime}</div>
                    </td>
                  </tr>
                  <tr>
                    <td class="awt-detail-icon" width="78" align="center" valign="top" style="width:78px; padding:15px 0 32px; font-size:30px; line-height:36px;">&#128279;</td>
                    <td valign="top" style="padding:15px 26px 32px 0;">
                      <div style="font-size:16px; line-height:24px; color:#475569;">Meet Link</div>
                      <a href="${meetLink}" style="font-size:18px; line-height:27px; color:#0050c8; font-weight:900; text-decoration:none;">Join Google Meet</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="awt-pad" style="padding:0 48px 34px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="background:#005bd7; background-image:linear-gradient(135deg,#004aad 0%,#0066ff 100%); border-radius:7px;">
                      <a href="${meetLink}" style="display:block; padding:19px 18px; color:#ffffff; text-decoration:none; font-size:20px; line-height:26px; font-weight:900;">Join Meeting Now</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="awt-pad" style="padding:0 32px 26px;">
                <div style="height:1px; line-height:1px; background:#dce3ee;">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td class="awt-pad" style="padding:0 34px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="awt-footer-column" width="42%" valign="middle" style="width:42%; padding:0;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="76" valign="middle" style="width:76px;">
                            <img src="${logoUrl}" alt="AnyWhereTally logo" width="66" style="display:block; width:66px; height:auto; border:0; outline:none;">
                          </td>
                          <td valign="middle" style="font-size:21px; line-height:27px; color:#004aad; font-weight:900;">AnyWhereTally</td>
                        </tr>
                      </table>
                      <div style="margin-top:10px; font-size:14px; line-height:20px; color:#475569;">${tagline}</div>
                    </td>
                    <td class="awt-footer-column" align="right" valign="middle" style="font-size:15px; line-height:22px; color:#334155;">
                      <a href="${websiteUrl}" style="color:#334155; text-decoration:none;">Website</a>
                      <span style="color:#cbd5e1;">&nbsp;&nbsp;&nbsp;&nbsp;</span>
                      <a href="mailto:${contactEmail}" style="color:#334155; text-decoration:none;">Contact</a>
                      <span style="color:#cbd5e1;">&nbsp;&nbsp;&nbsp;&nbsp;</span>
                      <a href="${unsubscribeUrl}" style="color:#334155; text-decoration:none;">Unsubscribe</a>
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

function buildAnyWhereTallyThankYouHtml(input: ThankYouEmailInput, brand: EmailBrandConfig) {
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const logoUrl = escapeHtml(publicAssetUrl(AWT_EMAIL_LOGO_PATH));
  const sideImageUrl = escapeHtml(publicAssetUrl(AWT_THANK_YOU_IMAGE_PATH));
  const websiteUrl = escapeHtml(brand.websiteUrl);
  const websiteLabel = escapeHtml(brand.websiteLabel);
  const contactEmail = escapeHtml(brand.contactEmail);
  const phone = escapeHtml(brand.phone || '+91 83759 38947');
  const trialLink = `mailto:${contactEmail}?subject=Start%20My%20Free%2030-Day%20Trial`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AnyWhereTally - Thank You for Attending Demo</title>
</head>
<body style="margin:0; padding:0; background-color:#eef1f6; font-family:'Segoe UI', Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef1f6; padding:30px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#f5b400; height:5px; line-height:5px; font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:26px 40px 18px 40px; border-bottom:1px solid #eef1f6;">
              <img src="${logoUrl}" alt="AnyWhereTally Logo" height="40" style="display:block; border:0; outline:none;" />
            </td>
          </tr>
          <tr>
            <td style="padding:34px 40px 10px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="top" width="55%" style="padding-right:16px;">
                    <p style="margin:0 0 14px 0; font-size:16px; color:#2b2f38;">Hi ${customerName},</p>
                    <h1 style="margin:0 0 18px 0; font-size:28px; line-height:1.25; color:#1a56db; font-weight:800;">
                      Thank you for attending the demo!
                    </h1>
                    <p style="margin:0 0 14px 0; font-size:14.5px; line-height:1.6; color:#5a6270;">
                      We're glad you took the time to explore AnyWhereTally with us.
                    </p>
                    <p style="margin:0; font-size:14.5px; line-height:1.6; color:#5a6270;">
                      To help you experience the app in action, we have <strong style="color:#1a1f29;">something special for you.</strong>
                    </p>
                  </td>
                  <td valign="top" width="45%" align="center">
                    <img src="${sideImageUrl}" alt="AnyWhereTally dashboard preview" width="260" style="display:block; max-width:260px; width:100%; height:auto; border:0; outline:none;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fdf3e3; border-radius:10px;">
                <tr>
                  <td width="90" valign="top" align="center" style="padding:28px 0 28px 24px;">
                    <span style="font-size:44px; line-height:1;">&#127873;</span>
                  </td>
                  <td valign="top" style="padding:28px 24px 28px 18px;">
                    <p style="margin:0 0 10px 0; font-size:18px; color:#1a56db; font-weight:800;">Try it for real &ndash; on us!</p>
                    <p style="margin:0 0 16px 0; font-size:14px; line-height:1.6; color:#3a3f4b;">
                      Get full access to a <strong>live demo setup of a company</strong> and experience the complete app for <strong>30 days &ndash; absolutely free.</strong>
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                      <tr>
                        <td valign="top" style="padding-right:10px; font-size:14px; color:#f5b400;">&#10003;</td>
                        <td style="font-size:13.5px; color:#3a3f4b; line-height:1.5;">Explore all features with real data</td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                      <tr>
                        <td valign="top" style="padding-right:10px; font-size:14px; color:#f5b400;">&#10003;</td>
                        <td style="font-size:13.5px; color:#3a3f4b; line-height:1.5;">See how it fits your daily business operations</td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="top" style="padding-right:10px; font-size:14px; color:#f5b400;">&#10003;</td>
                        <td style="font-size:13.5px; color:#3a3f4b; line-height:1.5;">No commitment &ndash; just real experience</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 40px 20px 40px; text-align:center; border-top:1px solid #eef1f6;">
              <p style="margin:0; font-size:19px; color:#1a1f29; font-weight:800;">Explore our value-added solutions in Tally</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 10px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="top" width="33%" style="padding:0 6px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8ebf0; border-radius:10px;">
                      <tr><td align="center" style="padding:26px 16px 14px 16px;"><span style="font-size:34px;">&#128196;</span></td></tr>
                      <tr><td align="center" style="padding:0 16px 10px 16px;"><p style="margin:0; font-size:15px; color:#1a56db; font-weight:700;">Smart TDS</p></td></tr>
                      <tr><td align="center" style="padding:0 16px 20px 16px;"><p style="margin:0; font-size:12.5px; color:#5a6270; line-height:1.55;">Automated TDS calculation, deduction tracking and seamless reporting in Tally.</p></td></tr>
                      <tr><td align="center" style="padding:0 16px 22px 16px;"><a href="${websiteUrl}" target="_blank" style="display:inline-block; background-color:#1a56db; color:#ffffff; font-size:12.5px; font-weight:700; text-decoration:none; padding:11px 18px; border-radius:6px;">Explore Now &nbsp;&#8594;</a></td></tr>
                    </table>
                  </td>
                  <td valign="top" width="33%" style="padding:0 6px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8ebf0; border-radius:10px;">
                      <tr><td align="center" style="padding:26px 16px 14px 16px;"><span style="font-size:34px;">&#127974;</span></td></tr>
                      <tr><td align="center" style="padding:0 16px 10px 16px;"><p style="margin:0; font-size:15px; color:#1a56db; font-weight:700;">Bank Reconciliation</p></td></tr>
                      <tr><td align="center" style="padding:0 16px 20px 16px;"><p style="margin:0; font-size:12.5px; color:#5a6270; line-height:1.55;">Auto-match bank statements with Tally entries and reconcile in minutes.</p></td></tr>
                      <tr><td align="center" style="padding:0 16px 22px 16px;"><a href="${websiteUrl}" target="_blank" style="display:inline-block; background-color:#1a56db; color:#ffffff; font-size:12.5px; font-weight:700; text-decoration:none; padding:11px 18px; border-radius:6px;">Explore Now &nbsp;&#8594;</a></td></tr>
                    </table>
                  </td>
                  <td valign="top" width="33%" style="padding:0 6px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8ebf0; border-radius:10px;">
                      <tr><td align="center" style="padding:26px 16px 14px 16px;"><span style="font-size:34px;">&#128196;</span></td></tr>
                      <tr><td align="center" style="padding:0 16px 10px 16px;"><p style="margin:0; font-size:15px; color:#1a56db; font-weight:700;">GST Reconciliation</p></td></tr>
                      <tr><td align="center" style="padding:0 16px 20px 16px;"><p style="margin:0; font-size:12.5px; color:#5a6270; line-height:1.55;">Match your GSTR-2B data with purchases in Tally with ease and accuracy.</p></td></tr>
                      <tr><td align="center" style="padding:0 16px 22px 16px;"><a href="${websiteUrl}" target="_blank" style="display:inline-block; background-color:#1a56db; color:#ffffff; font-size:12.5px; font-weight:700; text-decoration:none; padding:11px 18px; border-radius:6px;">Explore Now &nbsp;&#8594;</a></td></tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f5ff; border-radius:10px;">
                <tr>
                  <td width="70" valign="middle" align="center" style="padding:22px 0 22px 20px;"><span style="font-size:32px;">&#128640;</span></td>
                  <td valign="middle" style="padding:22px 16px;">
                    <p style="margin:0 0 6px 0; font-size:16px; color:#1a1f29; font-weight:800;">Ready to get started?</p>
                    <p style="margin:0; font-size:13px; color:#5a6270; line-height:1.5;">Our team will be happy to help you set up your account and make the most of your free trial.</p>
                  </td>
                  <td valign="middle" align="right" style="padding:22px 20px;">
                    <a href="${trialLink}" target="_blank" style="display:inline-block; white-space:nowrap; background-color:#1a56db; color:#ffffff; font-size:13px; font-weight:700; text-decoration:none; padding:13px 20px; border-radius:7px;">Start My Free 30-Day Trial &nbsp;&#8594;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 40px 30px 40px;">
              <p style="margin:0 0 4px 0; font-size:14px; color:#5a6270;">Warm regards,</p>
              <p style="margin:0; font-size:14px; color:#1a56db; font-weight:700;">Team AnyWhereTally</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#eef1f6; padding:18px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="font-size:12.5px; color:#3a3f4b;">&#9993;&nbsp; <a href="mailto:${contactEmail}" style="color:#3a3f4b; text-decoration:none;">${contactEmail}</a></td>
                  <td align="center" style="font-size:12.5px; color:#3a3f4b;">&#128222;&nbsp; ${phone}</td>
                  <td align="right" style="font-size:12.5px; color:#3a3f4b;">&#127760;&nbsp; <a href="${websiteUrl}" target="_blank" style="color:#3a3f4b; text-decoration:none;">www.${websiteLabel}</a></td>
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
  const brand = getEmailBrand(input.brand);
  const greeting = emailGreeting(input.fullName);
  const text = brand.key === 'anywheretally'
    ? [
        greeting,
        '',
        'Your Tally Mobile App demo is confirmed.',
        '',
        'We are excited to show you how AnyWhereTally can simplify your business on the go.',
        '',
        'What we will cover:',
        '- Real-time Tally data sync across devices',
        '- Live access to sales, profit, receivables, and payables',
        '- Automatically create vouchers in Tally by uploading your bills',
        '- Secure multi-user access with role-based permissions',
        '',
        `Date: ${input.date || '-'}`,
        `Time: ${input.time || '-'}`,
        `Google Meet Link: ${input.meetLink}`,
        '',
        'Please use the link above to join at the scheduled time.',
        '',
        `Website: ${brand.websiteUrl}`,
        `Unsubscribe: ${brand.unsubscribeUrl}`,
        '',
        `Regards,`,
        brand.signatureName
      ].join('\r\n')
    : [
        greeting,
        '',
        `Your Smart TDS demo with ${brand.name} has been scheduled.`,
        '',
        'We will show you how Smart TDS helps make TDS work simpler by reducing manual calculation, tracking deductions, and keeping your process ready for returns and compliance.',
        '',
        `Date: ${input.date || '-'}`,
        `Time: ${input.time || '-'}`,
        `Google Meet Link: ${input.meetLink}`,
        '',
        'Please use the link above to join at the scheduled time.',
        '',
        `Unsubscribe: ${brand.unsubscribeUrl}`,
        '',
        `Regards,`,
        brand.signatureName
      ].join('\r\n');

  const html = brand.key === 'anywheretally'
    ? buildAnyWhereTallyScheduledHtml(input, brand)
    : applyEmailBrand(buildTallyKonnectScheduledHtml(input), brand);

  return {
    fromName: brand.name,
    subject: brand.key === 'anywheretally' ? 'Your Tally Mobile App demo is confirmed' : 'Smart TDS Demo Scheduled',
    text,
    html
  };
}

export function buildRescheduleEmail(input: RescheduleEmailInput) {
  const brand = getEmailBrand(input.brand);
  const greeting = emailGreeting(input.fullName);
  const text = brand.key === 'anywheretally'
    ? [
        greeting,
        '',
        'Your Tally Mobile App demo has been rescheduled.',
        '',
        'Your demo time has changed. The previous slot is no longer valid.',
        '',
        `Previous Date: ${input.oldDate || 'Previous date'}`,
        `Previous Time: ${input.oldTime || 'Previous time'}`,
        '',
        `New Meeting Date: ${input.date || '-'}`,
        `New Meeting Time: ${input.time || '-'}`,
        `Google Meet Link: ${input.meetLink}`,
        '',
        'Please use the updated link above to join your session.',
        '',
        `Website: ${brand.websiteUrl}`,
        `Unsubscribe: ${brand.unsubscribeUrl}`,
        '',
        `Regards,`,
        brand.signatureName
      ].join('\r\n')
    : [
        greeting,
        '',
        `Your Smart TDS demo with ${brand.name} has been rescheduled.`,
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
        `Unsubscribe: ${brand.unsubscribeUrl}`,
        '',
        `Regards,`,
        brand.signatureName
      ].join('\r\n');

  const html = brand.key === 'anywheretally'
    ? buildAnyWhereTallyRescheduleHtml(input, brand)
    : applyEmailBrand(buildTallyKonnectRescheduleHtml(input), brand);

  return {
    fromName: brand.name,
    subject: brand.key === 'anywheretally' ? 'Your Demo Has Been Rescheduled' : 'Smart TDS Demo Rescheduled',
    text,
    html
  };
}

export function buildReminderEmail(input: DemoEmailInput) {
  const brand = getEmailBrand(input.brand);
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
    brand.signatureName
  ].join('\r\n');

  const html = applyEmailBrand(emailShell({
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
  }), brand);

  return {
    fromName: brand.name,
    subject: 'Reminder: Your Demo Meeting is starting soon',
    text,
    html
  };
}

export function buildThankYouEmail(input: ThankYouEmailInput) {
  const brand = getEmailBrand(input.brand);
  const greeting = emailGreeting(input.fullName);
  const text = brand.key === 'anywheretally'
    ? [
        greeting,
        '',
        'Thank you for attending the AnyWhereTally demo.',
        '',
        'We are glad you took the time to explore AnyWhereTally with us.',
        '',
        'To help you experience the app in action, we have something special for you: full access to a live demo setup of a company for 30 days, absolutely free.',
        '',
        'You can also explore our value-added solutions in Tally: Smart TDS, Bank Reconciliation, and GST Reconciliation.',
        '',
        `Website: ${brand.websiteUrl}`,
        `Contact: ${brand.contactEmail}`,
        `Phone: ${brand.phone || '+91 83759 38947'}`,
        `Unsubscribe: ${brand.unsubscribeUrl}`,
        '',
        `Regards,`,
        brand.signatureName
      ].join('\r\n')
    : [
        greeting,
        '',
        'Thank you for attending the Smart TDS demo.',
        '',
        'We hope the session gave you a clear view of how Smart TDS simplifies TDS calculations, auto-creates vouchers, and helps keep your returns ready inside Tally.',
        '',
        `You can also explore ${brand.name} automation solutions such as Connected Banking, Smart Purchase, Smart Bank Recon, Smart Reports, AnyWhereTally, and MessageAPI.`,
        '',
        `Website: ${brand.websiteUrl}`,
        `Contact: ${brand.contactEmail}`,
        `Unsubscribe: ${brand.unsubscribeUrl}`,
        '',
        `Regards,`,
        brand.signatureName
      ].join('\r\n');

  const html = brand.key === 'anywheretally'
    ? buildAnyWhereTallyThankYouHtml(input, brand)
    : applyEmailBrand(buildTallyKonnectThankYouHtml(input), brand);

  return {
    fromName: brand.name,
    subject: brand.key === 'anywheretally' ? 'Thank you for attending the AnyWhereTally demo' : 'Thank you for attending the Smart TDS demo',
    text,
    html
  };
}

export function buildNoResponseEmail(input: NoResponseEmailInput) {
  const brand = getEmailBrand(input.brand);
  const greeting = emailGreeting(input.fullName);
  const customerName = escapeHtml(String(input.fullName || '').trim() || 'there');
  const logoUrl = escapeHtml(brandLogoUrl(brand));
  const brandName = escapeHtml(brand.name);
  const logoAlt = escapeHtml(`${brand.name} logo`);
  const signatureName = escapeHtml(brand.signatureName);
  const tagline = escapeHtml(brand.tagline || 'Business Automation Made Simple');
  const websiteUrl = escapeHtml(brand.websiteUrl);
  const contactEmail = escapeHtml(brand.contactEmail);
  const unsubscribeUrl = escapeHtml(brand.unsubscribeUrl);
  const demoProduct = brand.key === 'anywheretally' ? 'Tally Mobile App' : 'Smart TDS';
  const escapedDemoProduct = escapeHtml(demoProduct);
  const currentYear = new Date().getFullYear();
  const subject = `We missed you at the ${demoProduct} demo`;

  const text = [
    greeting,
    '',
    `We noticed that you were unable to attend the scheduled ${demoProduct} demo.`,
    '',
    'No worries. Whenever you are ready, you can contact our team and we will help you arrange another demo at a time that works best for you.',
    '',
    `Contact: ${brand.contactEmail}`,
    `Website: ${brand.websiteUrl}`,
    `Unsubscribe: ${brand.unsubscribeUrl}`,
    '',
    'Regards,',
    brand.signatureName
  ].join('\r\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Missed Demo - ${brandName}</title>
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
                      <img src="${logoUrl}" alt="${logoAlt}" width="50" style="display:block; width:50px; height:auto; border:0; outline:none;">
                    </td>
                    <td valign="middle" style="font-size:18px; line-height:24px; font-weight:700; color:#004aad; letter-spacing:-0.5px;">
                      ${brandName}
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
                  We're here whenever you're ready for your ${escapedDemoProduct} demo
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
                  We noticed that you were unable to attend the scheduled ${escapedDemoProduct} demo. We completely understand that things come up!
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
                            <div style="font-size:11.5px; line-height:18px; color:#6b7280;">We will walk you through ${escapedDemoProduct} live</div>
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
                      <a href="mailto:${contactEmail}" style="display:block; padding:13px 20px; color:#ffffff; text-decoration:none; text-align:center; font-size:14px; line-height:20px; font-weight:700;">
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
                <div style="font-size:14px; line-height:25px; font-weight:700; color:#004aad; margin-top:4px;">${signatureName}</div>
 
              </td>
            </tr>
 
            <!-- FOOTER -->
            <tr>
              <td class="mobile-padding" style="padding:30px 40px; background:#ffffff; border-top:1px solid #f0f0f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="footer-column" valign="top">
                      <div style="font-size:16px; line-height:22px; font-weight:700; color:#1a1a1a; margin-bottom:4px;">${brandName}</div>
                      <div style="font-size:13px; line-height:19px; color:#999999;">${tagline}</div>
                    </td>
                    <td class="footer-column" align="right" valign="top" style="font-size:13px; line-height:20px;">
                      <a href="${websiteUrl}" style="color:#999999; text-decoration:none;">Website</a>
                      <span style="color:#d0d0d0;">&nbsp;&nbsp;&nbsp;</span>
                      <a href="mailto:${contactEmail}" style="color:#999999; text-decoration:none;">Contact</a>
                      <span style="color:#d0d0d0;">&nbsp;&nbsp;&nbsp;</span>
                      <a href="${unsubscribeUrl}" style="color:#999999; text-decoration:none;">Unsubscribe</a>
                    </td>
                  </tr>
                </table>
 
                <div style="margin-top:20px; padding-top:20px; border-top:1px solid #f0f0f0; text-align:center; font-size:11px; line-height:17px; color:#cccccc;">
                  &copy; ${currentYear} ${brandName}. All rights reserved.
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
    fromName: brand.name,
    subject,
    text,
    html
  };
}

export function buildRawEmail(message: EmailMessage) {
  const boundary = `tallykonnect_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${senderHeader(message.fromName, message.fromEmail)}`,
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
