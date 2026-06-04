import crypto from 'node:crypto';
import { query } from '../db.js';

export function iapFingerprint(receipt) {
  return crypto
    .createHash('sha256')
    .update(String(receipt || ''))
    .digest('hex');
}

export async function hasIapFingerprint(fingerprint) {
  const dup = await query(
    `SELECT 1 FROM gold_transactions WHERE metadata->>'iapFingerprint' = $1
     UNION ALL
     SELECT 1 FROM transactions WHERE metadata->>'iapFingerprint' = $1
     LIMIT 1`,
    [fingerprint]
  );
  return !!dup.rows[0];
}
