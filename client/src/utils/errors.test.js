import { describe, expect, it } from 'vitest';
import { getErrorCode, getErrorMessage, getFieldErrors } from './errors.js';

const apiError = (error) => ({ response: { data: { error } } });

describe('getErrorMessage', () => {
  it('prefers the message sent by the API', () => {
    expect(getErrorMessage(apiError({ message: 'Invalid email or password' }))).toBe(
      'Invalid email or password',
    );
  });

  it('falls back when the API response has no message', () => {
    expect(getErrorMessage({ response: { data: {} } }, 'Custom fallback')).toBe('Custom fallback');
  });

  it('describes network failures', () => {
    expect(getErrorMessage({ request: {} })).toMatch(/Unable to reach the server/);
  });

  it('uses the generic fallback for anything else', () => {
    expect(getErrorMessage(new Error('boom'))).toMatch(/Something went wrong/);
    expect(getErrorMessage(undefined)).toMatch(/Something went wrong/);
  });
});

describe('getFieldErrors', () => {
  it('maps validation details by field and keeps the first message', () => {
    const error = apiError({
      details: [
        { path: 'email', message: 'Enter a valid email address' },
        { path: 'email', message: 'Email is too long' },
        { path: 'password', message: 'Use at least 10 characters' },
      ],
    });

    expect(getFieldErrors(error)).toEqual({
      email: 'Enter a valid email address',
      password: 'Use at least 10 characters',
    });
  });

  it('returns an empty object when there are no details', () => {
    expect(getFieldErrors(apiError({ message: 'x' }))).toEqual({});
    expect(getFieldErrors(undefined)).toEqual({});
  });

  it('ignores details without a field path', () => {
    expect(
      getFieldErrors(apiError({ details: [{ path: '', message: 'Body is required' }] })),
    ).toEqual({});
  });
});

describe('getErrorCode', () => {
  it('reads the API error code', () => {
    expect(getErrorCode(apiError({ code: 'INVALID_CURRENT_PASSWORD' }))).toBe(
      'INVALID_CURRENT_PASSWORD',
    );
    expect(getErrorCode(new Error('x'))).toBeUndefined();
  });
});
