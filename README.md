# expo-location-picker

A native, in-app **location picker** for Expo / React Native apps.

`pickLocation()` opens a fully native, full-screen modal containing a real
platform map, a fixed center pin, search-as-you-type, and a "current
location" button. When the user confirms, your promise resolves with the
coordinate (and a best-effort address) currently under the pin.

- iOS: **MapKit** + **CoreLocation** + **UIKit** (no third-party dependencies)
- Android: **Google Maps SDK** + **Places SDK** + **FusedLocationProvider** (Material 3 UI)
- Web: **Google Maps JavaScript API** + **Places API (New)**, lazy-loaded on first call
- No WebViews. No JS UI. No `<View>` exported from this library.

```ts
import { pickLocation } from 'expo-location-picker';

const result = await pickLocation();
if (result) {
  console.log(result.latitude, result.longitude, result.formattedAddress);
}
```

---

## Features

- ✅ Single async function — `pickLocation(options?)`
- ✅ Fully native UI on each platform (MapKit on iOS, Material 3 + Google Maps on Android, Google Maps JS on web)
- ✅ **One unified pin design across all platforms** — same teardrop drawn from the same path on iOS (`CAShapeLayer`), Android (vector drawable), and web (inline SVG)
- ✅ **Theme API** — one `theme` object themes iOS, Android, and web consistently (`primary`, `pin`, `colorScheme`)
- ✅ Search bar with native autocomplete (`MKLocalSearchCompleter` / Places SDK / Places API New)
- ✅ "Current location" button + permission flow
- ✅ Reverse-geocoded result (street, city, country, postal code)
- ✅ Resolves with `null` on cancel — never throws on user-initiated dismiss
- ✅ Light + dark mode support, with optional `colorScheme` override
- ✅ Typed TypeScript API
- ✅ Zero npm dependencies — no `leaflet`, `mapbox-gl`, `react-native-maps`, etc.
- ✅ Lazy-loaded on web — importing the package costs ~0 KB until you call `pickLocation()`

---

## Installation

```sh
npx expo install expo-location-picker
```

> This is an Expo Module. It requires a development build (or any custom
> native build) — it does **not** work in Expo Go because it ships native
> code.

```sh
npx expo prebuild
npx expo run:ios
npx expo run:android
```

---

## iOS setup

### Permissions

Add the following to `app.json` (or `Info.plist` if you manage native code
manually). The picker uses Core Location for the "current location" button
and to bias map search results.

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSLocationWhenInUseUsageDescription": "Used to show your current location on the map when picking a place."
      }
    }
  }
}
```

That's it — there are **no API keys, no billing, and no extra dependencies**
on iOS. MapKit ships with the OS.

---

## Android setup

Android does not have a first-party, in-app map UI equivalent to MapKit, so
this module uses the **Google Maps SDK** and the **Places SDK** (3.5.0 — the
last release before Google made Java 8 desugaring mandatory; talks to the
exact same new Places API backend the latest 5.x line uses). You will need:

1. A Google Cloud project with the following APIs enabled:
   - **[Maps SDK for Android](https://console.cloud.google.com/apis/library/maps-android-backend.googleapis.com)**
   - **[Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com)** — *not* the legacy Places API. The picker calls `Places.initializeWithNewPlacesApiEnabled()` so it always talks to the *new* one, and will return zero search results if you enable the legacy one by mistake. The Cloud Console lists both side-by-side; the one you want is literally named "Places API (New)".
2. An **Android API key**, restricted to your app's package name and SHA-1.
   - Under **API restrictions**, your key must allow **both** *Maps SDK for Android* and *Places API (New)*. If you restrict the key but forget Places, search will silently return no results.
   - Get your debug keystore SHA-1 with `cd android && ./gradlew signingReport` (or `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`).
3. **Billing enabled** on the Cloud project. Both APIs have generous free
   monthly quotas, but a billing account must be attached. See
   [Google's pricing](https://mapsplatform.google.com/pricing/) for current details.

There is no config plugin to add to `app.json` and no `core library
desugaring` to enable on the consumer side. Just install the package, set
your API key, and prebuild.

### Permissions and API key

```json
{
  "expo": {
    "android": {
      "permissions": [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION"
      ],
      "config": {
        "googleMaps": {
          "apiKey": "YOUR_ANDROID_GOOGLE_MAPS_API_KEY"
        }
      }
    }
  }
}
```

`expo.android.config.googleMaps.apiKey` writes the standard
`com.google.android.geo.API_KEY` meta-data tag into your `AndroidManifest.xml`.
This module reads the same key for both Maps **and** Places — you do not
need to provide it twice.

If you manage native code by hand instead of using the Expo config, add:

```xml
<application …>
  <meta-data
    android:name="com.google.android.geo.API_KEY"
    android:value="YOUR_ANDROID_GOOGLE_MAPS_API_KEY" />
