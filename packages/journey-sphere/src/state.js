const CODEWORD_PREFIX = 'js1_';
const FORMAT_VERSION = 1;
const HEADER_BYTES = 15;
const MAX_UINT32 = 0xffffffff;

/**
 * Validate a list of visited region IDs against a catalog.
 *
 * @param {string[]} ids
 * @param {{version: string, regionIds: string[]}} catalog
 * @returns {true}
 */
export function validateVisited(ids, catalog) {
  const regionIds = validateCatalog(catalog);
  validateVisitedIds(ids, regionIds);
  return true;
}

function validateVisitedIds(ids, regionIds) {
  if (!Array.isArray(ids)) {
    throw new TypeError('Visited region IDs must be an array.');
  }

  const knownIds = new Set(regionIds);
  const seenIds = new Set();

  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Every visited region ID must be a non-empty string.');
    }
    if (!knownIds.has(id)) {
      throw new RangeError(`Unknown region ID: ${id}`);
    }
    if (seenIds.has(id)) {
      throw new RangeError(`Duplicate visited region ID: ${id}`);
    }
    seenIds.add(id);
  }
}

/**
 * Encode visited region IDs as a compact, catalog-bound base64url codeword.
 *
 * @param {string[]} ids
 * @param {{version: string, regionIds: string[]}} catalog
 * @returns {string}
 */
export function encodeVisited(ids, catalog) {
  const regionIds = validateCatalog(catalog);
  validateVisitedIds(ids, regionIds);
  const payload = createPayload(descriptorFromCatalog(catalog, regionIds));
  const visited = new Set(ids);
  for (let index = 0; index < regionIds.length; index += 1) {
    if (visited.has(regionIds[index])) {
      payload[HEADER_BYTES + Math.floor(index / 8)] |= 1 << (7 - (index % 8));
    }
  }
  return CODEWORD_PREFIX + encodeBase64Url(payload);
}

/**
 * Describe the catalog fields required to encode/decode indices without the
 * full region ID list.
 *
 * @param {{version: string, regionIds: string[]}} catalog
 * @returns {{version: string, regionCount: number, fingerprint: [number, number]}}
 */
export function describeCatalog(catalog) {
  const regionIds = validateCatalog(catalog);
  return descriptorFromCatalog(catalog, regionIds);
}

/**
 * Encode catalog indices as a compact, catalog-bound base64url codeword.
 *
 * @param {number[]} indices
 * @param {{version: string, regionCount: number, fingerprint: [number, number]}} descriptor
 * @returns {string}
 */
export function encodeVisitedIndices(indices, descriptor) {
  const validDescriptor = validateDescriptor(descriptor);
  validateIndices(indices, validDescriptor.regionCount);
  const payload = createPayload(validDescriptor);

  for (const index of indices) {
    payload[HEADER_BYTES + Math.floor(index / 8)] |= 1 << (7 - (index % 8));
  }

  return CODEWORD_PREFIX + encodeBase64Url(payload);
}

/**
 * Decode a codeword into catalog-ordered visited region IDs.
 *
 * @param {string} codeword
 * @param {{version: string, regionIds: string[]}} catalog
 * @returns {string[]}
 */
export function decodeVisited(codeword, catalog) {
  const regionIds = validateCatalog(catalog);
  const descriptor = descriptorFromCatalog(catalog, regionIds);
  const indices = indicesFromPayload(parseCodeword(codeword, descriptor), descriptor.regionCount);
  return indices.map(index => regionIds[index]);
}

/**
 * Decode a codeword into sorted catalog indices.
 *
 * @param {string} codeword
 * @param {{version: string, regionCount: number, fingerprint: [number, number]}} descriptor
 * @returns {number[]}
 */
export function decodeVisitedIndices(codeword, descriptor) {
  const validDescriptor = validateDescriptor(descriptor);
  const payload = parseCodeword(codeword, validDescriptor);
  return indicesFromPayload(payload, validDescriptor.regionCount);
}

function validateCatalog(catalog) {
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new TypeError('Catalog must be an object.');
  }
  if (typeof catalog.version !== 'string' || catalog.version.length === 0) {
    throw new TypeError('Catalog version must be a non-empty string.');
  }
  if (!Array.isArray(catalog.regionIds)) {
    throw new TypeError('Catalog regionIds must be an array.');
  }
  if (catalog.regionIds.length > MAX_UINT32) {
    throw new RangeError('Catalog contains too many region IDs.');
  }

  const seenIds = new Set();
  for (const id of catalog.regionIds) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Every catalog region ID must be a non-empty string.');
    }
    if (seenIds.has(id)) {
      throw new RangeError(`Duplicate catalog region ID: ${id}`);
    }
    seenIds.add(id);
  }

  return catalog.regionIds;
}

function validateDescriptor(descriptor) {
  if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError('Catalog descriptor must be an object.');
  }
  if (typeof descriptor.version !== 'string' || descriptor.version.length === 0) {
    throw new TypeError('Catalog descriptor version must be a non-empty string.');
  }
  if (!Number.isInteger(descriptor.regionCount) || descriptor.regionCount < 0 || descriptor.regionCount > MAX_UINT32) {
    throw new RangeError('Catalog descriptor regionCount must be a uint32.');
  }
  if (!Array.isArray(descriptor.fingerprint) || descriptor.fingerprint.length !== 2 ||
      descriptor.fingerprint.some(value => !Number.isInteger(value) || value < 0 || value > MAX_UINT32)) {
    throw new RangeError('Catalog descriptor fingerprint must contain two uint32 values.');
  }
  return descriptor;
}

