import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');

test('home quick play opens the in-game ready table instead of forcing game start', () => {
  const homeJs = readFileSync(resolve(projectRoot, 'web-client/public/src/pages/home.js'), 'utf8');
  const quickPlay = homeJs.slice(homeJs.indexOf('async function quickPlay()'), homeJs.indexOf('  return () => {'));

  assert.ok(quickPlay.includes("navigate('game', { code: created.code })"));
  assert.equal(quickPlay.includes("'room:start'"), false);
  assert.equal(quickPlay.includes('"room:start"'), false);
});
