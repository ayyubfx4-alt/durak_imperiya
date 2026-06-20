/**
 * GeoIP Service — IP manzil orqali davlat kodini aniqlaydi.
 *
 * Xususiyatlar:
 *  - ip-api.com (bepul, API kalit shart emas) dan foydalanadi
 *  - In-memory kesh: bir IP bir marta so'raladi (max 5000 yozuv)
 *  - Lokal IP larni o'tkazib yuboradi (null qaytaradi)
 *  - Xato bo'lganda jim o'tib, null qaytaradi
 *  - updateUserGeo: fonda IP va country_code ni DB ga yozadi
 */

import { query } from '../db.js';

// --- Kesh ---
const GEO_CACHE = new Map();    // ip -> { cc, ts }
const CACHE_MAX = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 soat

function isLocalIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  const clean = ip.replace(/^::ffff:/, '');
  return (
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === 'localhost' ||
    clean.startsWith('10.') ||
    clean.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(clean) ||
    clean === '0.0.0.0'
  );
}

function pruneCache() {
  if (GEO_CACHE.size < CACHE_MAX) return;
  // Eng eski yozuvlarni o'chiramiz
  const now = Date.now();
  for (const [key, val] of GEO_CACHE) {
    if (now - val.ts > CACHE_TTL_MS) {
      GEO_CACHE.delete(key);
    }
    if (GEO_CACHE.size < CACHE_MAX * 0.8) break;
  }
  // Hali ko'p bo'lsa, birinchisini o'chiramiz
  if (GEO_CACHE.size >= CACHE_MAX) {
    const firstKey = GEO_CACHE.keys().next().value;
    if (firstKey !== undefined) GEO_CACHE.delete(firstKey);
  }
}

/**
 * IP manzil orqali 2-harfli davlat kodini qaytaradi.
 * Lokal IP yoki xato bo'lsa — null.
 *
 * @param {string} ip
 * @returns {Promise<string|null>}  e.g. "UZ", "RU", "US", null
 */
export async function lookupCountry(ip) {
  if (isLocalIp(ip)) return null;

  const cached = GEO_CACHE.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.cc;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000); // 4 sekund timeout
    let cc = null;
    try {
      const resp = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`,
        { signal: controller.signal }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data?.status === 'success' && data?.countryCode) {
          cc = String(data.countryCode).toUpperCase().slice(0, 2);
        }
      }
    } finally {
      clearTimeout(timer);
    }

    pruneCache();
    GEO_CACHE.set(ip, { cc, ts: Date.now() });
    return cc;
  } catch (_) {
    // timeout yoki tarmoq xatosi — jim o'tamiz
    return null;
  }
}

/**
 * Foydalanuvchining last_ip va country_code ni fonda yangilaydi.
 * "Fire-and-forget" usulida ishlatiladi — await kerak emas.
 *
 * @param {string|number} userId
 * @param {string} ip
 */
export async function updateUserGeo(userId, ip) {
  if (!userId || isLocalIp(ip)) return;
  try {
    const cc = await lookupCountry(ip);
    if (cc) {
      await query(
        `UPDATE users
            SET last_ip = $1,
                country_code = $2,
                updated_at = now()
          WHERE id = $3`,
        [ip, cc, userId]
      );
    } else {
      // Davlat aniqlanmasa ham IP ni yangilaymiz
      await query(
        `UPDATE users SET last_ip = $1, updated_at = now() WHERE id = $2`,
        [ip, userId]
      );
    }
  } catch (_) {
    // DB xatosi — jim o'tamiz (fire-and-forget)
  }
}
