// Capacitor native bridge — runs in the WebView shell on Android / iOS.
// When the app is loaded in a browser these calls all degrade to no-ops or
// stubs that emit synthetic results so the same code paths work everywhere.
//
// Wires up:
//   • Google Play Billing & App Store IAP (cordova-plugin-purchase)
//   • AdMob rewarded videos (@capacitor-community/admob)
//   • Push notifications (@capacitor/push-notifications)
//   • Status bar & safe-area
//
// All plugins are dynamic-imported so the web build doesn't pull native code.

const isCapacitor = !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());

export const native = {
  /** True when running inside the Capacitor shell. */
  isNative: () => isCapacitor,
  platform: () => (isCapacitor ? window.Capacitor.getPlatform() : 'web'),
};

// ── AdMob rewarded video ────────────────────────────────────────────────
// Returns a promise that resolves with { reward, completed } when the
// user closes the video. On web, immediately resolves a synthetic reward
// (the backend will reject the bonus claim if it's not the native path).
let admobReady = false;
async function ensureAdMob() {
  if (admobReady || !isCapacitor) return admobReady;
  try {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.initialize({
      requestTrackingAuthorization: true,
      testingDevices: [],
      initializeForTesting: window.__ADMOB_TEST__ === true,
    });
    admobReady = true;
  } catch (e) {
    console.warn('[native] AdMob init failed:', e?.message);
  }
  return admobReady;
}

export async function showRewardedAd() {
  if (!isCapacitor) {
    // Web fallback — the server only credits when the request originates
    // from a verified native callback, so this is harmless for production.
    await new Promise((r) => setTimeout(r, 1500));
    return { reward: { type: 'coins', amount: 800 }, completed: true, source: 'web-stub' };
  }
  await ensureAdMob();
  try {
    const { AdMob, RewardAdPluginEvents } = await import('@capacitor-community/admob');
    const adId = window.__ADMOB_REWARDED_ID__ || '';
    if (!adId) throw new Error('Rewarded AdMob unit id is not configured');
    await AdMob.prepareRewardVideoAd({ adId });
    const rewardPromise = new Promise((resolve) => {
      const off = AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward) => {
        off?.remove?.();
        resolve({ reward, completed: true, source: 'admob-native' });
      });
      AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
        resolve({ reward: null, completed: false, source: 'admob-native' });
      });
    });
    await AdMob.showRewardVideoAd();
    return rewardPromise;
  } catch (e) {
    console.warn('[native] showRewardedAd failed:', e?.message);
    return { reward: null, completed: false, error: e?.message };
  }
}

// ── In-App Purchases (Google Play / App Store) ──────────────────────────
// The native side returns a `receipt` (Android: purchaseToken; iOS: signed
// receipt) that we hand to the backend `/api/shop/verify-iap` endpoint.
export async function buyProduct(productId) {
  if (!isCapacitor) {
    return { ok: false, error: 'IAP requires the native app (open in Google Play / App Store).' };
  }
  try {
    const cdvPurchase = window.CdvPurchase;
    if (cdvPurchase?.store) {
      const store = cdvPurchase.store;
      const platform = native.platform() === 'ios'
        ? cdvPurchase.Platform.APPLE_APPSTORE
        : cdvPurchase.Platform.GOOGLE_PLAY;
      const type = String(productId).startsWith('premium_')
        ? cdvPurchase.ProductType.PAID_SUBSCRIPTION
        : cdvPurchase.ProductType.CONSUMABLE;
      if (!store.get(productId, platform)) {
        store.register([{ id: productId, type, platform }]);
        await store.initialize([platform]);
      }
      await store.update();
      const product = store.get(productId, platform);
      const offer = product?.getOffer?.();
      if (!offer) throw new Error('IAP product is not available in the store');
      const order = await offer.order();
      const transaction = order?.transaction || order;
      const receipt = transaction?.purchaseToken
        || transaction?.transactionReceipt
        || transaction?.receipt
        || transaction?.id
        || '';
      if (!receipt) throw new Error('Store did not return a purchase receipt');
      return { ok: true, productId, receipt, platform: native.platform(), raw: order };
    }

    const plugin = await import('capacitor-plugin-purchase').catch(() => null);
    const Purchases = plugin?.Purchases || plugin?.InAppPurchases || plugin?.default;
    if (!Purchases) throw new Error('IAP plugin not installed');
    const result = await Purchases.purchase({ productId });
    return {
      ok: true,
      productId,
      receipt: result.receipt || result.purchaseToken || result.transactionReceipt,
      platform: window.Capacitor.getPlatform(),
      raw: result,
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'purchase failed' };
  }
}

/** Verify a native purchase receipt with the backend. */
export async function submitReceiptToBackend(api, { productId, receipt, platform }) {
  if (!receipt || !productId) throw new Error('receipt and productId required');
  const result = await api.post('/shop/verify-iap', { platform, productId, receipt });
  try {
    const raw = arguments[1]?.raw;
    await raw?.transaction?.finish?.();
    await raw?.finish?.();
  } catch (e) {
    console.warn('[native] finish purchase failed:', e?.message);
  }
  return result;
}

// ── Push notifications (FCM via Capacitor) ─────────────────────────────
export async function initPush(onToken) {
  if (!isCapacitor) return null;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return null;
    await PushNotifications.register();
    PushNotifications.addListener('registration', (token) => {
      onToken?.(token.value);
    });
    PushNotifications.addListener('pushNotificationReceived', (n) => {
      // Foreground notification → emit a popup via the existing event system.
      window.dispatchEvent(new CustomEvent('push:foreground', { detail: n }));
    });
    PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      window.dispatchEvent(new CustomEvent('push:action', { detail: a }));
    });
  } catch (e) {
    console.warn('[native] push init failed:', e?.message);
  }
}

// ── Status bar / safe area ──────────────────────────────────────────────
export async function configureNativeShell() {
  if (!isCapacitor) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView?.({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0d0f1a' });
  } catch (_) { /* ignore */ }
  try {
    const { SafeArea } = await import('capacitor-plugin-safe-area');
    const { insets } = await SafeArea.getSafeAreaInsets();
    document.documentElement.style.setProperty('--safe-top',    `${insets.top}px`);
    document.documentElement.style.setProperty('--safe-bottom', `${insets.bottom}px`);
    document.documentElement.style.setProperty('--safe-left',   `${insets.left || 0}px`);
    document.documentElement.style.setProperty('--safe-right',  `${insets.right || 0}px`);
  } catch (_) { /* ignore */ }
}
