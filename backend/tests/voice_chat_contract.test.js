import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function readRepo(path) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

test('voice socket contract validates signaling and reject/end lifecycle', () => {
  const socket = readRepo('backend/src/game/socket.js');
  const validate = readRepo('backend/src/middleware/validate.js');

  assert.match(validate, /rtcOffer/);
  assert.match(validate, /rtcAnswer/);
  assert.match(validate, /rtcIceCandidate/);
  assert.match(validate, /'voice:reject': z\.object/);
  assert.match(validate, /reason: safeStr\(80\)\.optional\(\)/);

  assert.match(socket, /parseVoicePayload\('voice:request'/);
  assert.match(socket, /parseVoicePayload\('voice:offer'/);
  assert.match(socket, /requireActiveSession: true/);
  assert.match(socket, /scheduleVoicePendingExpiry/);
  assert.match(socket, /pendingMatches/);
  assert.match(socket, /socket\.on\('voice:reject'/);
  assert.match(socket, /emit\('voice:timeout'/);
  assert.match(socket, /endVoiceSession\(room\.code\)/);
});

test('voice frontend handles reject, timeout, errors, cleanup, and queued ICE', () => {
  const game = readRepo('web-client/public/src/pages/game.js');

  assert.match(game, /pendingVoiceIce/);
  assert.match(game, /flushPendingVoiceIce/);
  assert.match(game, /socket\.on\('voice:reject',\s+onVoiceReject\)/);
  assert.match(game, /socket\.on\('voice:timeout',\s+onVoiceTimeout\)/);
  assert.match(game, /socket\.on\('voice:error',\s+onVoiceError\)/);
  assert.match(game, /socket\.off\('voice:reject', onVoiceReject\)/);
  assert.match(game, /socket\.emit\('voice:reject', \{ code \}/);
  assert.match(game, /socket\.emit\('voice:end', \{ code, reason: 'request-timeout' \}/);
  assert.match(game, /stopVoice\(\{ emitEnd: true/);
  assert.match(game, /pc\.onconnectionstatechange/);
  assert.match(game, /pc\.oniceconnectionstatechange/);
});

test('voice deployment exposes TURN and injects STUN plus TURN ICE servers', () => {
  const compose = readRepo('docker-compose.deploy.yml');
  const entrypoint = readRepo('web-client/docker-entrypoint.d/30-runtime-config.sh');
  const envExample = readRepo('.env.example');
  const productionReadiness = readRepo('backend/src/routes/production.js');

  assert.match(compose, /coturn\/coturn/);
  assert.match(compose, /3478:3478\/udp/);
  assert.match(compose, /49160-49200:49160-49200\/udp/);
  assert.match(compose, /TURN_USER/);
  assert.match(compose, /TURN_PASSWORD/);

  assert.match(entrypoint, /TURN_USER/);
  assert.match(entrypoint, /TURN_PASSWORD/);
  assert.match(entrypoint, /turn_host/);
  assert.match(entrypoint, /stun:stun\.l\.google\.com:19302/);
  assert.match(entrypoint, /turn:/);

  assert.match(envExample, /VOICE_ICE_SERVERS=.*stun:stun\.l\.google\.com:19302/);
  assert.match(envExample, /turn:your-domain\.example:3478\?transport=udp/);

  assert.match(productionReadiness, /VOICE_ICE_SERVERS/);
  assert.match(productionReadiness, /voice\.ice\.turn/);
  assert.match(productionReadiness, /voice\.turn\.credentials/);
  assert.match(productionReadiness, /TURN_PASSWORD/);
});
