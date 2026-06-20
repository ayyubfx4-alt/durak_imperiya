import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'web-client', 'public', 'i18n');
const locales = ['uz', 'ru', 'en'];

function readLocale(locale) {
  const file = path.join(dir, `${locale}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function flatten(value, prefix = '', out = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) out.add(prefix);
    return out;
  }
  for (const [key, nested] of Object.entries(value)) {
    flatten(nested, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

const maps = new Map(locales.map((locale) => [locale, flatten(readLocale(locale))]));
const allKeys = new Set([...maps.values()].flatMap((keys) => [...keys]));
let failed = false;

for (const locale of locales) {
  const keys = maps.get(locale);
  const missing = [...allKeys].filter((key) => !keys.has(key)).sort();
  if (missing.length) {
    failed = true;
    console.error(`${locale}.json missing ${missing.length} keys:`);
    for (const key of missing) console.error(`  - ${key}`);
  } else {
    console.log(`${locale}.json OK (${keys.size} keys)`);
  }
}

if (failed) process.exit(1);
