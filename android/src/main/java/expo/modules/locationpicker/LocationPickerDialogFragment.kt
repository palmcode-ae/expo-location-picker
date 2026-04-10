package expo.modules.locationpicker

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.DialogInterface
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Point
import android.location.Address
import android.location.Geocoder
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.view.ContextThemeWrapper
import androidx.coordinatorlayout.widget.CoordinatorLayout
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import androidx.core.widget.addTextChangedListener
import androidx.fragment.app.DialogFragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.SupportMapFragment
import com.google.android.gms.maps.model.LatLng
import com.google.android.libraries.places.api.Places
import com.google.android.libraries.places.api.model.AutocompleteSessionToken
import com.google.android.libraries.places.api.model.Place
import com.google.android.libraries.places.api.net.FetchPlaceRequest
import com.google.android.libraries.places.api.net.FindAutocompletePredictionsRequest
import com.google.android.libraries.places.api.net.PlacesClient
import com.google.android.material.card.MaterialCardView
import com.google.android.material.color.DynamicColors
import com.google.android.material.color.MaterialColors
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.google.android.material.search.SearchBar
import com.google.android.material.search.SearchView
import kotlinx.parcelize.Parcelize
import java.util.Locale
import java.util.concurrent.Executors

internal class LocationPickerDialogFragment : DialogFragment() {

  internal var onResult: ((Map<String, Any?>?) -> Unit)? = null

  private lateinit var args: PickerArgs
  private var googleMap: GoogleMap? = null
  private var fusedClient: FusedLocationProviderClient? = null
  private var placesClient: PlacesClient? = null
  private var sessionToken: AutocompleteSessionToken? = null
  private var didCenterOnInitial = false
  private var hasFinished = false
  private val ioExecutor = Executors.newSingleThreadExecutor()

  // UI
  private lateinit var themedContext: Context
  private lateinit var rootLayout: CoordinatorLayout
  private lateinit var mapContainer: FrameLayout
  private lateinit var pinView: CenterPinView
  private lateinit var searchBar: SearchBar
  private lateinit var searchView: SearchView
  private lateinit var resultsRecycler: RecyclerView
  private val predictionsAdapter = PredictionsAdapter()
  private var fab: FloatingActionButton? = null

  private val requestPermission = registerForActivityResult(
    ActivityResultContracts.RequestPermission(),
  ) { granted ->
    if (granted) {
      enableMyLocation()
      moveToCurrentLocation(animated = true)
    }
  }

