import { describe, expect, it } from 'vitest';
import { canManageWorkspace } from './permissions.js';

describe('canManageWorkspace', () => {
  it('allows owners and admins only', () => {
    expect(canManageWorkspace('owner')).toBe(true);
    expect(canManageWorkspace('admin')).toBe(true);
    expect(canManageWorkspace('member')).toBe(false);
  });

  it('denies unknown or missing roles', () => {
    expect(canManageWorkspace(undefined)).toBe(false);
    expect(canManageWorkspace('superuser')).toBe(false);
  });
});