</application>
```

> If the API key is missing or invalid, the map will still open but the map
> tiles will be blank and the search bar will return no predictions.

---

## Web setup

The web picker uses the **Google Maps JavaScript API** + **Places API (New)** —
the same backend the Android picker uses, so search results, `placeId`s, and
the `PickLocationResult` shape are interoperable across platforms.

### Why Google Maps on web

The web picker shares **one Cloud project** with the Android picker, which
means you don't manage a second vendor relationship, billing account, or
search index. The same API key you set up for Android works on web as long
as you also enable the JavaScript API on it. You can use a separate key
restricted to your web origin if you'd rather not reuse the Android key.

The Maps JS API is **lazy-loaded on the first `pickLocation()` call** —
importing the package on web costs ~0 KB and the picker chunk (~20 KB) +
Google Maps JS (~200 KB) only download when the user actually opens the
picker. The picker is plain DOM, not React Native Web, so it's decoupled
from your app's render tree and stylesheet.

### Google Cloud setup

1. In your Google Cloud project, enable:
   - **[Maps JavaScript API](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com)** (web tile rendering)
   - **[Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com)** (autocomplete + place details — same one you enabled for Android)
2. Either reuse your Android API key or create a new one for web. Whichever
   you choose, under **Application restrictions** select *HTTP referrers*
   and add your web origins (e.g. `https://example.com/*`,
   `http://localhost:*` for development). Under **API restrictions** allow
   both *Maps JavaScript API* and *Places API (New)*.

### Provide the API key to the picker

There are two ways. The recommended one is the environment variable:

```sh
# .env
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSy...your-web-key...
```

Anything prefixed with `EXPO_PUBLIC_` is inlined into the web bundle by
Metro at build time, so the key ends up shipped to the browser — which is
expected for client-side Maps usage. Restrict the key to your origins as
described above so it can't be used from anywhere else.

If you'd rather pass the key in code (e.g. you load it from your own
config endpoint), use the `web.apiKey` option:

```ts
await pickLocation({
  web: { apiKey: 'AIzaSy...' },
});
```

### Install the web peer dependencies

If your example / app doesn't already have them:

```sh
npx expo install react-dom react-native-web
```

These are required by Expo Web in general, not specifically by this
library, but the picker will refuse to bundle on web without them.

### What it looks like

The web picker is a fullscreen DOM overlay (not a React Native Web view)
appended to `document.body`:

- A top bar with Cancel (✕) on the left, the search input in the middle,
  and Done (✓) on the right.
- A Google Map filling the rest of the viewport.
- The same teardrop pin as the native pickers, centered, with a lift-on-pan
  animation and an accuracy dot.
- A floating "current location" button bottom-right.
- Light and dark mode follow `prefers-color-scheme`.
- Esc dismisses (resolves `null`). Clicking outside does *not* dismiss
  (matches the iOS modal-presentation behavior).

### Geolocation

On web we deliberately do *not* trigger an unsolicited
`navigator.geolocation` permission prompt when the picker opens — that
prompt is too disruptive on the web. Instead:

- If the user has *already* granted geolocation permission to your origin
  (checked via the Permissions API), we auto-center on their position.
- Otherwise the picker opens at the initial coordinate you passed, or a
  world view, and the user can tap the floating "current location" button
  to trigger the permission prompt explicitly.

This is the only behavioral difference from iOS / Android, where the
permission prompt fires on open.

---

## API reference

### `pickLocation(options?): Promise<PickLocationResult | null>`

Presents the native picker. Returns:

