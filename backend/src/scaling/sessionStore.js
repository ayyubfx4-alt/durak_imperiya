// Sticky session helper — when running behind a load balancer, every socket
// of a given user must land on the same instance OR all instances must
// share state via Redis pub/sub. We default to Redis pub/sub (cheaper) but
// also expose `assignedInstance(userId)` so an ingress can read the affinity
// hint and route consistently.
//
// Algorithm: consistent hashing (FNV-1a) → bucket index → instance name.
// Bucket count = process.env.INSTANCE_COUNT (default 4).
import { isAdapterEnabled } from './redisAdapter.js';

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function assignedInstance(userId) {
  const N = Math.max(1, Number(process.env.INSTANCE_COUNT) || 4);
  const prefix = process.env.INSTANCE_PREFIX || 'durak-be';
  const bucket = fnv1a(String(userId)) % N;
  return `${prefix}-${bucket}`;
}

/** Diagnostic helper for the admin panel — exposes the live scaling mode. */
export function scalingMode() {
  return {
    redis: isAdapterEnabled(),
    instanceId: process.env.INSTANCE_ID || `local-${process.pid}`,
    instanceCount: Number(process.env.INSTANCE_COUNT) || 1,
  };
}
