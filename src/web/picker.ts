/**
 * Web implementation of `pickLocation()`.
 *
 * Mirrors the iOS and Android pickers in shape: the user gets a fullscreen
 * modal with a search bar, a Google Map, a center pin, a "find me" FAB, and
 * Cancel / Done buttons. The promise resolves with a `PickLocationResult`
 * (when the user confirms) or `null` (when they cancel or press Escape).
 *
 * Implementation notes:
 *
 *  - Pure DOM. No React, no React Native Web. The picker is a self-contained
 *    overlay appended to `document.body`. We don't depend on the consumer's
 *    React version, render tree, or stylesheet.
 *  - Google Maps JS API is fetched lazily by `loader.ts` on first call.
 *    Importing this module costs ~5 KB of glue code; the actual ~200 KB of
 *    Maps JS only loads on first picker open.
 *  - Search uses the **new** Places API (`AutocompleteSuggestion` +
 *    `Place.fetchFields`) — the same backend our Android picker uses, so
 *    `placeId`s and search results are interoperable across platforms.
 */

import type {
  PickLocationOptions,
  PickLocationResult,
} from '../ExpoLocationPicker.types';
import { loadGoogleMaps } from './loader';
import { injectStyles } from './styles';

// `google.maps` types are intentionally `any` here — we don't want to take
// a hard dependency on `@types/google.maps`. The shapes used are stable
// public API. If a consumer wants typed access they can install
// `@types/google.maps` themselves.
type GMaps = any;
type GMap = any;
type LatLng = { lat: number; lng: number };

/**
 * Local CodedError so we can attach `code` (matching the iOS / Android
 * `CodedException`) without taking a runtime dependency on
 * `expo-modules-core` from the web entry point.
 */
export class CodedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CodedError';
  }
}

/**
 * Reads the Google Maps API key from the explicit option, then falls back
 * to `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (Expo Web's standard
 * convention for client-exposed env vars).
 */
