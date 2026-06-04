import React, { useMemo, useState } from 'react';
import { api, assetUrl } from '../api.js';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const MAX_BYTES = 4 * 1024 * 1024;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

export default function AssetUpload({ value, onChange, category = 'catalog', label = 'Rasm' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState(null);
  const preview = useMemo(() => assetUrl(value), [value]);

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Faqat PNG, JPG, WEBP yoki SVG yuklang.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Rasm 4 MB dan katta bo‘lmasin.');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const saved = await api.uploadAsset({ dataUrl, filename: file.name, category });
      setMeta(saved);
      onChange?.(saved.url);
    } catch (err) {
      setError(err.message || 'Rasm yuklanmadi');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-[#1e1e2e] bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="field-label m-0">{label}</span>
        {meta?.bytes && <span className="text-xs text-slate-500">{Math.ceil(meta.bytes / 1024)} KB</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[86px_1fr]">
        <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-lg border border-[#2a2a38] bg-[#090910]">
          {preview
            ? <img src={preview} alt="" className="h-full w-full object-cover" />
            : <span className="text-xs text-slate-500">Preview</span>}
        </div>
        <div className="min-w-0 space-y-2">
          <label className="btn inline-flex cursor-pointer items-center justify-center">
            <input className="hidden" type="file" accept={ACCEPT} onChange={onFile} disabled={uploading} />
            {uploading ? 'Yuklanmoqda...' : 'Localdan rasm yuklash'}
          </label>
          <input
            className="h-10 w-full px-3 text-sm"
            placeholder="/api/assets/admin/..."
            value={value || ''}
            onChange={(e) => onChange?.(e.target.value)}
          />
          {error && <div className="text-xs font-semibold text-red-300">{error}</div>}
        </div>
      </div>
    </div>
  );
}
