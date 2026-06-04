import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const ignoredParts = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'tools',
  '.gradle',
]);
const textExt = new Set([
  '.env', '.example', '.js', '.mjs', '.cjs', '.json', '.md', '.txt',
  '.yml', '.yaml', '.html', '.css', '.gradle', '.properties', '.ps1',
  '.sql', '.xml', '.conf',
]);

const checks = [
  {
    name: 'Stripe secret key',
    pattern: /sk_(test|live)_[A-Za-z0-9]{16,}/,
  },
  {
    name: 'Firebase or service-account private key',
    pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: 'Stripe webhook signing secret',
    pattern: /whsec_[A-Za-z0-9]{16,}/,
  },
];

function shouldSkip(fullPath) {
  const rel = relative(root, fullPath);
  return rel.split(/[\\/]/).some((part) => ignoredParts.has(part));
}

function isTextCandidate(fullPath) {
  const name = fullPath.toLowerCase();
  if (name.endsWith('.env') || name.includes('.env.')) return true;
  return [...textExt].some((ext) => name.endsWith(ext));
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (shouldSkip(full)) continue;
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && isTextCandidate(full)) files.push(full);
  }
  return files;
}

const findings = [];
for (const file of walk(root)) {
  if (statSync(file).size > 2_000_000) continue;
  const text = readFileSync(file, 'utf8');
  for (const check of checks) {
    if (check.pattern.test(text)) {
      findings.push({ file: relative(root, file), type: check.name });
    }
  }
}

if (findings.length) {
  console.error('[security:audit] Secret-looking values found in public project files:');
  for (const f of findings) console.error(`- ${f.type}: ${f.file}`);
  process.exit(1);
}

console.log('[security:audit] No Stripe/Firebase private secrets found in public project files.');
