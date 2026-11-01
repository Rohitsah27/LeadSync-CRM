import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db.js';

const app = createApp();
const API = '/api/v1';
const allowedOrigin = 'https://app.leadsync.test';

const validUser = {
  name: 'Asha Rao',
  businessName: 'Rao Realty',
  email: 'asha@example.com',
  password: 'correct-horse-battery',
};

const register = (body = validUser) => request(app).post(`${API}/auth/register`).send(body);
const login = (body = validUser) =>
  request(app).post(`${API}/auth/login`).send({ email: body.email, password: body.password });
const refresh = (cookie) =>
  request(app).post(`${API}/auth/refresh`).set('Cookie', `ls_refresh=${cookie}`);
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function refreshCookie(res) {
  const raw = res.headers['set-cookie']?.find((c) => c.startsWith('ls_refresh='));
  return raw?.split(';')[0].slice('ls_refresh='.length);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function forgeToken(userId, overrides = {}, secret = env.auth.jwtSecret) {
  return jwt.sign(overrides, secret, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: 'leadsync-api',
    audience: 'leadsync-web',
    ...(overrides.exp ? {} : { expiresIn: 600 }),
  });
}

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearTestDb);

describe('POST /auth/register', () => {
  it('creates the owner, their workspace and a session', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: 'Asha Rao',
      email: 'asha@example.com',
      role: 'owner',
    });
    expect(res.body.workspace).toMatchObject({ name: 'Rao Realty' });
    expect(res.body.user.workspaceId).toBe(res.body.workspace.id);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.expiresIn).toBe(env.auth.accessTokenTtlSeconds);

    const workspace = await Workspace.findById(res.body.workspace.id);
    expect(String(workspace.ownerId)).toBe(res.body.user.id);
  });

  it('never exposes password data and stores only a bcrypt hash', async () => {
    const res = await register();

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|correct-horse/);
    expect(res.body.refreshToken).toBeUndefined();

    const stored = await User.findOne({ email: validUser.email })
      .select('+passwordHash')
      .unscoped();
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.passwordHash).not.toContain(validUser.password);
  });

  it('delivers the refresh token only as an httpOnly cookie scoped to the auth routes', async () => {
    const res = await register();
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('ls_refresh='));

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('SameSite=Lax');
    expect(await RefreshToken.countDocuments()).toBe(1);
  });

  it('stores only a hash of the refresh token', async () => {
    const res = await register();
    const token = refreshCookie(res);
    const record = await RefreshToken.findOne();

    expect(record.tokenHash).toBe(sha256(token));
    expect(record.tokenHash).not.toBe(token);
  });

  it('normalizes the email and rejects duplicates case-insensitively', async () => {
    const first = await register({ ...validUser, email: '  Asha@Example.COM ' });
    expect(first.body.user.email).toBe('asha@example.com');

    const second = await register({ ...validUser, email: 'ASHA@example.com' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('EMAIL_IN_USE');
    expect(await Workspace.countDocuments()).toBe(1);
  });

  it('leaves no orphan workspace when two registrations race on the same email', async () => {
    const results = await Promise.all([register(), register()]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments().unscoped()).toBe(1);
    expect(await Workspace.countDocuments()).toBe(1);
  });

  it('gives each business its own workspace', async () => {
    const a = await register();
    const b = await register({ ...validUser, email: 'ben@example.com', businessName: 'Ben Autos' });

    expect(a.body.workspace.id).not.toBe(b.body.workspace.id);
    expect(await Workspace.countDocuments()).toBe(2);
  });

  it.each([
    ['short password', { password: 'short' }, 'password'],
    ['password over 72 bytes', { password: 'a'.repeat(73) }, 'password'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['short name', { name: 'A' }, 'name'],
    ['missing business name', { businessName: undefined }, 'businessName'],
  ])('rejects %s with field details', async (_label, override, field) => {
    const res = await register({ ...validUser, ...override });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path)).toContain(field);
    expect(await User.countDocuments().unscoped()).toBe(0);
  });

  it('rejects a request with no body', async () => {
    const res = await request(app).post(`${API}/auth/register`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('signs in with correct credentials and records the login time', async () => {
    const res = await login({ ...validUser, email: 'ASHA@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('asha@example.com');
    expect(typeof res.body.accessToken).toBe('string');
    expect(refreshCookie(res)).toBeTruthy();

    const user = await User.findOne({ email: validUser.email }).unscoped();
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrongPassword = await login({ ...validUser, password: 'wrong-password-123' });
    const unknownEmail = await login({
      email: 'nobody@example.com',
      password: 'wrong-password-123',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    expect(refreshCookie(wrongPassword)).toBeUndefined();
  });

  it('refuses deactivated accounts', async () => {
    await User.updateOne({ email: validUser.email }, { isActive: false }).unscoped();

    expect((await login()).status).toBe(401);
  });

  it('validates the payload', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'bad' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('access token authentication', () => {
  let user;
  let accessToken;

  beforeEach(async () => {
    const res = await register();
    user = res.body.user;
    accessToken = res.body.accessToken;
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get(`${API}/users/me`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('accepts a valid token', async () => {
    const res = await request(app).get(`${API}/users/me`).set(bearer(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.workspace.id).toBe(user.workspaceId);
  });

  it('reports expired tokens distinctly so clients know to refresh', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = forgeToken(user.id, { iat: now - 3600, exp: now - 60 });
    const res = await request(app).get(`${API}/users/me`).set(bearer(expired));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it.each([
    ['garbage', () => 'not.a.jwt'],
    ['wrong signing secret', (id) => forgeToken(id, {}, 'another-secret-that-is-long-enough-123')],
    ['a token for a user that does not exist', () => forgeToken('64b7f0c2a1b2c3d4e5f60718')],
    ['a non-ObjectId subject', () => forgeToken('not-an-object-id')],
    [
      'an unsigned (alg none) token',
      (id) =>
        [
          Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
          Buffer.from(
            JSON.stringify({ sub: id, iss: 'leadsync-api', aud: 'leadsync-web', exp: 9999999999 }),
          ).toString('base64url'),
          '',
        ].join('.'),
    ],
  ])('rejects %s', async (_label, build) => {
    const res = await request(app)
      .get(`${API}/users/me`)
      .set(bearer(build(user.id)));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('stops honoring tokens once the account is deactivated', async () => {
    await User.updateOne({ _id: user.id }, { isActive: false }).unscoped();
    const res = await request(app).get(`${API}/users/me`).set(bearer(accessToken));

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and returns a working access token', async () => {
    const first = await register();
    const original = refreshCookie(first);

    const res = await refresh(original);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(validUser.email);

    const rotated = refreshCookie(res);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(original);

    const me = await request(app).get(`${API}/users/me`).set(bearer(res.body.accessToken));
    expect(me.status).toBe(200);
  });

  it('rejects a missing or unknown token and clears the cookie', async () => {
    const missing = await request(app).post(`${API}/auth/refresh`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    const unknown = await refresh('does-not-exist');
    expect(unknown.status).toBe(401);
    expect(unknown.headers['set-cookie'].join(';')).toContain('ls_refresh=;');
  });

  it('treats a near-simultaneous reuse as a conflict without ending the session', async () => {
    const original = refreshCookie(await register());
    const winner = await refresh(original);
    const loser = await refresh(original);

    expect(loser.status).toBe(409);
    expect(loser.body.error.code).toBe('REFRESH_CONFLICT');
    expect(loser.headers['set-cookie']).toBeUndefined();

    expect((await refresh(refreshCookie(winner))).status).toBe(200);
  });

  it('revokes the whole session when an already-rotated token is replayed later', async () => {
    const original = refreshCookie(await register());
    const rotated = refreshCookie(await refresh(original));

    await RefreshToken.updateOne(
      { tokenHash: sha256(original) },
      { rotatedAt: new Date(Date.now() - 60_000) },
    );

    expect((await refresh(original)).status).toBe(401);
    expect((await refresh(rotated)).status).toBe(401);
  });

  it('rejects expired refresh tokens', async () => {
    const token = refreshCookie(await register());
    await RefreshToken.updateOne({}, { expiresAt: new Date(Date.now() - 1000) });

    expect((await refresh(token)).status).toBe(401);
  });

  it('refuses to refresh for a deactivated account', async () => {
    const token = refreshCookie(await register());
    await User.updateOne({ email: validUser.email }, { isActive: false }).unscoped();

    expect((await refresh(token)).status).toBe(401);
  });

  it('rejects requests from origins other than the frontend', async () => {
    const token = refreshCookie(await register());

    const evil = await refresh(token).set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('ORIGIN_NOT_ALLOWED');

    const trusted = await refresh(token).set('Origin', allowedOrigin);
    expect(trusted.status).toBe(200);
  });
});

describe('logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const token = refreshCookie(await register());

    const res = await request(app).post(`${API}/auth/logout`).set('Cookie', `ls_refresh=${token}`);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'].join(';')).toContain('ls_refresh=;');

    const reuse = await refresh(token);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('succeeds without a session', async () => {
    expect((await request(app).post(`${API}/auth/logout`)).status).toBe(204);
  });

  it('refuses cross-origin logout requests', async () => {
    const res = await request(app).post(`${API}/auth/logout`).set('Origin', 'https://evil.example');

    expect(res.status).toBe(403);
  });

  it('logout-all signs out every device', async () => {
    const phone = await register();
    const laptop = await login();

    const res = await request(app)
      .post(`${API}/auth/logout-all`)
      .set(bearer(phone.body.accessToken));
    expect(res.status).toBe(204);

    expect((await refresh(refreshCookie(phone))).status).toBe(401);
    expect((await refresh(refreshCookie(laptop))).status).toBe(401);
  });

  it('logout-all requires authentication', async () => {
    expect((await request(app).post(`${API}/auth/logout-all`)).status).toBe(401);
  });
});

describe('profile', () => {
  let accessToken;

  beforeEach(async () => {
    accessToken = (await register()).body.accessToken;
  });

  it('updates only the name', async () => {
    const res = await request(app)
      .patch(`${API}/users/me`)
      .set(bearer(accessToken))
      .send({ name: '  Asha R. ', role: 'admin', email: 'other@example.com', workspaceId: 'x' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      name: 'Asha R.',
      email: 'asha@example.com',
      role: 'owner',
    });
  });

  it('validates the name', async () => {
    const res = await request(app)
      .patch(`${API}/users/me`)
      .set(bearer(accessToken))
      .send({ name: 'A' });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('name');
  });

  it('requires authentication', async () => {
    expect((await request(app).patch(`${API}/users/me`).send({ name: 'Valid Name' })).status).toBe(
      401,
    );
  });
});

describe('POST /users/me/password', () => {
  const newPassword = 'a-brand-new-passphrase';
  let phone;
  let laptop;

  beforeEach(async () => {
    phone = await register();
    laptop = await login();
  });

  const changePassword = (body) =>
    request(app).post(`${API}/users/me/password`).set(bearer(phone.body.accessToken)).send(body);

  it('rejects an incorrect current password', async () => {
    const res = await changePassword({ currentPassword: 'wrong-password-1', newPassword });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('validates and rejects reusing the same password', async () => {
    const weak = await changePassword({
      currentPassword: validUser.password,
      newPassword: 'short',
    });
    expect(weak.status).toBe(400);

    const same = await changePassword({
      currentPassword: validUser.password,
      newPassword: validUser.password,
    });
    expect(same.status).toBe(400);
    expect(same.body.error.details[0].path).toBe('newPassword');
  });

  it('switches passwords, signs out other devices and keeps this one signed in', async () => {
    const res = await changePassword({ currentPassword: validUser.password, newPassword });

    expect(res.status).toBe(200);
    const stillValid = await request(app).get(`${API}/users/me`).set(bearer(res.body.accessToken));
    expect(stillValid.status).toBe(200);
    expect((await refresh(refreshCookie(res))).status).toBe(200);

    expect((await refresh(refreshCookie(laptop))).status).toBe(401);
    expect((await refresh(refreshCookie(phone))).status).toBe(401);
    expect((await login()).status).toBe(401);
    expect((await login({ ...validUser, password: newPassword })).status).toBe(200);
  });

  it('invalidates access tokens issued before the change', async () => {
    await changePassword({ currentPassword: validUser.password, newPassword });

    const issuedEarlier = forgeToken(phone.body.user.id, {
      iat: Math.floor(Date.now() / 1000) - 3600,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const res = await request(app).get(`${API}/users/me`).set(bearer(issuedEarlier));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});