function resolveApiKey(options: PickLocationOptions): string | null {
  const explicit = options.web?.apiKey;
  if (explicit && explicit.length > 0) return explicit;

  // Use a guarded `process.env` access so this still type-checks in
  // environments where `process` isn't declared.
  const env =
    typeof process !== 'undefined' && process?.env
      ? (process.env as Record<string, string | undefined>)
      : undefined;
  const fromEnv = env?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/**
 * Public entry point. Called from `ExpoLocationPickerModule.web.ts`.
 */
export async function showPicker(
  options: PickLocationOptions,
): Promise<PickLocationResult | null> {
  const apiKey = resolveApiKey(options);
  if (!apiKey) {
    throw new CodedError(
      'ERR_MISSING_API_KEY',
      'expo-location-picker: a Google Maps API key is required on web. ' +
        'Set `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in your environment, or pass ' +
        '`web.apiKey` to pickLocation().',
    );
  }

  injectStyles();

  const maps = await loadGoogleMaps({
    apiKey,
    language: options.web?.language,
    region: options.web?.region,
  });

  return new Promise((resolve) => {
    const controller = new PickerController(maps, options, resolve);
    controller.show();
  });
}

// MARK: - Inline SVGs

const ICON_CLOSE = `
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
</svg>`;

const ICON_CHECK = `
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
</svg>`;

const ICON_MY_LOCATION = `
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
</svg>`;

const ICON_PLACE = `
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/>
</svg>`;

// The teardrop body uses class="ep-pin-fill" so the CSS rule
// `.expo-location-picker__pin svg .ep-pin-fill { fill: var(--ep-pin); }`
// can theme it. The same path is used on Android (vector drawable) and
// iOS (CAShapeLayer / UIBezierPath) so the marker is pixel-identical
// across platforms.
const PIN_SVG = `
<svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path
    class="ep-pin-fill"
    d="M16,2 C8.27,2 2,7.27 2,14 C2,17.5 3.27,20.7 5.4,23.2 L16,40 L26.6,23.2 C28.73,20.7 30,17.5 30,14 C30,7.27 23.73,2 16,2 z"
    stroke="#FFFFFF"
    stroke-width="1.5"
  />
  <circle cx="16" cy="14" r="5" fill="#FFFFFF" />
</svg>`;

// MARK: - Picker controller

interface PredictionItem {
  placeId: string;
  title: string;
  subtitle: string;
}

class PickerController {
  private readonly maps: GMaps;
  private readonly options: PickLocationOptions;
  private readonly resolve: (value: PickLocationResult | null) => void;

  // DOM
  private backdrop!: HTMLDivElement;
  private searchInput!: HTMLInputElement;
  private resultsList!: HTMLDivElement;
  private mapContainer!: HTMLDivElement;
  private pinElement!: HTMLDivElement;
  private pinDot!: HTMLDivElement;
  private fab: HTMLButtonElement | null = null;

  // Map
  private map!: GMap;
  private placesLib: any = null;
  private sessionToken: any = null;
  private geocoder: any = null;

  // State
  private settled = false;
  private searchDebounceHandle: number | null = null;
  private liftSettleHandle: number | null = null;
  private currentPredictions: PredictionItem[] = [];
  private previouslyFocusedElement: Element | null = null;

  constructor(
    maps: GMaps,
    options: PickLocationOptions,
    resolve: (value: PickLocationResult | null) => void,
  ) {
    this.maps = maps;
    this.options = options;
    this.resolve = resolve;
  }

  show(): void {
    this.previouslyFocusedElement = document.activeElement;
    this.buildDom();
    document.body.appendChild(this.backdrop);
    this.initializeMap();
    this.initializePlaces();
    document.addEventListener('keydown', this.onKeyDown);

    // Trigger the entrance animation: the dialog and scrim start at
    // opacity 0 / scale 0.96 / transparent background, and we toggle the
    // "--visible" class one frame after attaching so the CSS transitions
    // actually fire (a same-frame class addition wouldn't transition
    // because the browser hasn't painted the initial state yet).
    requestAnimationFrame(() => {
      this.backdrop.classList.add('expo-location-picker__backdrop--visible');
    });

    // Move focus into the modal so keyboard nav works immediately.
    queueMicrotask(() => this.searchInput.focus());
  }

  // MARK: DOM

  private buildDom(): void {
    // The backdrop is the *scrim* — a fixed-position dim layer that fills
    // the viewport. It centers the dialog inside itself via flex.
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'expo-location-picker__backdrop';

    // The dialog is the actual picker container. On mobile (≤ 768px) it
    // fills the scrim entirely (fullscreen). On larger screens it's a
    // centered card with a max width / height. ARIA modal semantics live
    // here, not on the scrim.
    const dialog = document.createElement('div');
    dialog.className = 'expo-location-picker__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', this.options.title ?? 'Choose location');

    // Apply the theme: forced color scheme and per-token CSS variable
    // overrides. Anything not specified in `theme` falls back to the
    // defaults baked into the stylesheet, so partial themes work fine.
    this.applyTheme(dialog);

    // --- top bar ---------------------------------------------------------
    const topbar = document.createElement('div');
    topbar.className = 'expo-location-picker__topbar';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'expo-location-picker__icon-button';
    cancelBtn.setAttribute(
      'aria-label',
      this.options.cancelButtonTitle ?? 'Cancel',
    );
    cancelBtn.innerHTML = ICON_CLOSE;
    cancelBtn.addEventListener('click', () => this.cancel());
    topbar.appendChild(cancelBtn);

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'expo-location-picker__search-wrapper';

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.className = 'expo-location-picker__search-input';
    this.searchInput.placeholder =
      this.options.searchPlaceholder ?? 'Search places or addresses';
    this.searchInput.autocomplete = 'off';
    this.searchInput.spellcheck = false;
    this.searchInput.addEventListener('input', this.onSearchInput);
    this.searchInput.addEventListener('keydown', this.onSearchKeyDown);
    searchWrapper.appendChild(this.searchInput);

    this.resultsList = document.createElement('div');
    this.resultsList.className = 'expo-location-picker__results';
    this.resultsList.setAttribute('role', 'listbox');
    searchWrapper.appendChild(this.resultsList);

    topbar.appendChild(searchWrapper);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className =
      'expo-location-picker__icon-button expo-location-picker__icon-button--done';
    doneBtn.setAttribute('aria-label', this.options.doneButtonTitle ?? 'Done');
    doneBtn.innerHTML = ICON_CHECK;
    doneBtn.addEventListener('click', () => this.done());
    topbar.appendChild(doneBtn);

    dialog.appendChild(topbar);

    // --- map + pin overlay ----------------------------------------------
    this.mapContainer = document.createElement('div');
    this.mapContainer.className = 'expo-location-picker__map-container';

    const mapDiv = document.createElement('div');
    mapDiv.className = 'expo-location-picker__map';
    this.mapContainer.appendChild(mapDiv);

    this.pinDot = document.createElement('div');
    this.pinDot.className = 'expo-location-picker__pin-dot';
    this.mapContainer.appendChild(this.pinDot);

    this.pinElement = document.createElement('div');
    this.pinElement.className = 'expo-location-picker__pin';
    this.pinElement.innerHTML = PIN_SVG;
    this.mapContainer.appendChild(this.pinElement);

    if (!this.options.disableCurrentLocation) {
      this.fab = document.createElement('button');
      this.fab.type = 'button';
      this.fab.className = 'expo-location-picker__fab';
      this.fab.setAttribute('aria-label', 'Use current location');
      this.fab.innerHTML = ICON_MY_LOCATION;
      this.fab.addEventListener('click', () => this.findMe());
      this.mapContainer.appendChild(this.fab);
    }

    dialog.appendChild(this.mapContainer);
    this.backdrop.appendChild(dialog);

    // Stash the actual map div so initializeMap() can find it.
    (this.mapContainer as any).__mapDiv = mapDiv;
  }

  // MARK: Theme

  /**
   * Apply the user's `theme` option to the dialog element. This sets two
   * things:
   *
   *  1. A `--force-light` / `--force-dark` modifier class when
   *     `colorScheme` is set, which overrides the prefers-color-scheme
   *     defaults baked into the stylesheet.
   *  2. Inline CSS custom properties (`--ep-primary`, `--ep-pin`) for any
   *     specific color tokens the user provided. The stylesheet uses
   *     `var(--ep-name, fallback)` everywhere, so anything not overridden
   *     here keeps its default.
   */
  private applyTheme(dialog: HTMLElement): void {
    const theme = this.options.theme;
    if (!theme) return;

    if (theme.colorScheme === 'light') {
      dialog.classList.add('expo-location-picker__dialog--force-light');
    } else if (theme.colorScheme === 'dark') {
      dialog.classList.add('expo-location-picker__dialog--force-dark');
    }

    if (theme.primary) {
      dialog.style.setProperty('--ep-primary', theme.primary);
    }
    if (theme.pin) {
      dialog.style.setProperty('--ep-pin', theme.pin);
    }
  }

  // MARK: Map + Places

  private initializeMap(): void {
    const mapDiv = (this.mapContainer as any).__mapDiv as HTMLDivElement;

    const initialCenter = {
      lat: this.options.initialLatitude ?? 0,
      lng: this.options.initialLongitude ?? 0,
    };
    const initialZoom = this.zoomFromRadius(this.options.initialRadiusMeters);

    this.map = new this.maps.Map(mapDiv, {
      center: initialCenter,
      zoom:
        this.options.initialLatitude != null &&
        this.options.initialLongitude != null
          ? initialZoom
          : 2, // world view if no initial coord
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
      keyboardShortcuts: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true,
      zoomControlOptions: {
        position: this.maps.ControlPosition.RIGHT_BOTTOM,
      },
    });

    // Lift the pin while the user is dragging or zooming, drop it when idle.
    this.map.addListener('dragstart', () => this.setPinLifted(true));
    this.map.addListener('zoom_changed', () => {
      this.setPinLifted(true);
      this.scheduleLiftSettle();
    });
    this.map.addListener('idle', () => this.setPinLifted(false));

    this.geocoder = new this.maps.Geocoder();

    // If the user has already granted geolocation permission in this
    // browser, jump to their location automatically. We deliberately do NOT
    // request permission on open — that prompt is too disruptive on the
    // web. The user can always tap the FAB explicitly.
    if (
      this.options.initialLatitude == null ||
      this.options.initialLongitude == null
    ) {
      this.maybeAutoCenterOnGeolocation();
    }
  }

  private async initializePlaces(): Promise<void> {
    try {
      const lib = await this.maps.importLibrary('places');
      this.placesLib = lib;
      this.sessionToken = new lib.AutocompleteSessionToken();
    } catch (e) {
      console.warn(
        '[expo-location-picker] failed to load Places library; search will be disabled.',
        e,
      );
    }
  }

  private async maybeAutoCenterOnGeolocation(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    // Use the Permissions API to avoid surprising the user with an
    // unsolicited geolocation prompt. Only auto-center if they've already
    // granted us permission previously.
    try {
      const status = await navigator.permissions?.query({
        name: 'geolocation' as PermissionName,
      });
      if (!status || status.state !== 'granted') return;
    } catch {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.map.setCenter({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        this.map.setZoom(this.zoomFromRadius(this.options.initialRadiusMeters));
      },
      () => {
        // Permission revoked between checking and calling, or position
        // unavailable. Silently keep the world view.
      },
      { timeout: 5000, maximumAge: 60_000 },
    );
  }

  // MARK: Pin

  private setPinLifted(lifted: boolean): void {
    this.pinElement.classList.toggle(
      'expo-location-picker__pin--lifted',
      lifted,
    );
    this.pinDot.classList.toggle(
      'expo-location-picker__pin-dot--visible',
      lifted,
    );
  }

  /**
   * `zoom_changed` fires once when the camera starts zooming and once when
   * it settles. We want to drop the pin back down on the second `idle` —
   * but `idle` won't fire if the user keeps zooming. This timer ensures the
   * pin always settles within ~250ms of the last camera change.
   */
  private scheduleLiftSettle(): void {
    if (this.liftSettleHandle != null) {
      window.clearTimeout(this.liftSettleHandle);
    }
    this.liftSettleHandle = window.setTimeout(() => {
      this.setPinLifted(false);
      this.liftSettleHandle = null;
    }, 280);
  }

  // MARK: Search

  private onSearchInput = (): void => {
    const query = this.searchInput.value.trim();
    if (this.searchDebounceHandle != null) {
      window.clearTimeout(this.searchDebounceHandle);
    }
    if (query.length === 0) {
      this.renderResults([]);
      return;
    }
    this.searchDebounceHandle = window.setTimeout(() => {
      this.runAutocomplete(query);
    }, 200);
  };

  private onSearchKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.searchInput.value.length > 0) {
      // First Escape clears the search; the modal-level Escape only
      // dismisses when the input is already empty.
      e.preventDefault();
      e.stopPropagation();
      this.searchInput.value = '';
      this.renderResults([]);
    }
  };

  private async runAutocomplete(query: string): Promise<void> {
    const lib = this.placesLib;
    if (!lib) return;

    try {
      const { suggestions } =
        await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: this.sessionToken,
          locationBias: this.map.getBounds() ?? undefined,
        });

      const items: PredictionItem[] = (suggestions ?? [])
        .map((s: any) => s.placePrediction)
        .filter((p: any) => p != null)
        .map((p: any) => ({
          placeId: p.placeId,
          title: p.mainText?.toString() ?? p.text?.toString() ?? '',
          subtitle: p.secondaryText?.toString() ?? '',
        }))
        .filter((p: PredictionItem) => p.title.length > 0);

      this.renderResults(items);
    } catch (e) {
      console.error(
        '[expo-location-picker] Places autocomplete failed. ' +
          'Most likely the Places API (New) is not enabled on your Cloud project, ' +
          "or your API key restrictions don't include it. " +
          'See https://console.cloud.google.com/apis/library/places.googleapis.com',
        e,
      );
      this.renderResults([]);
    }
  }

  private renderResults(items: PredictionItem[]): void {
    this.currentPredictions = items;
    this.resultsList.innerHTML = '';
    if (items.length === 0) {
      this.resultsList.classList.remove(
        'expo-location-picker__results--visible',
      );
      return;
    }

    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'expo-location-picker__result-item';
      row.setAttribute('role', 'option');
      row.setAttribute('tabindex', '0');

      const icon = document.createElement('span');
      icon.className = 'expo-location-picker__result-icon';
      icon.innerHTML = ICON_PLACE;
      row.appendChild(icon);

      const text = document.createElement('div');
      text.className = 'expo-location-picker__result-text';

      const title = document.createElement('span');
      title.className = 'expo-location-picker__result-title';
      title.textContent = item.title;
      text.appendChild(title);

      if (item.subtitle) {
        const sub = document.createElement('span');
        sub.className = 'expo-location-picker__result-subtitle';
        sub.textContent = item.subtitle;
        text.appendChild(sub);
      }
      row.appendChild(text);

      row.addEventListener('click', () => this.selectPrediction(index));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.selectPrediction(index);
        }
      });

      this.resultsList.appendChild(row);
    });

    this.resultsList.classList.add('expo-location-picker__results--visible');
  }

  private async selectPrediction(index: number): Promise<void> {
    const item = this.currentPredictions[index];
    if (!item || !this.placesLib) return;

    try {
      // The new Places API: build a Place from the placeId, then fetch fields.
      const place = new this.placesLib.Place({
        id: item.placeId,
        requestedLanguage: this.options.web?.language,
      });
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });

      if (place.location) {
        this.map.panTo(place.location);
        this.map.setZoom(16);
      }
      this.searchInput.value = place.displayName ?? item.title;
      this.renderResults([]);
      this.searchInput.blur();
      // Reset the session token after a place is selected, per Google's
      // billing best practice.
      this.sessionToken = new this.placesLib.AutocompleteSessionToken();
    } catch (e) {
      console.error('[expo-location-picker] fetchFields failed', e);
    }
  }

  // MARK: Find me

  private findMe(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      console.warn(
        '[expo-location-picker] navigator.geolocation is not available',
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll: LatLng = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        this.map.panTo(ll);
        this.map.setZoom(16);
      },
      (err) => {
        console.warn('[expo-location-picker] geolocation failed', err);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  }

  // MARK: Confirm / cancel

  private async done(): Promise<void> {
    if (this.settled) return;
    const center = this.map.getCenter();
    if (!center) {
      this.settle(null);
      return;
    }
    const lat = center.lat();
    const lng = center.lng();

    let payload: PickLocationResult = { latitude: lat, longitude: lng };
    try {
      const result = await this.geocoder.geocode({
        location: { lat, lng },
        language: this.options.web?.language,
      });
      const top = result?.results?.[0];
      if (top) {
        payload = mergeAddress(payload, top);
      }
    } catch {
      // Reverse geocode is best-effort — fall through with just lat/lng.
    }
    this.settle(payload);
  }

  private cancel(): void {
    this.settle(null);
  }

  private settle(value: PickLocationResult | null): void {
    if (this.settled) return;
    this.settled = true;
    this.teardown();
    this.resolve(value);
  }

  private teardown(): void {
    if (this.searchDebounceHandle != null) {
      window.clearTimeout(this.searchDebounceHandle);
    }
    if (this.liftSettleHandle != null) {
      window.clearTimeout(this.liftSettleHandle);
    }
    document.removeEventListener('keydown', this.onKeyDown);

    // Fade the scrim + dialog out before removing them, mirroring the
    // entrance animation. We remove the "--visible" class to reverse the
    // transitions, then remove the DOM after the transition duration.
    this.backdrop.classList.remove('expo-location-picker__backdrop--visible');
    const removeAfterTransition = () => {
      this.backdrop.remove();
      if (this.previouslyFocusedElement instanceof HTMLElement) {
        this.previouslyFocusedElement.focus();
      }
    };
    // Match the longest transition duration in the stylesheet (the dialog
    // scale-in is 0.28s); add a small buffer so we don't clip the tail.
    window.setTimeout(removeAfterTransition, 300);
  }

  // MARK: Keyboard

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Search input handles its own Escape (clears the input). The
      // top-level handler only dismisses when the input is empty.
      if (
        document.activeElement === this.searchInput &&
        this.searchInput.value.length > 0
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    }
  };

  // MARK: Helpers

  private zoomFromRadius(radiusMeters: number | undefined): number {
    if (radiusMeters == null || radiusMeters <= 0) return 16;
    // Approximate: zoom 14 ≈ 1 km, halve distance per zoom step. Same
    // formula the Android picker uses.
    const z = 14 - Math.log2(radiusMeters / 1000);
    return Math.min(20, Math.max(2, z));
  }
}

