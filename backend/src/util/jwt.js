// jsonwebtoken is loaded via synchronous createRequire so:
//  1. verifyToken() stays synchronous (hot middleware path)
//  2. The MODULE itself can be imported without error when jsonwebtoken is
//     absent (e.g. test runners) — _jwtLib will be null and all calls degrade
//     gracefully to null/false.
import { createRequire } from 'module';
import { config } from '../config.js';

const _require = createRequire(import.meta.url);
let _jwtLib = null;
try { _jwtLib = _require('jsonwebtoken'); } catch { /* jsonwebtoken not installed */ }

export function signToken(payload) {
  if (!_jwtLib) return null;
  return _jwtLib.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

export function verifyToken(token) {
  if (!_jwtLib) return null;
  try {
    return _jwtLib.verify(token, config.jwt.secret);
  } catch {
    return null;
  }
}
