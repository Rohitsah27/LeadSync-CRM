import { describe, expect, it } from 'vitest';
import { mapLeadFields } from '../services/leadMapper.js';

const field = (name, ...values) => ({ name, values });

describe('mapLeadFields', () => {
  it('maps the standard Facebook questions to columns', () => {
    const mapped = mapLeadFields([
      field('full_name', 'Asha Rao'),
      field('email', 'Asha@Example.COM'),
      field('phone_number', '+15551234567'),
    ]);

    expect(mapped).toEqual({
      fullName: 'Asha Rao',
      email: 'asha@example.com',
      phone: '+15551234567',
      customFields: [],
    });
  });

  it('builds the name from first and last name when there is no full name', () => {
    expect(mapLeadFields([field('first_name', 'Asha'), field('last_name', 'Rao')]).fullName).toBe(
      'Asha Rao',
    );
    expect(mapLeadFields([field('first_name', 'Asha')]).fullName).toBe('Asha');
  });

  it('prefers a full name and does not repeat first and last name as custom fields', () => {
    const mapped = mapLeadFields([
      field('full_name', 'Asha Rao'),
      field('first_name', 'Asha'),
      field('last_name', 'Rao'),
    ]);

    expect(mapped.fullName).toBe('Asha Rao');
    expect(mapped.customFields).toEqual([]);
  });

  it('accepts work email and alternative phone questions', () => {
    const mapped = mapLeadFields([
      field('work_email', 'asha@work.example'),
      field('work_phone_number', '555-0100'),
    ]);

    expect(mapped.email).toBe('asha@work.example');
    expect(mapped.phone).toBe('555-0100');
  });

  it('matches question names regardless of case', () => {
    expect(mapLeadFields([field('EMAIL', 'a@b.co')]).email).toBe('a@b.co');
  });

  it('keeps every other answer as a custom field, joining multiple values', () => {
    const mapped = mapLeadFields([
      field('full_name', 'Asha Rao'),
      field('budget', '$500k'),
      field('interests', 'Buying', 'Renting'),
    ]);

    expect(mapped.customFields).toEqual([
      { key: 'budget', value: '$500k' },
      { key: 'interests', value: 'Buying, Renting' },
    ]);
  });

  it('keeps an email that does not look valid as a custom field instead of losing it', () => {
    const mapped = mapLeadFields([field('email', 'not an email')]);

    expect(mapped.email).toBeNull();
    expect(mapped.customFields).toEqual([{ key: 'email', value: 'not an email' }]);
  });

  it('falls back to a valid work email when the personal one is invalid', () => {
    const mapped = mapLeadFields([field('email', 'nope'), field('work_email', 'ok@work.example')]);

    expect(mapped.email).toBe('ok@work.example');
    expect(mapped.customFields).toEqual([{ key: 'email', value: 'nope' }]);
  });

  it('is safe for field names that are awkward as database keys', () => {
    const mapped = mapLeadFields([
      field('a.b', 'dot'),
      field('$set', 'dollar'),
      field('', 'blank'),
    ]);

    expect(mapped.customFields).toEqual([
      { key: 'a.b', value: 'dot' },
      { key: '$set', value: 'dollar' },
      { key: '', value: 'blank' },
    ]);
  });

  it('trims values and drops empty ones', () => {
    const mapped = mapLeadFields([
      field('full_name', '  Asha  '),
      field('company', '   '),
      field('notes', '', '  hello  '),
    ]);

    expect(mapped.fullName).toBe('Asha');
    expect(mapped.customFields).toEqual([{ key: 'notes', value: 'hello' }]);
  });

  it('limits the size of what it stores', () => {
    const many = Array.from({ length: 80 }, (_, index) => field(`q${index}`, 'x'));
    const mapped = mapLeadFields([
      field('full_name', 'n'.repeat(500)),
      field('phone_number', '9'.repeat(200)),
      field('essay', 'e'.repeat(5000)),
      ...many,
    ]);

    expect(mapped.fullName).toHaveLength(200);
    expect(mapped.phone).toHaveLength(50);
    expect(mapped.customFields).toHaveLength(50);
    expect(mapped.customFields[0].value).toHaveLength(2000);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an object', { name: 'x' }],
    ['an empty list', []],
  ])('returns an empty result for %s', (_label, input) => {
    expect(mapLeadFields(input)).toEqual({
      fullName: null,
      email: null,
      phone: null,
      customFields: [],
    });
  });

  it('ignores malformed entries', () => {
    const mapped = mapLeadFields([
      null,
      42,
      { values: ['no name'] },
      { name: 7, values: ['x'] },
      { name: 'full_name', values: 'not an array' },
      { name: 'email', values: [123, 'ok@example.com'] },
    ]);

    expect(mapped.email).toBe('ok@example.com');
    expect(mapped.fullName).toBeNull();
    expect(mapped.customFields).toEqual([]);
  });
});