// MARK: - Address mapping

/**
 * Maps a Google Maps `GeocoderResult` into our `PickLocationResult` shape.
 * Same field set as iOS / Android, derived from `address_components`.
 */
function mergeAddress(
  base: PickLocationResult,
  result: any,
): PickLocationResult {
  const out: PickLocationResult = { ...base };

  if (result.formatted_address) {
    out.formattedAddress = result.formatted_address;
  }

  const components: any[] = result.address_components ?? [];
  for (const c of components) {
    const types: string[] = c.types ?? [];
    if (types.includes('locality') || types.includes('postal_town')) {
      out.locality = c.long_name;
    } else if (types.includes('administrative_area_level_1')) {
      out.administrativeArea = c.long_name;
    } else if (types.includes('postal_code')) {
      out.postalCode = c.long_name;
    } else if (types.includes('country')) {
      out.country = c.long_name;
      out.countryCode = c.short_name;
    }
  }

  // Best-effort "name": prefer the first establishment / point_of_interest
  // address component, then fall back to the route or premise.
  for (const c of components) {
    const types: string[] = c.types ?? [];
    if (
      types.includes('establishment') ||
      types.includes('point_of_interest')
    ) {
      out.name = c.long_name;
      break;
    }
  }
  if (!out.name) {
    for (const c of components) {
      const types: string[] = c.types ?? [];
      if (types.includes('premise') || types.includes('route')) {
        out.name = c.long_name;
        break;
      }
    }
  }

  return out;
}