- a [`PickLocationResult`](#picklocationresult) when the user taps **Done**, or
- `null` when the user taps **Cancel** or dismisses the picker.

#### `PickLocationOptions`

All fields are optional.

| Field | Type | Description |
| --- | --- | --- |
| `initialLatitude` | `number` | Latitude to center the map on initially. |
| `initialLongitude` | `number` | Longitude to center the map on initially. |
| `initialRadiusMeters` | `number` | Approximate visible radius. iOS uses this directly with `MKCoordinateRegion`; Android maps it to a Google Maps zoom level. Defaults to ~1 km. |
| `title` | `string` | Title shown in the picker's nav bar / toolbar. |
| `doneButtonTitle` | `string` | Localized text for the Done button. |
| `cancelButtonTitle` | `string` | Localized text for the Cancel button. |
| `searchPlaceholder` | `string` | Placeholder shown in the search bar. |
| `locale` | `string` | BCP-47 locale (e.g. `"en-US"`, `"ar"`) used when reverse-geocoding the picked coordinate. Defaults to the device locale. |
| `disableCurrentLocation` | `boolean` | Hide the "current location" button and skip requesting location permission. |
| `theme.primary` | `string` | Brand accent color (Done button, FAB icon, focus rings). Hex string. Defaults to `"#007AFF"`. |
| `theme.pin` | `string` | Pin marker fill color. Hex string. Defaults to `"#FF3B30"`. |
| `theme.colorScheme` | `'light' \| 'dark' \| 'system'` | Force a color scheme regardless of the system. Defaults to `"system"`. |
| `web.apiKey` | `string` | **Web only.** Google Maps JS API key. Falls back to `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. |
| `web.language` | `string` | **Web only.** Two-letter language code for map labels and reverse-geocoding. |
| `web.region` | `string` | **Web only.** ccTLD region bias for Maps + Places (e.g. `"us"`, `"eg"`). |

If `initialLatitude` / `initialLongitude` are not provided and the user has
granted location permission, the picker centers on the user's last known
location. Otherwise it falls back to the platform default. (On web,
geolocation is only auto-triggered if the user has *already* granted
permission to your origin; otherwise you have to tap the FAB.)

#### `PickLocationResult`

| Field | Type | Always present? |
| --- | --- | --- |
| `latitude` | `number` | yes |
| `longitude` | `number` | yes |
| `formattedAddress` | `string` | best effort |
| `name` | `string` | best effort |
| `locality` | `string` | best effort |
| `administrativeArea` | `string` | best effort |
| `postalCode` | `string` | best effort |
| `countryCode` | `string` (ISO 3166-1 alpha-2) | best effort |
| `country` | `string` | best effort |

The address fields come from the platform reverse geocoder
(`CLGeocoder` on iOS, `android.location.Geocoder` on Android,
`google.maps.Geocoder` on web). They may be `undefined` for very remote
coordinates, devices without Google Play services, or restrictive locales.

---

## Theming

The picker exposes a tiny `theme` API designed to be the **same object on
every platform**. Pass a hex color in JS once and it themes iOS, Android,
and web identically. Anything you don't specify falls back to the
platform's native default — Apple system blue / red, Material You dynamic
color, etc. — so the picker continues to feel at home in any host app.

```ts
import { pickLocation } from 'expo-location-picker';

const result = await pickLocation({
  theme: {
    primary: '#7c3aed',     // brand purple — Done button, FAB, focus rings
    pin: '#dc2626',         // crimson pin marker
    colorScheme: 'dark',    // force dark mode regardless of system
  },
});
```

### What each token does

| Token | iOS | Android | Web |
| --- | --- | --- | --- |
| `primary` | `view.tintColor` (cascades to nav bar buttons + search field tint) | FAB icon tint, Done menu icon tint | `--ep-primary` CSS variable (Done button, FAB icon, focus rings, search input focus border) |
| `pin` | `PinMarkerView.fillColor` (CAShapeLayer fill) | `imageTintList` on the pin body drawable | `--ep-pin` CSS variable (SVG `fill`) |
| `colorScheme` | `overrideUserInterfaceStyle` | `Configuration.UI_MODE_NIGHT_MASK` override on a fresh context | `expo-location-picker__dialog--force-light/dark` modifier class |

### Cross-platform pin

The center pin is the **same vector path** drawn three different ways:

- **iOS** — `UIBezierPath` rendered by a `CAShapeLayer` inside a custom `PinMarkerView`. No SF Symbol involved.
- **Android** — A `VectorDrawable` (`expolocationpicker_pin.xml`) painted white at rest and tinted via `imageTintList` so the same drawable can be any color.
- **Web** — Inline `<svg>` with the body element marked `class="ep-pin-fill"` so the CSS rule `fill: var(--ep-pin)` applies the theme color.

The path coordinates are byte-identical across all three platforms. The
visible tip lands at viewport (16, 40) — the bottom-center — so the
parent view can place its bottom edge at the desired map point and the
pin tip will be exactly there with no offset math.

### Color scheme behavior

| `colorScheme` | iOS | Android | Web |
| --- | --- | --- | --- |
| `'system'` (default) | Follows system | Follows system | Follows `prefers-color-scheme` |
| `'light'` | Forced via `overrideUserInterfaceStyle = .light` | Forced via `Configuration.UI_MODE_NIGHT_NO` | `--force-light` class overrides the dark-mode media query |
| `'dark'` | Forced via `overrideUserInterfaceStyle = .dark` | Forced via `Configuration.UI_MODE_NIGHT_YES` | `--force-dark` class overrides the light-mode default |

The override is **scoped to the picker only** — it does not affect the
host app's color scheme. When the picker dismisses, the host app's
appearance is unchanged.

### Defaults

If you pass no `theme`, the picker uses Apple's system colors as defaults
on every platform:

- `primary`: `#007AFF` (Apple system blue)
- `pin`: `#FF3B30` (Apple system red)
- `colorScheme`: `'system'`

These look at home on iOS, Android, and web alike — Material 3's colors
are quite close, and modern web design has converged on the same palette.

---

## Example usage

```tsx
import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { pickLocation, type PickLocationResult } from 'expo-location-picker';

export default function PickLocationDemo() {
  const [picked, setPicked] = useState<PickLocationResult | null>(null);

  const onPress = async () => {
    const result = await pickLocation({
      title: 'Where are we meeting?',
      searchPlaceholder: 'Coffee shops, addresses, …',
      initialRadiusMeters: 2000,
    });
    setPicked(result); // null on cancel
  };

  return (
    <View>
      <Button title="Pick a location" onPress={onPress} />
      {picked && (
        <Text>
          {picked.formattedAddress ?? `${picked.latitude}, ${picked.longitude}`}
        </Text>
      )}
    </View>
  );
}
```

A complete working example lives in [`example/`](./example).

---

## Platform differences & tradeoffs

| | iOS | Android | Web |
| --- | --- | --- | --- |
| Map engine | Apple MapKit | Google Maps SDK | Google Maps JS API |
| Search engine | `MKLocalSearchCompleter` (free, on-device for partial matching) | Places SDK 3.5 (Places API New) | Places API (New) via JS SDK |
| Reverse geocoding | `CLGeocoder` | `android.location.Geocoder` | `google.maps.Geocoder` |
| API key required | ❌ | ✅ | ✅ (same Cloud project as Android) |
| Cost | Free | Per Google Maps Platform pricing | Per Google Maps Platform pricing |
| Bundle / dependencies added | None (system frameworks only) | `play-services-maps`, `play-services-location`, `places` | ~20 KB picker chunk + ~200 KB Maps JS, both lazy-loaded |

### Why does Android need Google Maps?

There is no first-party, system-supplied map UI on Android. Other options
were considered and rejected for this library:

- **WebView-based map** — explicitly out of scope; the goal is native UI.
- **OpenStreetMap (osmdroid / MapLibre)** — works, but ships its own
  rendering pipeline, lacks a first-party place search, and would force
  users to wire up a separate geocoding/search backend.
- **No map at all** — defeats the point of a "location picker".

Google Maps + Places is the smallest viable native dependency surface that
delivers a real in-app picker on Android.

### Cancel-on-dismiss

If the user dismisses the picker by gesture, the system, or a configuration
change, `pickLocation()` resolves with `null`. The promise is **never** left
pending.

### Threading

The picker UI is always presented on the main / UI thread. Reverse
geocoding happens on a background thread to keep the UI responsive.

### Web

The web picker is implemented in plain DOM (not React Native Web) and
hangs off `document.body` as a fullscreen overlay. The picker controller
+ styles + Google Maps loader live in their own ~20 KB chunk that Metro
splits out automatically — importing the package on web costs essentially
zero until you call `pickLocation()`.

Search uses the **new** Places API (`AutocompleteSuggestion` +
`Place.fetchFields`), the same backend Android uses, so `placeId`s are
interoperable across platforms.

The only behavioral difference from native: on web we don't auto-trigger
the geolocation permission prompt when the picker opens. We only
auto-center on the user's location if they've *already* granted permission
via the Permissions API. Otherwise the user has to tap the floating
"current location" button to opt in. See the [Web setup](#web-setup)
section for details.

---

## Troubleshooting (Android)

When something doesn't work, the picker logs to logcat under the tag
`ExpoLocationPicker`. To see only its lines:

```sh
adb logcat | grep ExpoLocationPicker
```

Verbose lifecycle logs (`SearchView text changed: …`,
`findAutocompletePredictions(query=…)`, `Places returned N prediction(s)`, …)
are emitted at `Log.d` level **only when the consumer app is built
debuggable**, so they won't pollute production logcat. Errors and warnings
are unconditional because they require developer action.

The four scenarios you're most likely to hit, in order of frequency:

### 1. Search returns nothing — even though the map renders fine

This is almost always: **Places API (New) is not enabled on your Cloud
project**. The same key works for Maps because Maps SDK and Places SDK are
two separate APIs in the Cloud Console — enabling one doesn't enable the
other.

Logcat will show:

```
ExpoLocationPicker  E  findAutocompletePredictions failed:
                       ApiException: 9011: PERMISSION_DENIED:
                       Places API (New) has not been used in project ...
```

Fix: visit
[console.cloud.google.com/apis/library/places.googleapis.com](https://console.cloud.google.com/apis/library/places.googleapis.com)
and click **Enable**. Make sure it's "Places API (**New**)", not the legacy
Places API. The picker calls `Places.initializeWithNewPlacesApiEnabled()`
and only ever talks to the new one.

### 2. Search returns nothing — and logcat shows `API_KEY_INVALID` or `API key not authorized`

Your API key restrictions don't include the Places API. Open
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
click your Android key, and under **API restrictions** either:

- choose *Don't restrict key*, **or**
- explicitly add both *Maps SDK for Android* **and** *Places API (New)* to
  the allow list.

Also confirm that under **Application restrictions** the key allows your
app's package name and your debug-keystore SHA-1
(`cd android && ./gradlew signingReport`).

### 3. The map is blank, search returns nothing, and there's no API key in `AndroidManifest.xml`

You haven't set the Google Maps API key at all. Logcat:

```
ExpoLocationPicker  E  com.google.android.geo.API_KEY meta-data is missing
                       from AndroidManifest.xml. Search will be disabled.
```

Fix: set `expo.android.config.googleMaps.apiKey` in `app.json` (see the
[Permissions and API key](#permissions-and-api-key) section above), then
`npx expo prebuild --platform android --clean` and rebuild. The same key is
used for both Maps and Places — you don't need to declare it twice.

Calling `pickLocation()` itself will *also* reject up-front with the coded
exception `ERR_MISSING_API_KEY` so JS code can handle this case before the
picker even opens:

```ts
try {
  await pickLocation();
} catch (e) {
  if (e.code === 'ERR_MISSING_API_KEY') {
    // tell the user to ask the developer to fix the build
  }
}
```

### 4. The "current location" button doesn't appear

Either you passed `disableCurrentLocation: true`, or the picker's internal
guard kicked in because permission setup is incomplete. On Android, the
button is still shown — but if the user taps it and you haven't declared
`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` in `app.json`, the
permission prompt won't fire and tapping it does nothing. Make sure both
permissions are declared:

```json
{
  "expo": {
    "android": {
      "permissions": [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION"
      ]
    }
  }
}
```

(On iOS, the same situation manifests as the button being hidden on purpose
when `NSLocationWhenInUseUsageDescription` is missing from `Info.plist` —
the picker logs an `[expo-location-picker]` warning to the console
explaining what to add.)

---

## Troubleshooting (Web)

The web picker logs to the browser console with the prefix
`[expo-location-picker]`. Open DevTools and filter on that string when
something looks wrong.

### 1. `pickLocation()` throws `ERR_MISSING_API_KEY` immediately

You haven't told the picker about your Google Maps API key. Either set it
in an env file:

```sh
# .env
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSy...
```

…or pass it explicitly per call:

```ts
await pickLocation({ web: { apiKey: process.env.MY_MAPS_KEY } });
```

The same `ERR_MISSING_API_KEY` coded exception is also what Android throws
when the manifest meta-data is absent, so you can handle both with one
branch:

```ts
try {
  await pickLocation();
} catch (e) {
  if (e.code === 'ERR_MISSING_API_KEY') {
    // ...
  }
}
```

### 2. The picker opens but the map area is grey / shows "For development purposes only"

Your API key isn't authorized for this origin. Open
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
click your key, and under **Application restrictions** make sure your
origin is in the *HTTP referrers* list. For local dev you typically need:

- `http://localhost:*`
- `http://127.0.0.1:*`
- your real production origin(s)

Google's "For development purposes only" watermark specifically means the
referrer doesn't match.

### 3. The picker opens but search returns nothing

Either the **Places API (New)** isn't enabled on your Cloud project, or
your API key restrictions don't include it. The browser console will log:

```
[expo-location-picker] Places autocomplete failed. Most likely the Places
API (New) is not enabled on your Cloud project, or your API key
restrictions don't include it.
```

Fix is the same as the Android section: visit
[console.cloud.google.com/apis/library/places.googleapis.com](https://console.cloud.google.com/apis/library/places.googleapis.com)
and click *Enable*. Make sure it's the *New* one, not the legacy Places
API.

### 4. The script fails to load (`Failed to load the Google Maps JS API`)

Either the Maps JavaScript API isn't enabled on your Cloud project, the
API key doesn't allow it, or your network is blocking
`maps.googleapis.com`. Enable it at
[console.cloud.google.com/apis/library/maps-backend.googleapis.com](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com).

The picker resets its loader cache after a script-load failure so the
*next* `pickLocation()` call will retry — you don't need to refresh the
page after fixing the underlying problem.

### 5. The "current location" button does nothing

Three possible causes, in order of likelihood:

1. **The page isn't served over HTTPS.** `navigator.geolocation` is
   disabled on insecure origins (with `localhost` as an exception). If you
   open the picker over `http://192.168.x.x` from another device, the FAB
   will silently do nothing.
2. **The user denied geolocation permission for your origin.** They have
   to re-grant it in the browser's site permissions (typically the lock
   icon in the address bar).
3. **The permission prompt is blocked.** Some browsers throttle prompts
   from origins that have asked too often. Wait or test in a different
   browser profile.

Watch the browser console for `[expo-location-picker] geolocation failed`
to see the underlying `GeolocationPositionError`.

---

## Contributing

```sh
bun install
cd example && bun install && cd ..

# In one terminal: rebuild build/ on every src/ change
# (the example app reads from build/, so without this you have to run
# `bun run build` manually after every edit before re-bundling.)
bun run dev

# In another terminal, run the example on your platform of choice:
bun run open:ios          # opens example/ios in Xcode
bun run open:android      # opens example/android in Android Studio
cd example && bunx expo start --web    # web

# Lint / format with Biome
bun run lint
bun run format

# One-shot build (also runs as `prepare` on `bun install`)
bun run build
```

### Why the `dev` script

The library is set up the standard `expo-module-scripts` way: source lives
in `src/`, and `tsc` compiles it into `build/` (`package.json`'s `main`
points at `build/index.js`). The example consumes the package via
`extraNodeModules`, so it reads `build/`, **not** `src/`. Without
`bun run dev` you'll see stale-build errors like
`Unable to resolve module ./web/picker` after adding new files,
because `build/` won't reflect the new source tree until you rebuild.

`bun run dev` runs `tsc --watch --preserveWatchOutput` so every save in
`src/` regenerates the matching file in `build/` within ~50 ms.

---

## License

MIT © [PalmCode](https://github.com/palmcode-ae) — originally authored by [b0iq](https://github.com/b0iq).