function descriptorFromCatalog(catalog, regionIds) {
  return {
    version: catalog.version,
    regionCount: regionIds.length,
    fingerprint: catalogFingerprint(catalog),
  };
}

function validateIndices(indices, regionCount) {
  if (!Array.isArray(indices)) throw new TypeError('Visited region indices must be an array.');
  const seen = new Set();
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= regionCount) {
      throw new RangeError(`Visited region index is out of range: ${index}`);
    }
    if (seen.has(index)) throw new RangeError(`Duplicate visited region index: ${index}`);
    seen.add(index);
  }
}

function createPayload(descriptor) {
  const payload = new Uint8Array(HEADER_BYTES + Math.ceil(descriptor.regionCount / 8));
  payload[0] = 0x4a;
  payload[1] = 0x53;
  payload[2] = FORMAT_VERSION;
  writeUint32(payload, 3, descriptor.regionCount);
  writeUint32(payload, 7, descriptor.fingerprint[0]);
  writeUint32(payload, 11, descriptor.fingerprint[1]);
  return payload;
}

function indicesFromPayload(payload, regionCount) {
  const indices = [];
  for (let index = 0; index < regionCount; index += 1) {
    const byte = payload[HEADER_BYTES + Math.floor(index / 8)];
    if ((byte & (1 << (7 - (index % 8)))) !== 0) indices.push(index);
  }
  return indices;
}

function parseCodeword(codeword, descriptor) {
  if (typeof codeword !== 'string' || !codeword.startsWith(CODEWORD_PREFIX)) {
    throw new TypeError('JourneySphere codeword must be a js1_ string.');
  }

  const payload = decodeBase64Url(codeword.slice(CODEWORD_PREFIX.length));
  if (payload.length < HEADER_BYTES) {
    throw new RangeError('JourneySphere codeword payload is truncated.');
  }
  if (payload[0] !== 0x4a || payload[1] !== 0x53 || payload[2] !== FORMAT_VERSION) {
    throw new RangeError('JourneySphere codeword has an unsupported format.');
  }

  const encodedRegionCount = readUint32(payload, 3);
  const expectedLength = HEADER_BYTES + Math.ceil(encodedRegionCount / 8);
  if (payload.length !== expectedLength) {
    throw new RangeError('JourneySphere codeword has an invalid payload length.');
  }
  if (encodedRegionCount !== descriptor.regionCount ||
      readUint32(payload, 7) !== descriptor.fingerprint[0] ||
      readUint32(payload, 11) !== descriptor.fingerprint[1]) {
    throw new RangeError('JourneySphere codeword does not match this catalog.');
  }

  const unusedBits = (8 - (encodedRegionCount % 8)) % 8;
  if (unusedBits > 0) {
    const finalByte = payload[payload.length - 1];
    const paddingMask = (1 << unusedBits) - 1;
    if ((finalByte & paddingMask) !== 0) {
      throw new RangeError('JourneySphere codeword contains non-zero padding bits.');
    }
  }
  return payload;
}

function catalogFingerprint({ version, regionIds }) {
  const bytes = utf8Bytes(JSON.stringify([version, regionIds]));
  let fnv = 0x811c9dc5;
  let djb = 0x1505;

  for (const byte of bytes) {
    fnv ^= byte;
    fnv = Math.imul(fnv, 0x01000193);
    djb = Math.imul(djb, 33) ^ byte;
  }

  return [fnv >>> 0, djb >>> 0];
}

function utf8Bytes(value) {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(value);
  }

  const bytes = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBase64Url(bytes) {
  let encoded = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const block =
      (bytes[index] << 16) |
      ((remaining > 1 ? bytes[index + 1] : 0) << 8) |
      (remaining > 2 ? bytes[index + 2] : 0);

    encoded += BASE64URL_ALPHABET[(block >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(block >>> 12) & 63];
    if (remaining > 1) encoded += BASE64URL_ALPHABET[(block >>> 6) & 63];
    if (remaining > 2) encoded += BASE64URL_ALPHABET[block & 63];
  }

  return encoded;
}

function decodeBase64Url(encoded) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
    throw new RangeError('JourneySphere codeword contains invalid base64url data.');
  }

  const outputLength = Math.floor((encoded.length * 6) / 8);
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bitCount = 0;
  let outputIndex = 0;

  for (const character of encoded) {
    const value = BASE64URL_ALPHABET.indexOf(character);
    buffer = (buffer << 6) | value;
    bitCount += 6;

    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outputIndex] = (buffer >>> bitCount) & 0xff;
      outputIndex += 1;
      buffer &= (1 << bitCount) - 1;
    }
  }

  if (buffer !== 0 || encodeBase64Url(bytes) !== encoded) {
    throw new RangeError('JourneySphere codeword contains non-canonical base64url data.');
  }

  return bytes;
}
