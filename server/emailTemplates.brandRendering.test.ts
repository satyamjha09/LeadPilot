import { describe, expect, it } from 'vitest';
import {
  buildMeetingInviteEmail,
  buildNoResponseEmail,
  buildRescheduleEmail,
  buildThankYouEmail
} from './emailTemplates';

describe('brand email template rendering', () => {
  it('renders the supplied AnyWhereTally scheduled, rescheduled, and thank-you template titles', () => {
    const scheduled = buildMeetingInviteEmail({
      fullName: 'Moh Agarwal',
      date: '23-07-2026',
      time: '14:00',
      meetLink: 'https://meet.google.com/demo',
      brand: 'anywheretally'
    });
    const rescheduled = buildRescheduleEmail({
      fullName: 'Moh Agarwal',
      oldDate: '22-07-2026',
      oldTime: '13:00',
      date: '23-07-2026',
      time: '14:00',
      meetLink: 'https://meet.google.com/demo',
      brand: 'anywheretally'
    });
    const thankYou = buildThankYouEmail({
      fullName: 'Moh Agarwal',
      brand: 'anywheretally'
    });

    expect(scheduled.html).toContain('<title>AnyWhereTally Demo Confirmation</title>');
    expect(scheduled.html).toContain('Your Tally Mobile App<br>demo is confirmed.');
    expect(rescheduled.html).toContain('<title>AnyWhereTally Demo Rescheduled</title>');
    expect(rescheduled.html).toContain('Your Demo Has Been<br>Rescheduled');
    expect(thankYou.html).toContain('<title>AnyWhereTally Demo Thank You</title>');
    expect(thankYou.html).toContain('Thank you for<br>attending the demo!');
  });

  it('uses one Not Attended template path with brand-specific product wording', () => {
    const tallyKonnect = buildNoResponseEmail({
      fullName: 'Moh Agarwal',
      brand: 'tallykonnect'
    });
    const anyWhereTally = buildNoResponseEmail({
      fullName: 'Moh Agarwal',
      brand: 'anywheretally'
    });

    expect(tallyKonnect.subject).toBe('We missed you at the Smart TDS demo');
    expect(tallyKonnect.html).toContain('TallyKonnect');
    expect(tallyKonnect.html).toContain('scheduled Smart TDS demo');

    expect(anyWhereTally.subject).toBe('We missed you at the Tally Mobile App demo');
    expect(anyWhereTally.html).toContain('AnyWhereTally');
    expect(anyWhereTally.html).toContain('scheduled Tally Mobile App demo');
    expect(anyWhereTally.html).not.toContain('scheduled Smart TDS demo');
  });
});
