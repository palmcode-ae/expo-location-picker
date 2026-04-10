/**
 * Lazy loader for the Google Maps JavaScript API.
 *
 * The Maps JS API is fetched the first time `pickLocation()` is called and
 * never on `import`. Subsequent calls share the same in-flight load via a
 * module-level promise cache, so opening the picker many times never
 * re-downloads or re-initializes the SDK.
 */

const CALLBACK_NAME = '__expoLocationPickerOnGoogleMapsLoaded';
const SCRIPT_ID = '__expo-location-picker-gmaps-script';

// Stores the in-flight or completed load promise so multiple `pickLocation`
// calls share the same script tag and never re-load. Typed `any` because
// we don't depend on `@types/google.maps`.
let cached: Promise<any> | null = null;

export type LoadOptions = {
  apiKey: string;
  language?: string;
  region?: string;
};

/**
 * Loads the Google Maps JS API on demand. Resolves with `google.maps`.
 *
 * - If `google.maps` is already on `window` (e.g. another part of the page
 *   loaded it), reuses that load and never appends a duplicate script tag.
 * - Caches the resolved promise so repeat calls are free.
 * - Rejects with a clear error if the script fails to load (almost always
 *   means the API key is wrong, restricted, or Maps JS API isn't enabled).
 */
export function loadGoogleMaps(opts: LoadOptions): Promise<any> {
  if (cached) return cached;

  cached = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(
        new Error(
          'expo-location-picker: Google Maps cannot be loaded outside a browser environment.',
        ),
      );
      return;
    }

    // If google.maps was already loaded by another script on the page,
    // reuse it instead of double-loading.
    const existing = (window as unknown as { google?: { maps?: any } }).google
      ?.maps;
    if (existing) {
      resolve(existing);
      return;
    }

    const w = window as unknown as Record<string, unknown>;
    w[CALLBACK_NAME] = () => {
      delete w[CALLBACK_NAME];
      const maps = (w as { google?: { maps?: any } }).google?.maps;
      if (maps) {
        resolve(maps);
      } else {
        reject(
          new Error(
            'expo-location-picker: Google Maps script loaded but window.google.maps is undefined.',
          ),
        );
      }
    };

    const params = new URLSearchParams({
      key: opts.apiKey,
      libraries: 'places,marker',
      v: 'weekly',
      callback: CALLBACK_NAME,
      loading: 'async',
    });
    if (opts.language) params.set('language', opts.language);
    if (opts.region) params.set('region', opts.region);

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // Reset the cache so a fresh attempt is possible after the user
      // fixes their key / network. Without this, every subsequent
      // pickLocation() call would resolve to the failed promise forever.
      cached = null;
      delete w[CALLBACK_NAME];
      reject(
        new Error(
          'expo-location-picker: failed to load the Google Maps JS API. ' +
            'Check that your API key is correct, the Maps JavaScript API is ' +
            'enabled in your Google Cloud project, and the key is allowed to ' +
            "be used from this origin (under the key's HTTP referrer restrictions).",
        ),
      );
    };
    document.head.appendChild(script);
  });

  return cached;
}
