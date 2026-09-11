import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeVisited, encodeVisited, validateVisited } from '../src/state.js';

function catalog(length, version = '2026.1') {
  return {
    version,
    regionIds: Array.from({ length }, (_, index) => `region-${index}`),
  };
}

test('round-trips empty and selected IDs in stable catalog order', () => {
  const atlas = catalog(6);

  assert.deepEqual(decodeVisited(encodeVisited([], atlas), atlas), []);
  assert.deepEqual(
    decodeVisited(encodeVisited(['region-5', 'region-0', 'region-3'], atlas), atlas),
    ['region-0', 'region-3', 'region-5'],
  );
});

test('round-trips bitset boundary lengths', () => {
  for (const length of [0, 1, 7, 8, 9, 15, 16, 17, 255, 256, 257, 4097]) {
    const atlas = catalog(length);
    const visited = atlas.regionIds.filter((_, index) => index % 3 === 0 || index === length - 1);
    assert.deepEqual(decodeVisited(encodeVisited(visited, atlas), atlas), visited);
  }
});

test('uses compact unpadded base64url without exposing a giant bit string', () => {
  const atlas = catalog(1024);
  const codeword = encodeVisited(atlas.regionIds, atlas);

  assert.match(codeword, /^js1_[A-Za-z0-9_-]+$/);
  assert.equal(codeword.includes('='), false);
  assert.ok(codeword.length < atlas.regionIds.length / 2);
});

test('validates visited IDs and catalog shape', () => {
  const atlas = catalog(2);

  assert.equal(validateVisited([], atlas), true);
  assert.equal(validateVisited(['region-0'], atlas), true);
  assert.throws(() => validateVisited('region-0', atlas), /must be an array/i);
  assert.throws(() => validateVisited(['unknown'], atlas), /unknown region ID/i);
  assert.throws(() => validateVisited(['region-0', 'region-0'], atlas), /duplicate visited/i);
  assert.throws(() => validateVisited([null], atlas), /non-empty string/i);
  assert.throws(() => validateVisited([], null), /catalog must be an object/i);
  assert.throws(() => validateVisited([], { ...atlas, version: '' }), /version/i);
  assert.throws(() => validateVisited([], { ...atlas, regionIds: 'region-0' }), /regionIds/i);
  assert.throws(
    () => validateVisited([], { version: '1', regionIds: ['same', 'same'] }),
    /duplicate catalog region ID/i,
  );
  assert.throws(
    () => validateVisited([], { version: '1', regionIds: ['valid', ''] }),
    /catalog region ID.*non-empty string/i,
  );
});

test('binds codewords to both catalog version and ordered IDs', () => {
  const atlas = catalog(3, '1');
  const codeword = encodeVisited(['region-1'], atlas);

  assert.throws(() => decodeVisited(codeword, { ...atlas, version: '2' }), /does not match/i);
  assert.throws(
    () => decodeVisited(codeword, { ...atlas, regionIds: [...atlas.regionIds].reverse() }),
    /does not match/i,
  );
  assert.throws(
    () => decodeVisited(codeword, { ...atlas, regionIds: ['region-0', 'region-1'] }),
    /does not match/i,
  );
});

test('rejects malformed, truncated, and unsupported payloads', () => {
  const atlas = catalog(1);
  const valid = encodeVisited([], atlas);

  for (const codeword of [
    '',
    'JS1_AAAA',
    'js1_',
    'js1_!',
    'js1_A',
    'js1_====',
    'js1_AA',
    `${valid}=`,
    `${valid.slice(0, -1)}!`,
  ]) {
    assert.throws(() => decodeVisited(codeword, atlas));
  }

  assert.throws(() => decodeVisited(123, atlas), /must be a js1_ string/i);
});

test('rejects modified magic, format, declared size, and fingerprint fields', () => {
  const atlas = catalog(8);
  const valid = encodeVisited([], atlas);

  for (const byteIndex of [0, 1, 2, 3, 7, 11]) {
    const mutated = mutatePayloadByte(valid, byteIndex, 0xff);
    assert.throws(() => decodeVisited(mutated, atlas));
  }
});

test('rejects non-zero padding bits', () => {
  for (const length of [1, 2, 7, 9, 15, 17]) {
    const atlas = catalog(length);
    const valid = encodeVisited([], atlas);
    const mutated = mutatePayloadByte(valid, 15 + Math.floor(length / 8), 0x01);
    assert.throws(() => decodeVisited(mutated, atlas), /padding bits/i);
  }
});

function mutatePayloadByte(codeword, byteIndex, xorMask) {
  const prefix = 'js1_';
  const standard = codeword.slice(prefix.length).replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(Buffer.from(standard, 'base64'));
  bytes[byteIndex] ^= xorMask;
  return prefix + Buffer.from(bytes).toString('base64url');
}
