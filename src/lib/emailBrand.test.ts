import { describe, expect, it } from 'vitest';
import {
  coerceStoredEmailBrand,
  InvalidEmailBrandError,
  parseEmailBrand
} from './emailBrand';

describe('email brand parsing', () => {
  it('accepts tallykonnect', () => {
    expect(parseEmailBrand('tallykonnect')).toBe('tallykonnect');
  });

  it('accepts anywheretally', () => {
    expect(parseEmailBrand('anywheretally')).toBe('anywheretally');
  });

  it('accepts the awt alias', () => {
    expect(parseEmailBrand('awt')).toBe('anywheretally');
  });

  it('rejects undefined', () => {
    expect(() => parseEmailBrand(undefined)).toThrow(InvalidEmailBrandError);
  });

  it('rejects blank values', () => {
    expect(() => parseEmailBrand('   ')).toThrow(InvalidEmailBrandError);
  });

  it('rejects unknown values', () => {
    expect(() => parseEmailBrand('wrong-value')).toThrow(InvalidEmailBrandError);
  });

  it('coerces legacy blank stored values to tallykonnect', () => {
    expect(coerceStoredEmailBrand('')).toBe('tallykonnect');
  });
});
