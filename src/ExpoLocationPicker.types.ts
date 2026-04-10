/**
 * Visual theme for the picker UI. All fields are optional. Anything you
 * don't specify falls back to the platform's native default — typically
 * Apple's system colors on iOS, Material You / Material 3 dynamic color
 * on Android, and a tasteful Apple-system-blue / red palette on web.
 *
 * Colors should be CSS-style hex strings (`"#RRGGBB"` or `"#RRGGBBAA"`).
 * The same theme object themes every platform consistently — there's no
 * separate iOS / Android / web theme block.
 */
export type PickLocationTheme = {
  /**
   * Brand accent color. Used for the Done button text, the "current
   * location" FAB icon, focus rings, and the highlight on the active
   * search result. Defaults to `"#007AFF"` (Apple system blue).
   */
  primary?: string;

  /**
   * Color of the center pin marker. Defaults to `"#FF3B30"` (Apple system red).
   */
  pin?: string;

  /**
   * Force a color scheme for the picker, regardless of the host app or
   * the system setting. Defaults to `"system"` (follow the system).
   *
   * - On iOS, this maps to `overrideUserInterfaceStyle`.
   * - On Android, this overrides `Configuration.UI_MODE_NIGHT_MASK` for
   *   the picker dialog only.
   * - On web, this adds a CSS class on the dialog that overrides the
   *   `prefers-color-scheme` media-query default.
   */
  colorScheme?: 'light' | 'dark' | 'system';
};

/**
 * Options accepted by `pickLocation()`.
 *
 * Every field is optional. Omitted fields fall back to platform defaults.
 */
export type PickLocationOptions = {
  /**
   * Initial coordinate to center the map on. Defaults to the user's last
   * known location, or a sensible platform default if location permission is
   * not granted.
   */
  initialLatitude?: number;
  initialLongitude?: number;

  /**
   * Initial map span. Larger = more zoomed out.
   *
   * - iOS: meters of latitudinal span (passed to `MKCoordinateRegion`).
   * - Android: zoom level (0..20). If a meters value is passed it is mapped
   *   to a roughly equivalent Google Maps zoom level.
   *
   * Defaults to ~1 km.
   */
  initialRadiusMeters?: number;

  /**
   * Localized strings shown in the picker UI.
   */
  title?: string;
  doneButtonTitle?: string;
  cancelButtonTitle?: string;
  searchPlaceholder?: string;

  /**
   * BCP-47 locale used for reverse geocoding the picked coordinate
   * (e.g. `"en-US"`, `"ar"`). Defaults to the device locale.
   */
  locale?: string;

  /**
   * If `true`, the picker will not request the user's current location and
   * will hide the "current location" button. Defaults to `false`.
   */
  disableCurrentLocation?: boolean;

  /**
   * Visual theme for the picker UI. All fields are optional and apply to
   * every platform — the same `theme` object themes iOS, Android, and web
   * consistently. Anything you don't specify falls back to the platform's
   * native defaults (Apple system blue / red, Material You dynamic color,
   * etc.).
   */
  theme?: PickLocationTheme;

  /**
   * Web-only configuration. Ignored on iOS and Android.
   *
   * The web picker uses the Google Maps JavaScript API and Places API (New)
   * — the same backend the Android picker uses, so search results are
   * consistent across platforms. The API key can be provided here, or
   * picked up automatically from `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.
   */
  web?: {
    /**
     * Google Maps JavaScript API key. Falls back to
     * `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` if not provided.
     *
     * The key must have **Maps JavaScript API** and **Places API (New)**
     * enabled in the Google Cloud Console. The same key you use for Android
     * works on web after enabling the JS API.
     */
    apiKey?: string;
    /** Two-letter language code for map labels and reverse geocoding (e.g. `"en"`). */
    language?: string;
    /** ccTLD region bias for Maps + Places, e.g. `"us"`, `"eg"`. */
    region?: string;
  };
};

/**
 * Result returned by `pickLocation()` when the user confirms a location.
 *
 * `latitude` and `longitude` are always present. The remaining fields are
 * filled in on a best-effort basis from the platform reverse geocoder; any
 * of them may be `undefined` depending on the location and the device
 * locale.
 */
export type PickLocationResult = {
  latitude: number;
  longitude: number;

  /** Best-effort, single-line, human-readable address. */
  formattedAddress?: string;

  /** Point of interest or street name when available. */
  name?: string;

  /** City / locality. */
  locality?: string;
  /** State / region / administrative area. */
  administrativeArea?: string;
  /** Postal / ZIP code. */
  postalCode?: string;
  /** ISO 3166-1 alpha-2 country code (e.g. `"US"`). */
  countryCode?: string;
  /** Localized country name. */
  country?: string;
};
