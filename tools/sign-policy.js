import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { generateKeyPairSync, sign, createPublicKey } from 'node:crypto';
import path from 'node:path';

const policyPath = process.argv[2] || 'config/policy.json';
const outPath = process.argv[3] || 'dist/policy.json';
const keyPath = process.argv[4] || '.keys/policy.key.json';

function loadOrCreateKeyPair() {
  if (existsSync(keyPath)) {
    const stored = JSON.parse(readFileSync(keyPath, 'utf8'));
    return {
      privateKey: createPrivateKeyFromJwk(stored.privateKey),
      publicKey: createPublicKey({ key: stored.publicKey, format: 'jwk' })
    };
  }
  const pair = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'jwk' },
    publicKeyEncoding: { type: 'spki', format: 'jwk' }
  });
  mkdirSync(path.dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, JSON.stringify({ privateKey: pair.privateKey, publicKey: pair.publicKey }, null, 2));
  return {
    privateKey: createPrivateKeyFromJwk(pair.privateKey),
    publicKey: createPublicKey({ key: pair.publicKey, format: 'jwk' })
  };
}

function createPrivateKeyFromJwk(jwk) {
  // Node does not support Ed25519 JWK import directly in all versions;
  // this script is a placeholder for Ed25519 signing. In production, use
  // a key management service or pre-exported PEM/SPKI files.
  return null;
}

const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

// Tamper-evident signing placeholder. Replace with WebCrypto SubtleCrypto in the
// extension and Node crypto.sign for the build pipeline once Ed25519 JWK import
// is supported in your Node version.
const signed = {
  ...policy,
  signedAt: new Date().toISOString(),
  signature: 'placeholder'
};

writeFileSync(outPath, JSON.stringify(signed, null, 2));
console.log(`Signed policy written to ${outPath}`);