  // MARK: - Lifecycle

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setStyle(STYLE_NORMAL, R.style.Theme_ExpoLocationPicker)
    args = arguments?.let {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        it.getParcelable(ARG_PICKER, PickerArgs::class.java)
      } else {
        @Suppress("DEPRECATION") it.getParcelable(ARG_PICKER)
      }
    } ?: PickerArgs()
  }

  override fun onStart() {
    super.onStart()
    dialog?.window?.setLayout(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
    )
  }

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    // Apply theme.colorScheme by overriding UI_MODE_NIGHT_MASK on a fresh
    // Configuration. This forces the picker into light or dark mode
    // independently of the host app's night-mode setting, but only for
    // *this* dialog — the rest of the app stays as-is.
    val activityContext = requireActivity()
    val configuredContext = when (args.colorScheme) {
      "light", "dark" -> {
        val newConfig = Configuration(activityContext.resources.configuration)
        newConfig.uiMode = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
          if (args.colorScheme == "dark") Configuration.UI_MODE_NIGHT_YES
          else Configuration.UI_MODE_NIGHT_NO
        activityContext.createConfigurationContext(newConfig)
      }
      else -> activityContext
    }

    val baseContext = ContextThemeWrapper(configuredContext, R.style.Theme_ExpoLocationPicker)
    themedContext = DynamicColors.wrapContextIfAvailable(
      baseContext,
      R.style.Theme_ExpoLocationPicker,
    )

    initializePlacesIfNeeded()
    fusedClient = LocationServices.getFusedLocationProviderClient(themedContext)

    return buildLayout()
  }

  override fun onDismiss(dialog: DialogInterface) {
    super.onDismiss(dialog)
    finish(null)
  }

  override fun onDestroy() {
    super.onDestroy()
    ioExecutor.shutdownNow()
  }

  // MARK: - Layout

  private fun buildLayout(): View {
    rootLayout = CoordinatorLayout(themedContext).apply {
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
      setBackgroundColor(
        MaterialColors.getColor(
          this,
          com.google.android.material.R.attr.colorSurface,
          Color.WHITE,
        ),
      )
    }

    setupMapContainer()
    setupPinView()
    setupSearchBarAndView()
    setupFab()

    return rootLayout
  }

  private fun setupMapContainer() {
    mapContainer = FrameLayout(themedContext).apply {
      id = View.generateViewId()
      layoutParams = CoordinatorLayout.LayoutParams(
        CoordinatorLayout.LayoutParams.MATCH_PARENT,
        CoordinatorLayout.LayoutParams.MATCH_PARENT,
      )
    }
    rootLayout.addView(mapContainer)

    val mapFragment = SupportMapFragment.newInstance()
    childFragmentManager.beginTransaction()
      .replace(mapContainer.id, mapFragment)
      .commitNow()
    mapFragment.getMapAsync { onMapReady(it) }
  }

  private fun setupPinView() {
    pinView = CenterPinView(themedContext).apply {
      layoutParams = CoordinatorLayout.LayoutParams(
        CoordinatorLayout.LayoutParams.MATCH_PARENT,
        CoordinatorLayout.LayoutParams.MATCH_PARENT,
      )
      isClickable = false
      isFocusable = false
      // Apply themed pin color (defaults to red inside CenterPinView).
      args.pinColor?.let { pinColor = it }
    }
    rootLayout.addView(pinView)

    // Apply system-bar insets as padding so the pin sits in the *visible*
    // map center, not behind the (translucent) status bar / search bar /
    // navigation bar. Same correction we apply on iOS via safeAreaLayoutGuide.
    ViewCompat.setOnApplyWindowInsetsListener(pinView) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime(),
      )
      val searchBarHeight = if (::searchBar.isInitialized) searchBar.height else 0
      v.setPadding(bars.left, bars.top + searchBarHeight, bars.right, bars.bottom)
      insets
    }
  }

  private fun setupSearchBarAndView() {
    searchBar = SearchBar(themedContext).apply {
      hint = args.searchPlaceholder ?: "Search places or addresses"
      setNavigationIcon(R.drawable.expolocationpicker_ic_close_24)
      setNavigationOnClickListener { finish(null) }
      val doneItem = menu.add(Menu.NONE, MENU_DONE, Menu.NONE, args.doneButtonTitle ?: "Done")
      // Tint the Done check icon with the themed primary color when set,
      // otherwise leave it on Material's default colorPrimary tint.
      val checkIcon = ContextCompat.getDrawable(
        themedContext,
        R.drawable.expolocationpicker_ic_check_24,
      )?.mutate()
      args.primaryColor?.let { primary ->
        checkIcon?.setTint(primary)
      }
      doneItem.icon = checkIcon
      doneItem.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
      setOnMenuItemClickListener { item ->
        if (item.itemId == MENU_DONE) {
          onDoneTapped()
          true
        } else {
          false
        }
      }
    }
    val searchBarParams = CoordinatorLayout.LayoutParams(
      CoordinatorLayout.LayoutParams.MATCH_PARENT,
      CoordinatorLayout.LayoutParams.WRAP_CONTENT,
    ).apply {
      gravity = Gravity.TOP
      val margin = dp(8)
      setMargins(margin, margin, margin, 0)
    }
    rootLayout.addView(searchBar, searchBarParams)

    // SearchView is the full-screen search results overlay. setupWithSearchBar
    // wires the expand/collapse animation between the bar and the view.
    searchView = SearchView(themedContext).apply {
      hint = args.searchPlaceholder ?: "Search places or addresses"
      setupWithSearchBar(searchBar)
      editText.addTextChangedListener { text ->
        val query = text?.toString().orEmpty()
        debugLog("SearchView text changed: \"$query\"")
        onSearchChanged(query)
      }
    }
    val searchViewParams = CoordinatorLayout.LayoutParams(
      CoordinatorLayout.LayoutParams.MATCH_PARENT,
      CoordinatorLayout.LayoutParams.MATCH_PARENT,
    )
    rootLayout.addView(searchView, searchViewParams)

    // RecyclerView lives inside the SearchView's content container.
    resultsRecycler = RecyclerView(themedContext).apply {
      layoutManager = LinearLayoutManager(themedContext)
      adapter = predictionsAdapter
      clipToPadding = false
      setPadding(0, dp(8), 0, dp(8))
      setHasFixedSize(true)
    }
    searchView.addView(resultsRecycler)

    predictionsAdapter.onItemClick = { position -> onPredictionTapped(position) }

    // Apply insets to the search bar so it floats below the status bar.
    ViewCompat.setOnApplyWindowInsetsListener(searchBar) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      v.updateLayoutParams<CoordinatorLayout.LayoutParams> {
        topMargin = bars.top + dp(8)
        leftMargin = bars.left + dp(8)
        rightMargin = bars.right + dp(8)
      }
      // Trigger pin re-layout so the visible center accounts for the new bar height.
      pinView.requestLayout()
      insets
    }
  }

  private fun setupFab() {
    if (args.disableCurrentLocation) return

    val button = FloatingActionButton(themedContext).apply {
      setImageResource(R.drawable.expolocationpicker_ic_my_location_24)
      // Themed primary color overrides Material's default colorPrimary.
      val iconTint = args.primaryColor ?: MaterialColors.getColor(
        this,
        androidx.appcompat.R.attr.colorPrimary,
        Color.BLACK,
      )
      imageTintList = ColorStateList.valueOf(iconTint)
      backgroundTintList = ColorStateList.valueOf(
        MaterialColors.getColor(
          this,
          com.google.android.material.R.attr.colorSurfaceContainerHigh,
          Color.WHITE,
        ),
      )
      setOnClickListener { onMyLocationTapped() }
    }
    val fabParams = CoordinatorLayout.LayoutParams(
      CoordinatorLayout.LayoutParams.WRAP_CONTENT,
      CoordinatorLayout.LayoutParams.WRAP_CONTENT,
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.END
      setMargins(dp(16), dp(16), dp(16), dp(24))
    }
    rootLayout.addView(button, fabParams)
    fab = button

    // Push the FAB above the system navigation bar.
    ViewCompat.setOnApplyWindowInsetsListener(button) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      v.updateLayoutParams<CoordinatorLayout.LayoutParams> {
        bottomMargin = dp(24) + bars.bottom
        rightMargin = dp(16) + bars.right
      }
      insets
    }
  }

  // MARK: - Map / location

  @SuppressLint("MissingPermission")
  private fun onMapReady(map: GoogleMap) {
    googleMap = map
    map.uiSettings.apply {
      isZoomControlsEnabled = false
      isMyLocationButtonEnabled = false
      isCompassEnabled = true
      isMapToolbarEnabled = false
    }

    map.setOnCameraMoveStartedListener { reason ->
      if (reason == GoogleMap.OnCameraMoveStartedListener.REASON_GESTURE) {
        pinView.setLifted(true)
      }
    }
    map.setOnCameraIdleListener {
      pinView.setLifted(false)
    }

    val initLat = args.initialLatitude
    val initLng = args.initialLongitude
    if (initLat != null && initLng != null) {
      centerMap(LatLng(initLat, initLng), zoomFromRadius(args.initialRadiusMeters), animated = false)
      didCenterOnInitial = true
    }

    if (!args.disableCurrentLocation) {
      if (hasLocationPermission()) {
        enableMyLocation()
        if (!didCenterOnInitial) moveToCurrentLocation(animated = false)
      } else {
        requestPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION)
      }
    }
  }

  @SuppressLint("MissingPermission")
  private fun enableMyLocation() {
    if (hasLocationPermission()) {
      googleMap?.isMyLocationEnabled = true
    }
  }

  @SuppressLint("MissingPermission")
  private fun moveToCurrentLocation(animated: Boolean) {
    if (!hasLocationPermission()) return
    fusedClient?.lastLocation?.addOnSuccessListener { loc ->
      if (loc != null) {
        didCenterOnInitial = true
        centerMap(
          LatLng(loc.latitude, loc.longitude),
          zoomFromRadius(args.initialRadiusMeters),
          animated = animated,
        )
      }
    }
  }

  private fun onMyLocationTapped() {
    if (!hasLocationPermission()) {
      requestPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION)
      return
    }
    enableMyLocation()
    fusedClient?.lastLocation?.addOnSuccessListener { loc ->
      if (loc != null) {
        centerMap(LatLng(loc.latitude, loc.longitude), zoom = 16f, animated = true)
      }
    }
  }

  // MARK: pin <-> coordinate math

  /// Read the geographic coordinate that's currently sitting under the pin
  /// tip. Always use this instead of `googleMap.cameraPosition.target`,
  /// because the pin is anchored to the visible (safe-area) center of the
  /// map, not its geometric center.
  private fun pinCoordinate(): LatLng? {
    val map = googleMap ?: return null
    val tip = pinTipScreenPoint() ?: return null
    return map.projection.fromScreenLocation(tip)
  }

  /// Pin tip's location in pixels relative to the map view's top-left.
  private fun pinTipScreenPoint(): Point? {
    if (!pinView.isLaidOut) return null
    val visibleLeft = pinView.paddingLeft
    val visibleRight = pinView.width - pinView.paddingRight
    val visibleTop = pinView.paddingTop
    val visibleBottom = pinView.height - pinView.paddingBottom
    return Point(
      (visibleLeft + visibleRight) / 2,
      (visibleTop + visibleBottom) / 2,
    )
  }

  /// Set the camera so `coordinate` ends up exactly under the pin tip.
  /// Two-pass: snap to the desired coordinate at the requested zoom (instant)
  /// to compute the projection, then animate (or move) to the offset center.
  private fun centerMap(coordinate: LatLng, zoom: Float, animated: Boolean) {
    val map = googleMap ?: return
    val tip = pinTipScreenPoint()

    // First pass — instant snap to give us a valid projection at the target zoom.
    map.moveCamera(CameraUpdateFactory.newLatLngZoom(coordinate, zoom))

    if (tip == null) return

    val coordAtPin = map.projection.fromScreenLocation(tip)
    val latShift = coordinate.latitude - coordAtPin.latitude
    val lonShift = coordinate.longitude - coordAtPin.longitude
    val adjusted = LatLng(coordinate.latitude + latShift, coordinate.longitude + lonShift)

    val update = CameraUpdateFactory.newLatLngZoom(adjusted, zoom)
    if (animated) {
      map.animateCamera(update)
    } else {
      map.moveCamera(update)
    }
  }

  // MARK: - Search

  private fun onSearchChanged(query: String) {
    val q = query.trim()
    if (q.isEmpty()) {
      predictionsAdapter.submit(emptyList())
      return
    }
    val client = placesClient
    if (client == null) {
      Log.w(
        TAG,
        "Search query received but PlacesClient is null. Either the Google Maps API key is " +
          "missing from AndroidManifest.xml (com.google.android.geo.API_KEY meta-data) or " +
          "Places.initializeWithNewPlacesApiEnabled() failed at picker startup. See earlier " +
          "log lines from this tag.",
      )
      predictionsAdapter.submit(emptyList())
      return
    }
    val token = sessionToken ?: AutocompleteSessionToken.newInstance().also { sessionToken = it }
    val request = FindAutocompletePredictionsRequest.builder()
      .setSessionToken(token)
      .setQuery(q)
      .build()

    debugLog("findAutocompletePredictions(query=\"$q\")")
    client.findAutocompletePredictions(request)
      .addOnSuccessListener { response ->
        val items = response.autocompletePredictions.map { p ->
          PredictionsAdapter.Item(
            placeId = p.placeId,
            title = p.getPrimaryText(null).toString(),
            subtitle = p.getSecondaryText(null).toString(),
          )
        }
        debugLog("Places returned ${items.size} prediction(s) for \"$q\"")
        predictionsAdapter.submit(items)
      }
      .addOnFailureListener { error ->
        // Most common failure modes here are:
        //  - "Places API (New) is not enabled for this project" — enable it in
        //    https://console.cloud.google.com/apis/library/places.googleapis.com
        //  - "API key not authorized" — the API key is restricted to a different
        //    package name / SHA-1, or doesn't include the Places API in its
        //    allowed APIs list.
        //  - "Billing is not enabled" — Places API requires a billing account.
        Log.e(
          TAG,
          "findAutocompletePredictions failed: ${error.javaClass.simpleName}: ${error.message}",
          error,
        )
        predictionsAdapter.submit(emptyList())
      }
  }

  private fun onPredictionTapped(position: Int) {
    val item = predictionsAdapter.itemAt(position) ?: return
    val client = placesClient ?: return

    // Places SDK 3.5.0 still uses the pre-4.0 field constant names
    // (`LAT_LNG`, `NAME`, `ADDRESS`). The new Places API backend returns
    // the same data — only the identifiers differ from 4.x/5.x.
    val fields = listOf(
      Place.Field.LAT_LNG,
      Place.Field.NAME,
      Place.Field.ADDRESS,
    )
    val request = FetchPlaceRequest.builder(item.placeId, fields).apply {
      sessionToken?.let { setSessionToken(it) }
    }.build()
    // Reset session token after place selection (Google billing best practice).
    sessionToken = null

    client.fetchPlace(request).addOnSuccessListener { response ->
      val place = response.place
      place.latLng?.let { latLng ->
        centerMap(latLng, zoom = 16f, animated = true)
      }
      searchBar.setText(place.name ?: place.address ?: item.title)
      searchView.hide()
      predictionsAdapter.submit(emptyList())
    }
  }

  // MARK: - Done

  private fun onDoneTapped() {
    val target = pinCoordinate() ?: return finish(null)
    val locale = args.locale?.takeIf { it.isNotEmpty() }
      ?.let { Locale.forLanguageTag(it) } ?: Locale.getDefault()

    ioExecutor.execute {
      var address: Address? = null
      try {
        @Suppress("DEPRECATION")
        val list = Geocoder(requireContext(), locale)
          .getFromLocation(target.latitude, target.longitude, 1)
        address = list?.firstOrNull()
      } catch (_: Throwable) {
        // Geocoder may fail on devices without Google services — non-fatal.
      }
      val payload = buildResult(target, address)
      view?.post { finish(payload) }
    }
  }

  private fun buildResult(target: LatLng, address: Address?): Map<String, Any?> {
    val result = mutableMapOf<String, Any?>(
      "latitude" to target.latitude,
      "longitude" to target.longitude,
    )
    if (address != null) {
      val lines = (0..address.maxAddressLineIndex)
        .mapNotNull { address.getAddressLine(it) }
      val formatted = if (lines.isNotEmpty()) lines.joinToString(", ") else null
      formatted?.let { result["formattedAddress"] = it }
      address.featureName?.let { result["name"] = it }
      address.locality?.let { result["locality"] = it }
      address.adminArea?.let { result["administrativeArea"] = it }
      address.postalCode?.let { result["postalCode"] = it }
      address.countryCode?.let { result["countryCode"] = it }
      address.countryName?.let { result["country"] = it }
    }
    return result
  }

  private fun finish(result: Map<String, Any?>?) {
    if (hasFinished) return
    hasFinished = true
    onResult?.invoke(result)
    onResult = null
    if (isAdded) dismissAllowingStateLoss()
  }

  // MARK: - Helpers

  private fun hasLocationPermission(): Boolean =
    ContextCompat.checkSelfPermission(
      requireContext(),
      Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED ||
      ContextCompat.checkSelfPermission(
        requireContext(),
        Manifest.permission.ACCESS_COARSE_LOCATION,
      ) == PackageManager.PERMISSION_GRANTED

  private fun initializePlacesIfNeeded() {
    val ctx = requireContext()
    if (!Places.isInitialized()) {
      val apiKey = readGoogleMapsApiKey(ctx)
      if (apiKey.isNullOrBlank()) {
        Log.e(
          TAG,
          "com.google.android.geo.API_KEY meta-data is missing from AndroidManifest.xml. " +
            "Search will be disabled. Set expo.android.config.googleMaps.apiKey in app.json " +
            "and rebuild your app.",
        )
        return
      }
      try {
        Places.initializeWithNewPlacesApiEnabled(ctx, apiKey)
        debugLog("Places SDK initialized with the new Places API enabled.")
      } catch (e: Throwable) {
        Log.e(TAG, "Places.initializeWithNewPlacesApiEnabled failed", e)
        return
      }
    }
    if (Places.isInitialized()) {
      placesClient = Places.createClient(ctx)
      sessionToken = AutocompleteSessionToken.newInstance()
      debugLog("PlacesClient created; search ready.")
    }
  }

  private fun zoomFromRadius(radiusMeters: Double?): Float {
    if (radiusMeters == null || radiusMeters <= 0) return 16f
    val z = (14.0 - kotlin.math.log2(radiusMeters / 1000.0)).coerceIn(2.0, 20.0)
    return z.toFloat()
  }

  private fun dp(value: Int): Int {
    val density = resources.displayMetrics.density
    return (value * density).toInt()
  }

  /// True iff the *consumer* app was built debuggable. We honor the consumer
  /// app's debuggable flag rather than our own library `BuildConfig` so the
  /// gate behaves the way you'd expect — the verbose picker logs only show
  /// up while you're developing your own app, never in your shipped release.
  private val isDebugBuild: Boolean by lazy {
    val ctx = context ?: return@lazy false
    (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
  }

  /// `Log.d` gated on the consumer app being debuggable. Errors and warnings
  /// stay unconditional — those are actionable for the developer regardless
  /// of build type.
  private fun debugLog(message: String) {
    if (isDebugBuild) Log.d(TAG, message)
  }

  // MARK: - Companion

  companion object {
    private const val TAG = "ExpoLocationPicker"
    private const val ARG_PICKER = "expo.locationpicker.args"
    private const val MENU_DONE = 1

    fun newInstance(options: PickLocationOptions): LocationPickerDialogFragment {
      val frag = LocationPickerDialogFragment()
      frag.arguments = Bundle().apply {
        putParcelable(
          ARG_PICKER,
          PickerArgs(
            initialLatitude = options.initialLatitude,
            initialLongitude = options.initialLongitude,
            initialRadiusMeters = options.initialRadiusMeters,
            title = options.title,
            doneButtonTitle = options.doneButtonTitle,
            cancelButtonTitle = options.cancelButtonTitle,
            searchPlaceholder = options.searchPlaceholder,
            locale = options.locale,
            disableCurrentLocation = options.disableCurrentLocation,
            primaryColor = parseHexColor(options.theme?.primary),
            pinColor = parseHexColor(options.theme?.pin),
            colorScheme = options.theme?.colorScheme,
          ),
        )
      }
      return frag
    }
  }
}

// MARK: - Center pin view

/// Custom ViewGroup that draws the pin marker (teardrop image) and a small
/// accuracy dot. The pin tip lands exactly at the *visible* center of the
/// view (i.e. the center after subtracting padding, which the picker sets
/// from system bar insets so the tip lands in the visible map area, not
/// behind the search bar / nav bar).
internal class CenterPinView(context: Context) : FrameLayout(context) {
  /// The (white) teardrop body. We tint this from `pinColor` so the pin
  /// matches `theme.pin`. The body and hole are stacked as two ImageViews
  /// with identical bounds — the hole stays white because it lives in a
  /// separate ImageView that we never tint.
  private val pinBody: ImageView
  private val pinHole: ImageView
  private val dotView: View
  private val density = context.resources.displayMetrics.density

  /// Pin marker fill color. Setting this updates the body's tint.
  var pinColor: Int = 0xFFFF3B30.toInt()
    set(value) {
      field = value
      pinBody.imageTintList = ColorStateList.valueOf(value)
    }

  init {
    isClickable = false
    isFocusable = false
    setWillNotDraw(true)
    clipChildren = false

    // Body — white drawable, tinted to `pinColor` via imageTintList.
    pinBody = ImageView(context).apply {
      setImageResource(R.drawable.expolocationpicker_pin)
      imageTintList = ColorStateList.valueOf(pinColor)
      elevation = 4f * density
    }
    addView(pinBody, LayoutParams(dpInt(32), dpInt(40)))

    // White hole — stacked exactly on top of the body, never tinted.
    pinHole = ImageView(context).apply {
      setImageResource(R.drawable.expolocationpicker_pin_hole)
      elevation = 4f * density
    }
    addView(pinHole, LayoutParams(dpInt(32), dpInt(40)))

    // Accuracy dot — small dark circle revealed when the pin lifts.
    dotView = View(context).apply {
      background = ContextCompat.getDrawable(context, R.drawable.expolocationpicker_pin_dot)
      alpha = 0f
    }
    addView(dotView, LayoutParams(dpInt(8), dpInt(8)))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val w = r - l
    val h = b - t

    // The visible center is the geometric center of the area inside padding,
    // which the parent fragment sets from window insets so it matches what
    // the user perceives as "the middle of the map".
    val visibleLeft = paddingLeft
    val visibleRight = w - paddingRight
    val visibleTop = paddingTop
    val visibleBottom = h - paddingBottom
    val cx = (visibleLeft + visibleRight) / 2
    val cy = (visibleTop + visibleBottom) / 2

    // Pin tip = view's bottom edge, so layout the imageViews so their
    // bottom sits exactly on the visible center.
    val pinW = pinBody.measuredWidth
    val pinH = pinBody.measuredHeight
    val pinLeft = cx - pinW / 2
    val pinTop = cy - pinH
    val pinRight = cx + pinW / 2
    val pinBottom = cy
    pinBody.layout(pinLeft, pinTop, pinRight, pinBottom)
    pinHole.layout(pinLeft, pinTop, pinRight, pinBottom)

    // Accuracy dot is centered on the visible center.
    val dotW = dotView.measuredWidth
    val dotH = dotView.measuredHeight
    dotView.layout(cx - dotW / 2, cy - dotH / 2, cx + dotW / 2, cy + dotH / 2)
  }

  /// Lift the pin ~14dp above the map and reveal the dot, the same UX
  /// Apple Maps and Google Maps both use while the user is panning.
  fun setLifted(lifted: Boolean) {
    pinBody.animate().cancel()
    pinHole.animate().cancel()
    dotView.animate().cancel()
    val translateY = if (lifted) -dpInt(14).toFloat() else 0f
    pinBody.animate().translationY(translateY).setDuration(220).start()
    pinHole.animate().translationY(translateY).setDuration(220).start()
    dotView.animate()
      .alpha(if (lifted) 1f else 0f)
      .setDuration(220)
      .start()
  }

  private fun dpInt(value: Int): Int = (value * density).toInt()
}

// MARK: - Search results adapter + card item view

internal class PredictionsAdapter : RecyclerView.Adapter<PredictionsAdapter.VH>() {

  data class Item(val placeId: String, val title: String, val subtitle: String)

  var onItemClick: ((Int) -> Unit)? = null
  private val items = mutableListOf<Item>()

  fun submit(newItems: List<Item>) {
    items.clear()
    items.addAll(newItems)
    notifyDataSetChanged()
  }

  fun itemAt(position: Int): Item? = items.getOrNull(position)

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
    val card = PredictionItemView(parent.context)
    return VH(card)
  }

  override fun onBindViewHolder(holder: VH, position: Int) {
    val item = items[position]
    holder.bind(item)
    holder.itemView.setOnClickListener { onItemClick?.invoke(position) }
  }

  override fun getItemCount() = items.size

  internal class VH(itemView: PredictionItemView) : RecyclerView.ViewHolder(itemView) {
    fun bind(item: Item) {
      (itemView as PredictionItemView).bind(item.title, item.subtitle)
    }
  }
}

