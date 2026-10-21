import { describe, it, expect, vi } from 'vitest';
import { createApi, ApiError } from '../../packages/core/api.js';

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

function make(responses, opts = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  });
  const api = createApi({ baseUrl: 'https://api.test/api/v1', getToken: async () => 'tok', fetchImpl, ...opts });
  return { api, calls, fetchImpl };
}

describe('createApi', () => {
  it('sends the extension token and never cookies', async () => {
    const { api, calls } = make([json(200, { user: { name: 'Dennis' } })]);
    await api.me();
    expect(calls[0].url).toBe('https://api.test/api/v1/extension/me');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
    expect(calls[0].init.credentials).toBe('omit');
  });

  it('exchanges a code without any token', async () => {
    const { api, calls } = make([json(200, { token: 't' })]);
    await api.exchange('code123', 'Google Chrome');
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(calls[0].init.body)).toEqual({ code: 'code123', device_name: 'Google Chrome' });
  });

  it('only sends create_new when asked', async () => {
    const { api, calls } = make([json(201, {}), json(201, {})]);
    await api.createVacancy({ title: 'A' });
    await api.createVacancy({ title: 'A' }, { createNew: true });
    expect(JSON.parse(calls[0].init.body)).toEqual({ title: 'A' });
    expect(JSON.parse(calls[1].init.body)).toEqual({ title: 'A', create_new: true });
  });

  it('clears the connection on 401 with a plain message', async () => {
    const onUnauthorised = vi.fn();
    const { api } = make([json(401, { message: 'Unauthenticated.' })], { onUnauthorised });
    const err = await api.me().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/Connect again/);
    expect(onUnauthorised).toHaveBeenCalled();
  });

  it('shows the first validation error', async () => {
    const { api } = make([json(422, { message: 'x', errors: { title: ['The title field is required.'] } })]);
    await expect(api.createVacancy({})).rejects.toThrow('The title field is required.');
  });

  it('retries a GET once when the network drops, but never a POST', async () => {
    const a = make([new Error('net'), json(200, { ok: 1 })]);
    await expect(a.api.me()).resolves.toEqual({ ok: 1 });
    expect(a.fetchImpl).toHaveBeenCalledTimes(2);

    const b = make([new Error('net'), json(201, {})]);
    await expect(b.api.createVacancy({ title: 'A' })).rejects.toThrow(/Cannot reach ATS Engine/);
    expect(b.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives a friendly message for a wrong-extension token', async () => {
    const { api } = make([json(403, { error: 'wrong_extension', message: 'This is the job seeker extension.' })]);
    const err = await api.capture({ url: 'u', html: 'h', selection: '' }).catch((e) => e);
    expect(err.code).toBe('wrong_extension');
    expect(err.message).toBe('This is the job seeker extension.');
  });
});
