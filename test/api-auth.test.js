import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiAuth } from '../src/http/api-auth.js';

function invoke(expectedToken, headers = {}) {
  const req = { get: (name) => headers[name.toLowerCase()] };
  const result = { nextCalled: false, statusCode: undefined, body: undefined, headers: {} };
  const res = {
    set(name, value) {
      result.headers[name] = value;
      return this;
    },
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };

  createApiAuth(expectedToken)(req, res, () => {
    result.nextCalled = true;
  });
  return result;
}

test('allows local requests when authentication is not configured', () => {
  assert.equal(invoke(undefined).nextCalled, true);
});

test('accepts a valid bearer token', () => {
  assert.equal(invoke('secret', { authorization: 'Bearer secret' }).nextCalled, true);
});

test('accepts a valid x-api-key header', () => {
  assert.equal(invoke('secret', { 'x-api-key': 'secret' }).nextCalled, true);
});

test('rejects missing or invalid credentials', () => {
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
    const result = invoke('secret', headers);
    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.body, { error: 'unauthorized' });
    assert.equal(result.headers['WWW-Authenticate'], 'Bearer');
  }
});