internal class PredictionItemView(context: Context) : MaterialCardView(context) {
  private val titleView: TextView
  private val subtitleView: TextView
  private val density = context.resources.displayMetrics.density

  init {
    val lp = RecyclerView.LayoutParams(
      RecyclerView.LayoutParams.MATCH_PARENT,
      RecyclerView.LayoutParams.WRAP_CONTENT,
    ).apply {
      topMargin = dpInt(4)
      bottomMargin = dpInt(4)
      leftMargin = dpInt(16)
      rightMargin = dpInt(16)
    }
    layoutParams = lp

    radius = dpInt(16).toFloat()
    cardElevation = 0f
    strokeWidth = 0
    setCardBackgroundColor(
      MaterialColors.getColor(
        this,
        com.google.android.material.R.attr.colorSurfaceContainerHigh,
        Color.WHITE,
      ),
    )
    isClickable = true
    isFocusable = true

    val container = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dpInt(16), dpInt(16), dpInt(16), dpInt(16))
    }
    addView(
      container,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT),
    )

    val icon = ImageView(context).apply {
      setImageResource(R.drawable.expolocationpicker_ic_place_24)
      imageTintList = ColorStateList.valueOf(
        MaterialColors.getColor(
          this,
          androidx.appcompat.R.attr.colorPrimary,
          Color.BLACK,
        ),
      )
    }
    val iconParams = LinearLayout.LayoutParams(dpInt(24), dpInt(24)).apply {
      marginEnd = dpInt(16)
    }
    container.addView(icon, iconParams)

    val textContainer = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
    }
    val textParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    container.addView(textContainer, textParams)

    titleView = TextView(context).apply {
      setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyLarge)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
    }
    textContainer.addView(titleView)

    subtitleView = TextView(context).apply {
      setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
      setTextColor(
        MaterialColors.getColor(
          this,
          com.google.android.material.R.attr.colorOnSurfaceVariant,
          Color.GRAY,
        ),
      )
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
    }
    textContainer.addView(subtitleView)
  }

  fun bind(title: String, subtitle: String) {
    titleView.text = title
    subtitleView.text = subtitle
  }

  private fun dpInt(value: Int): Int = (value * density).toInt()
}

@Parcelize
internal data class PickerArgs(
  val initialLatitude: Double? = null,
  val initialLongitude: Double? = null,
  val initialRadiusMeters: Double? = null,
  val title: String? = null,
  val doneButtonTitle: String? = null,
  val cancelButtonTitle: String? = null,
  val searchPlaceholder: String? = null,
  val locale: String? = null,
  val disableCurrentLocation: Boolean = false,
  /// Themed primary color (parsed from theme.primary on the JS side).
  val primaryColor: Int? = null,
  /// Themed pin marker color.
  val pinColor: Int? = null,
  /// One of "light", "dark", "system" — controls Configuration.UI_MODE_NIGHT_MASK.
  val colorScheme: String? = null,
) : Parcelable
