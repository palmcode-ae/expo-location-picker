package expo.modules.locationpicker

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ExpoLocationPickerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoLocationPicker")

    AsyncFunction("pickLocation") { options: PickLocationOptions?, promise: Promise ->
      val activity = appContext.currentActivity
        ?: return@AsyncFunction promise.reject(NoActivityException())

      if (activity !is FragmentActivity) {
        return@AsyncFunction promise.reject(NoActivityException())
      }

      // Fail fast with a clear error if the host app hasn't configured a
      // Google Maps API key. Without it, both the Maps SDK and the Places
      // SDK throw at runtime in ways that are hard to debug from JS.
      if (readGoogleMapsApiKey(activity).isNullOrBlank()) {
        return@AsyncFunction promise.reject(MissingApiKeyException())
      }

      activity.runOnUiThread {
        try {
          val fragment = LocationPickerDialogFragment.newInstance(
            options ?: PickLocationOptions()
          )
          fragment.onResult = { result ->
            promise.resolve(result)
          }
          fragment.show(activity.supportFragmentManager, "ExpoLocationPicker")
        } catch (e: Throwable) {
          promise.reject(PickerPresentationException(e))
        }
      }
    }
  }
}

internal fun readGoogleMapsApiKey(ctx: Context): String? {
  return try {
    val ai = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ctx.packageManager.getApplicationInfo(
        ctx.packageName,
        PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
    }
    ai.metaData?.getString("com.google.android.geo.API_KEY")
  } catch (_: Throwable) {
    null
  }
}

class PickLocationOptions : Record {
  @Field var initialLatitude: Double? = null
  @Field var initialLongitude: Double? = null
  @Field var initialRadiusMeters: Double? = null
  @Field var title: String? = null
  @Field var doneButtonTitle: String? = null
  @Field var cancelButtonTitle: String? = null
  @Field var searchPlaceholder: String? = null
  @Field var locale: String? = null
  @Field var disableCurrentLocation: Boolean = false
  @Field var theme: PickLocationThemeOptions? = null
}

class PickLocationThemeOptions : Record {
  @Field var primary: String? = null
  @Field var pin: String? = null
  /// One of `"light"`, `"dark"`, `"system"`. Anything else falls back to system.
  @Field var colorScheme: String? = null
}

/// Parses a CSS-style hex color (`"#RGB"`, `"#RRGGBB"`, or `"#RRGGBBAA"`)
/// into an Android packed-int color. Returns `null` for malformed input.
internal fun parseHexColor(hex: String?): Int? {
  val raw = hex?.trim() ?: return null
  val s = if (raw.startsWith("#")) raw.substring(1) else raw
  val expanded = when (s.length) {
    3 -> s.map { "$it$it" }.joinToString("")
    6, 8 -> s
    else -> return null
  }
  return try {
    val v = expanded.toLong(16)
    if (expanded.length == 8) {
      // RRGGBBAA → ARGB
      val r = ((v shr 24) and 0xFF).toInt()
      val g = ((v shr 16) and 0xFF).toInt()
      val b = ((v shr 8) and 0xFF).toInt()
      val a = (v and 0xFF).toInt()
      (a shl 24) or (r shl 16) or (g shl 8) or b
    } else {
      // RRGGBB → opaque ARGB
      0xFF000000.toInt() or v.toInt()
    }
  } catch (_: NumberFormatException) {
    null
  }
}

internal class NoActivityException :
  CodedException(
    "ERR_NO_ACTIVITY",
    "expo-location-picker: no FragmentActivity available to host the picker.",
    null,
  )

internal class PickerPresentationException(cause: Throwable) :
  CodedException(
    "ERR_PICKER_PRESENT",
    "expo-location-picker: failed to present picker — ${cause.message}",
    cause,
  )

internal class MissingApiKeyException :
  CodedException(
    "ERR_MISSING_API_KEY",
    "expo-location-picker: a Google Maps API key is required on Android. " +
      "Add `android.config.googleMaps.apiKey` to your app.json (or set the " +
      "`com.google.android.geo.API_KEY` meta-data tag in AndroidManifest.xml) " +
      "and rebuild your app.",
    null,
  )
