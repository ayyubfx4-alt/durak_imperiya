import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from '../middleware/error.js';

const MIME_EXT = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
]);

const MAX_BYTES = 4 * 1024 * 1024;

export function adminAssetsRoot() {
  return path.resolve(process.env.ADMIN_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'admin-assets'));
}

function cleanSegment(value, fallback = 'asset') {
  const text = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return text || fallback;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || '').trim());
  if (!match) throw new HttpError(400, 'valid base64 dataUrl is required');
  const mimeType = match[1].toLowerCase();
  if (!MIME_EXT.has(mimeType)) throw new HttpError(400, 'only PNG, JPG, WEBP or SVG images are allowed');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw new HttpError(400, 'uploaded file is empty');
  if (buffer.length > MAX_BYTES) throw new HttpError(400, 'image is too large; maximum is 4 MB');
  return { mimeType, buffer };
}

function sanitizeSvg(buffer) {
  const text = buffer.toString('utf8');
  if (!/<svg[\s>]/i.test(text)) throw new HttpError(400, 'valid SVG content is required');
  if (/<script|<foreignObject|javascript:|on[a-z]+\s*=/i.test(text)) {
    throw new HttpError(400, 'SVG contains unsafe content');
  }
  return Buffer.from(text, 'utf8');
}

export async function saveAdminAsset({ dataUrl, filename, category = 'general' } = {}) {
  const { mimeType, buffer } = parseDataUrl(dataUrl);
  const ext = MIME_EXT.get(mimeType);
  const safeCategory = cleanSegment(category, 'general');
  const base = cleanSegment(path.parse(String(filename || '')).name, 'asset');
  const stored = mimeType === 'image/svg+xml' ? sanitizeSvg(buffer) : buffer;
  const unique = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const outDir = path.join(adminAssetsRoot(), safeCategory);
  const outName = `${base}-${unique}.${ext}`;
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, outName), stored);
  return {
    url: `/api/assets/admin/${safeCategory}/${outName}`,
    filename: outName,
    category: safeCategory,
    mimeType,
    bytes: stored.length,
  };
}
