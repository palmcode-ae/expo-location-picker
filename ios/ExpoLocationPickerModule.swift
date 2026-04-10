import Contacts
import CoreLocation
import ExpoModulesCore
import MapKit
import UIKit

public class ExpoLocationPickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLocationPicker")

    AsyncFunction("pickLocation") { (options: PickLocationOptions?, promise: Promise) in
      DispatchQueue.main.async {
        guard let presenter = self.appContext?.utilities?.currentViewController() else {
          promise.reject(
            "ERR_NO_PRESENTER",
            "expo-location-picker: no view controller available to present the picker."
          )
          return
        }

        let picker = LocationPickerViewController(options: options ?? PickLocationOptions()) { result in
          presenter.dismiss(animated: true) {
            promise.resolve(result?.toDictionary() as Any?)
          }
        }

        let nav = UINavigationController(rootViewController: picker)
        nav.modalPresentationStyle = .fullScreen
        nav.modalTransitionStyle = .coverVertical
        presenter.present(nav, animated: true)
      }
    }
  }
}

// MARK: - Options & Result

internal struct PickLocationOptions: Record {
  @Field var initialLatitude: Double? = nil
  @Field var initialLongitude: Double? = nil
  @Field var initialRadiusMeters: Double? = nil
  @Field var title: String? = nil
  @Field var doneButtonTitle: String? = nil
  @Field var cancelButtonTitle: String? = nil
  @Field var searchPlaceholder: String? = nil
  @Field var locale: String? = nil
  @Field var disableCurrentLocation: Bool = false
  @Field var theme: PickLocationThemeOptions? = nil
}

internal struct PickLocationThemeOptions: Record {
  @Field var primary: String? = nil
  @Field var pin: String? = nil
  /// One of `"light"`, `"dark"`, `"system"`. Anything else falls back to system.
  @Field var colorScheme: String? = nil
}

// MARK: - Color parsing

extension UIColor {
  /// Parses a hex string of the form `"#RGB"`, `"#RRGGBB"`, or `"#RRGGBBAA"`
  /// (with or without the leading `#`). Returns `nil` for malformed strings.
  static func fromHex(_ hex: String?) -> UIColor? {
    guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
      return nil
    }
    if s.hasPrefix("#") { s.removeFirst() }
    // Expand "RGB" → "RRGGBB"
    if s.count == 3 {
      s = s.map { "\($0)\($0)" }.joined()
    }
    guard s.count == 6 || s.count == 8 else { return nil }
    var value: UInt64 = 0
    guard Scanner(string: s).scanHexInt64(&value) else { return nil }
    let hasAlpha = s.count == 8
    let r = CGFloat((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
    let g = CGFloat((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
    let b = CGFloat((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
    let a = hasAlpha ? CGFloat(value & 0xFF) / 255 : 1
    return UIColor(red: r, green: g, blue: b, alpha: a)
  }
}

internal struct PickLocationResultPayload {
  let coordinate: CLLocationCoordinate2D
  let placemark: CLPlacemark?

  func toDictionary() -> [String: Any] {
    var dict: [String: Any] = [
      "latitude": coordinate.latitude,
      "longitude": coordinate.longitude,
    ]

    if let p = placemark {
      let lines = [p.name, p.thoroughfare, p.locality, p.administrativeArea, p.country]
        .compactMap { $0 }
      let formatted: String
      if let postal = p.postalAddress {
        formatted = CNPostalAddressFormatter().string(from: postal)
          .replacingOccurrences(of: "\n", with: ", ")
      } else {
        formatted = lines.joined(separator: ", ")
      }
      if !formatted.isEmpty { dict["formattedAddress"] = formatted }
      if let v = p.name { dict["name"] = v }
      if let v = p.locality { dict["locality"] = v }
      if let v = p.administrativeArea { dict["administrativeArea"] = v }
      if let v = p.postalCode { dict["postalCode"] = v }
      if let v = p.isoCountryCode { dict["countryCode"] = v }
      if let v = p.country { dict["country"] = v }
    }
    return dict
  }
}

// MARK: - View controller

internal final class LocationPickerViewController: UIViewController,
  MKMapViewDelegate, CLLocationManagerDelegate, UISearchResultsUpdating,
  MKLocalSearchCompleterDelegate
{
  private let options: PickLocationOptions
  private let completion: (PickLocationResultPayload?) -> Void

  private let mapView = MKMapView()
  private let pinView = CenterPinView()
  private let locationManager = CLLocationManager()
  private let completer = MKLocalSearchCompleter()
  private var trackingButton: TrackingButton?
  private lazy var resultsViewController = SearchResultsViewController()
  private lazy var searchController: UISearchController = {
    let controller = UISearchController(searchResultsController: resultsViewController)
    controller.searchResultsUpdater = self
    // We provide our own translucent background in `SearchResultsViewController`,
    // so we don't want UIKit to add a dim layer behind the results VC.
    controller.obscuresBackgroundDuringPresentation = false
    controller.hidesNavigationBarDuringPresentation = false
    controller.searchBar.placeholder = options.searchPlaceholder
      ?? NSLocalizedString("Search places or addresses", comment: "")
    controller.searchBar.autocapitalizationType = .none
    controller.searchBar.returnKeyType = .search
    return controller
  }()

  private var didSetInitialRegion = false
  private var hasFinished = false
  private lazy var geocoder = CLGeocoder()
  private lazy var locale: Locale = {
    if let id = options.locale, !id.isEmpty {
      return Locale(identifier: id)
    }
    return Locale.current
  }()

  /// True when the consumer has *both* opted in to the current-location
  /// button **and** declared `NSLocationWhenInUseUsageDescription` in their
  /// `Info.plist`. Without the usage description string, calling
  /// `requestWhenInUseAuthorization()` silently fails on iOS — no prompt is
  /// shown, the status stays `.notDetermined` forever, and any
  /// `MKUserTrackingButton` spinner spins indefinitely. Disabling the
  /// feature entirely in that case is the only safe behavior.
  private lazy var locationFeatureEnabled: Bool = {
    if options.disableCurrentLocation { return false }
    let key = "NSLocationWhenInUseUsageDescription"
    let alwaysKey = "NSLocationAlwaysAndWhenInUseUsageDescription"
    let hasUsageDescription =
      Bundle.main.object(forInfoDictionaryKey: key) != nil
      || Bundle.main.object(forInfoDictionaryKey: alwaysKey) != nil
    if !hasUsageDescription {
      NSLog(
        "[expo-location-picker] NSLocationWhenInUseUsageDescription is missing from Info.plist; "
        + "the 'current location' button will be hidden. Add it via "
        + "app.json → ios.infoPlist.NSLocationWhenInUseUsageDescription "
        + "(or set it directly in Info.plist) and rebuild your app."
      )
    }
    return hasUsageDescription
  }()

  init(
    options: PickLocationOptions,
    completion: @escaping (PickLocationResultPayload?) -> Void
  ) {
    self.options = options
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    applyTheme()
    setupNavigationBar()
    setupMap()
    setupCenterPin()
    setupCompleter()
    setupResultsHandling()

    if locationFeatureEnabled {
      locationManager.delegate = self
      locationManager.desiredAccuracy = kCLLocationAccuracyBest
      let status: CLAuthorizationStatus
      if #available(iOS 14.0, *) {
        status = locationManager.authorizationStatus
      } else {
        status = CLLocationManager.authorizationStatus()
      }
      if status == .notDetermined {
        locationManager.requestWhenInUseAuthorization()
      } else if status == .authorizedWhenInUse || status == .authorizedAlways {
        mapView.showsUserLocation = true
      }
    }

    applyInitialRegion()
  }

  // MARK: setup

  /// Apply the user's `theme` option to the picker. Anything not specified
  /// falls back to UIKit's system colors so the picker continues to feel
  /// native by default.
  ///
  /// - `theme.primary` becomes the navigation bar's `tintColor`, which
  ///   UIKit propagates to the Cancel/Done bar buttons and to the focus
  ///   ring on the search bar.
  /// - `theme.pin` becomes the pin marker fill color (forwarded into
  ///   `CenterPinView` after it's instantiated).
  /// - `theme.colorScheme` maps to `overrideUserInterfaceStyle` so the
  ///   picker can be forced light or dark regardless of the system.
  private func applyTheme() {
    guard let theme = options.theme else { return }

    if let primaryHex = theme.primary, let primary = UIColor.fromHex(primaryHex) {
      view.tintColor = primary
    }
    // pin color is applied later in setupCenterPin once the view exists.

    switch theme.colorScheme {
    case "light":
      overrideUserInterfaceStyle = .light
    case "dark":
      overrideUserInterfaceStyle = .dark
    default:
      overrideUserInterfaceStyle = .unspecified
    }
  }

  private func setupNavigationBar() {
    title = options.title ?? NSLocalizedString("Choose location", comment: "")
    navigationItem.largeTitleDisplayMode = .never

    navigationItem.leftBarButtonItem = UIBarButtonItem(
      title: options.cancelButtonTitle ?? NSLocalizedString("Cancel", comment: ""),
      style: .plain,
      target: self,
      action: #selector(cancelTapped)
    )
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: options.doneButtonTitle ?? NSLocalizedString("Done", comment: ""),
      style: .done,
      target: self,
      action: #selector(doneTapped)
    )

    // The native pattern: search bar lives inside the navigation item.
    // It collapses into the nav bar on iOS 16+ and stays pinned otherwise.
    navigationItem.searchController = searchController
    navigationItem.hidesSearchBarWhenScrolling = false
    if #available(iOS 16.0, *) {
      navigationItem.preferredSearchBarPlacement = .stacked
    }

    definesPresentationContext = true
  }

  private func setupMap() {
    mapView.translatesAutoresizingMaskIntoConstraints = false
    mapView.delegate = self
    mapView.showsCompass = true
    mapView.showsScale = true
    mapView.pointOfInterestFilter = .includingAll
    view.addSubview(mapView)
    NSLayoutConstraint.activate([
      mapView.topAnchor.constraint(equalTo: view.topAnchor),
      mapView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      mapView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      mapView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    if locationFeatureEnabled {
      let button = TrackingButton(mapView: mapView)
      trackingButton = button
      button.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(button)
      NSLayoutConstraint.activate([
        button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
        button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
        button.widthAnchor.constraint(equalToConstant: 48),
        button.heightAnchor.constraint(equalToConstant: 48),
      ])
    }
  }

  private func setupCenterPin() {
    pinView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(pinView)
    // Anchor to the safe area so the pin sits in the visual center of the
    // *visible* map area (not behind the translucent nav bar / search field).
    NSLayoutConstraint.activate([
      pinView.centerXAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerXAnchor),
      pinView.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
      pinView.widthAnchor.constraint(equalToConstant: 44),
      pinView.heightAnchor.constraint(equalToConstant: 56),
    ])

    // Apply the themed pin color (defaults to .systemRed inside PinMarkerView).
    if let pinHex = options.theme?.pin, let color = UIColor.fromHex(pinHex) {
      pinView.pinColor = color
    }
  }

  // MARK: pin <-> coordinate math

  /// The geographic coordinate currently sitting under the pin's tip.
  /// Always read this instead of `mapView.centerCoordinate`, because the
  /// pin is at the visible center of the map (i.e. the safe-area center),
  /// not the map view's geometric center.
  private var pinCoordinate: CLLocationCoordinate2D {
    let pinTipInMap = pinView.convert(CGPoint(x: pinView.bounds.midX, y: pinView.bounds.midY), to: mapView)
    return mapView.convert(pinTipInMap, toCoordinateFrom: mapView)
  }

  /// Set the map's region so that `coordinate` ends up exactly under the
  /// pin (which is offset from the map's geometric center by the safe area).
  /// Computed analytically so it's a single, smooth setRegion call — no
  /// intermediate jump.
  private func centerMap(
    on coordinate: CLLocationCoordinate2D,
    radius: Double,
    animated: Bool
  ) {
    view.layoutIfNeeded()

    let span = MKCoordinateRegion(
      center: coordinate,
      latitudinalMeters: radius,
      longitudinalMeters: radius
    ).span

    let pinTipInMap = pinView.convert(CGPoint(x: pinView.bounds.midX, y: pinView.bounds.midY), to: mapView)
    let pinDeltaX = pinTipInMap.x - mapView.bounds.midX
    let pinDeltaY = pinTipInMap.y - mapView.bounds.midY

    let mapHeight = max(mapView.bounds.height, 1)
    let mapWidth = max(mapView.bounds.width, 1)
    let latPerPoint = span.latitudeDelta / mapHeight
    let lonPerPoint = span.longitudeDelta / mapWidth

    // North = up = lower y, so a positive `pinDeltaY` (pin below center)
    // means the geometric center coordinate should be NORTH of `coordinate`
    // by that many points.
    let geometricCenter = CLLocationCoordinate2D(
      latitude: coordinate.latitude + pinDeltaY * latPerPoint,
      longitude: coordinate.longitude - pinDeltaX * lonPerPoint
    )

    mapView.setRegion(
      MKCoordinateRegion(center: geometricCenter, span: span),
      animated: animated
    )
  }

  private func setupCompleter() {
    completer.delegate = self
    completer.resultTypes = [.address, .pointOfInterest]
  }

  private func setupResultsHandling() {
    resultsViewController.onSelect = { [weak self] completion in
      self?.handleSelection(of: completion)
    }
  }

  private func applyInitialRegion() {
    let radius = options.initialRadiusMeters ?? 1000
    if let lat = options.initialLatitude, let lon = options.initialLongitude {
      centerMap(
        on: CLLocationCoordinate2D(latitude: lat, longitude: lon),
        radius: radius,
        animated: false
      )
      didSetInitialRegion = true
    }
  }

  // MARK: actions

  @objc private func cancelTapped() {
    finish(with: nil)
  }

  @objc private func doneTapped() {
    let coord = pinCoordinate
    let location = CLLocation(latitude: coord.latitude, longitude: coord.longitude)
    // Best-effort reverse geocode; even if it fails we still resolve with coords.
    geocoder.reverseGeocodeLocation(location, preferredLocale: locale) { [weak self] placemarks, _ in
      guard let self = self else { return }
      let payload = PickLocationResultPayload(
        coordinate: coord,
        placemark: placemarks?.first
      )
      self.finish(with: payload)
    }
  }

  private func finish(with payload: PickLocationResultPayload?) {
    guard !hasFinished else { return }
    hasFinished = true
    completion(payload)
  }

  // MARK: MKMapViewDelegate — animate the pin while panning

  func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
    pinView.setLifted(true, animated: true)
  }

  func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
    pinView.setLifted(false, animated: true)
  }

  func mapView(
    _ mapView: MKMapView,
    didChange mode: MKUserTrackingMode,
    animated: Bool
  ) {
    trackingButton?.syncState(with: mode)
  }

  // MARK: CLLocationManagerDelegate

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    if status == .authorizedWhenInUse || status == .authorizedAlways {
      mapView.showsUserLocation = true
      if !didSetInitialRegion {
        manager.requestLocation()
      }
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let loc = locations.last, !didSetInitialRegion else { return }
    didSetInitialRegion = true
    let radius = options.initialRadiusMeters ?? 1000
    centerMap(on: loc.coordinate, radius: radius, animated: true)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // Non-fatal — the user can still pan the map manually.
  }

  // MARK: UISearchResultsUpdating

  func updateSearchResults(for searchController: UISearchController) {
    let query = searchController.searchBar.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if query.isEmpty {
      resultsViewController.update(with: [])
      return
    }
    completer.region = mapView.region
    completer.queryFragment = query
  }

  // MARK: MKLocalSearchCompleterDelegate

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    resultsViewController.update(with: completer.results)
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    resultsViewController.update(with: [])
  }

  // MARK: result selection

  private func handleSelection(of completion: MKLocalSearchCompletion) {
    let request = MKLocalSearch.Request(completion: completion)
    let search = MKLocalSearch(request: request)
    search.start { [weak self] response, _ in
      guard let self = self, let item = response?.mapItems.first else { return }
      DispatchQueue.main.async {
        self.centerMap(on: item.placemark.coordinate, radius: 800, animated: true)
        self.searchController.searchBar.text = item.name ?? completion.title
        self.searchController.isActive = false
      }
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    // Safety net: if the picker is dismissed by gesture, the system, or a
    // configuration change, resolve with `null` instead of leaving the JS
    // promise hanging.
    finish(with: nil)
  }
}

// MARK: - Search results view controller

internal final class SearchResultsViewController: UITableViewController {
  var onSelect: ((MKLocalSearchCompletion) -> Void)?

  private var results: [MKLocalSearchCompletion] = []
  private static let cellIdentifier = "ExpoLocationPickerSearchCardCell"

  init() {
    // Plain style — we draw our own card backgrounds per cell.
    super.init(style: .plain)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    tableView.register(SearchResultCardCell.self, forCellReuseIdentifier: Self.cellIdentifier)
    tableView.keyboardDismissMode = .onDrag
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 76

    // Cards float directly over the map — no separators, no underlay blur,
    // no opaque background. Each cell brings its own glass/blur material.
    tableView.separatorStyle = .none
    tableView.backgroundColor = .clear
    tableView.backgroundView = nil
    view.backgroundColor = .clear
    // Translucent presentation: the map underneath should remain visible
    // through the results list. We add a Liquid Glass / blur underlay so
    // text stays legible over busy map tiles, then set every layer above
    // it to clear so the blur shows through.
    view.backgroundColor = .clear

    let blur = UIVisualEffectView(
      effect: UIBlurEffect(style: .systemThinMaterial)
    )
    blur.translatesAutoresizingMaskIntoConstraints = false
    blur.isUserInteractionEnabled = false
    view.insertSubview(blur, at: 0)
    NSLayoutConstraint.activate([
      blur.topAnchor.constraint(equalTo: view.topAnchor),
      blur.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      blur.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      blur.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    // A little breathing room above the first card.
    tableView.contentInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
  }

  func update(with results: [MKLocalSearchCompletion]) {
    self.results = results
    tableView.reloadData()
  }

  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    results.count
  }

  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(
      withIdentifier: Self.cellIdentifier,
      for: indexPath
    ) as! SearchResultCardCell
    let result = results[indexPath.row]

    var config = UIListContentConfiguration.subtitleCell()
    config.text = result.title
    config.secondaryText = result.subtitle
    config.image = UIImage(
      systemName: "mappin.circle.fill",
      withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .regular)
    )
    cell.contentConfiguration = config

    return cell
  }

  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    onSelect?(results[indexPath.row])
  }
}

// MARK: - Card cell

/// A search result cell rendered as a floating card with a translucent
/// background. Uses `UIGlassEffect` on iOS 26+ for proper Liquid Glass and
/// falls back to `UIBlurEffect(style: .systemThickMaterial)` on iOS 15.1–25.
///
/// The cell intentionally doesn't use `UITableViewCell.backgroundView` /
/// `selectedBackgroundView` because UITableView positions those at the full
/// cell bounds; we want the card and its highlight to match the inset shape.
internal final class SearchResultCardCell: UITableViewCell {
  private let card: UIVisualEffectView = {
    let effect: UIVisualEffect
    if #available(iOS 26.0, *) {
      effect = UIGlassEffect()
    } else {
      effect = UIBlurEffect(style: .systemThickMaterial)
    }
    let view = UIVisualEffectView(effect: effect)
    view.translatesAutoresizingMaskIntoConstraints = false
    view.layer.cornerRadius = 16
    view.layer.cornerCurve = .continuous
    view.clipsToBounds = true
    return view
  }()

  private let highlightOverlay: UIView = {
    let view = UIView()
    view.translatesAutoresizingMaskIntoConstraints = false
    view.backgroundColor = UIColor.label.withAlphaComponent(0.08)
    view.alpha = 0
    view.isUserInteractionEnabled = false
    return view
  }()

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)

    backgroundColor = .clear
    contentView.backgroundColor = .clear
    selectionStyle = .none // we drive the highlight ourselves via the overlay
    backgroundView = nil
    selectedBackgroundView = nil

    contentView.insertSubview(card, at: 0)
    card.contentView.addSubview(highlightOverlay)

    NSLayoutConstraint.activate([
      // Card insets — 16pt horizontal, 4pt vertical so adjacent cards have
      // an 8pt visible gap between them.
      card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
      card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
      card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),

      highlightOverlay.topAnchor.constraint(equalTo: card.contentView.topAnchor),
      highlightOverlay.bottomAnchor.constraint(equalTo: card.contentView.bottomAnchor),
      highlightOverlay.leadingAnchor.constraint(equalTo: card.contentView.leadingAnchor),
      highlightOverlay.trailingAnchor.constraint(equalTo: card.contentView.trailingAnchor),
    ])

    // Push UIListContentConfiguration's labels inward so they sit visually
    // inside the card, not against the cell edges.
    contentView.directionalLayoutMargins = NSDirectionalEdgeInsets(
      top: 16, leading: 32, bottom: 16, trailing: 32
    )
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

  override func setHighlighted(_ highlighted: Bool, animated: Bool) {
    super.setHighlighted(highlighted, animated: animated)
    let block = { self.highlightOverlay.alpha = highlighted ? 1 : 0 }
    if animated {
      UIView.animate(
        withDuration: 0.18,
        delay: 0,
        options: [.allowUserInteraction, .beginFromCurrentState],
        animations: block
      )
    } else {
      block()
    }
  }

  override func setSelected(_ selected: Bool, animated: Bool) {
    super.setSelected(selected, animated: animated)
    // We immediately deselect in `didSelectRowAt`, so no persistent state.
  }
}

// MARK: - Tracking button

/// A floating "current location" button that uses the iOS 26 Liquid Glass
/// `UIButton.Configuration.glass()` material when available, and falls back
/// to a blurred `MKUserTrackingButton` on iOS 15.1–25.
///
/// Tapping toggles `mapView.userTrackingMode` between `.none`, `.follow`,
/// and `.followWithHeading`, mirroring Apple Maps' own button.
internal final class TrackingButton: UIView {
  private weak var mapView: MKMapView?
  private var legacyButton: MKUserTrackingButton?
  private var glassButton: UIButton?

  init(mapView: MKMapView) {
    self.mapView = mapView
    super.init(frame: .zero)

    if #available(iOS 26.0, *) {
      installGlassButton()
    } else {
      installLegacyButton(mapView: mapView)
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

  // MARK: legacy fallback (iOS 15.1 – 25)

  private func installLegacyButton(mapView: MKMapView) {
    let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
    blur.translatesAutoresizingMaskIntoConstraints = false
    blur.layer.cornerRadius = 12
    blur.clipsToBounds = true
    blur.layer.masksToBounds = true
    addSubview(blur)

    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.18
    layer.shadowRadius = 8
    layer.shadowOffset = CGSize(width: 0, height: 3)

    let tracker = MKUserTrackingButton(mapView: mapView)
    tracker.translatesAutoresizingMaskIntoConstraints = false
    blur.contentView.addSubview(tracker)
    legacyButton = tracker

    NSLayoutConstraint.activate([
      blur.topAnchor.constraint(equalTo: topAnchor),
      blur.leadingAnchor.constraint(equalTo: leadingAnchor),
      blur.trailingAnchor.constraint(equalTo: trailingAnchor),
      blur.bottomAnchor.constraint(equalTo: bottomAnchor),

      tracker.centerXAnchor.constraint(equalTo: blur.contentView.centerXAnchor),
      tracker.centerYAnchor.constraint(equalTo: blur.contentView.centerYAnchor),
      tracker.widthAnchor.constraint(equalToConstant: 32),
      tracker.heightAnchor.constraint(equalToConstant: 32),
    ])
  }

  // MARK: Liquid Glass (iOS 26+)

  @available(iOS 26.0, *)
  private func installGlassButton() {
    var config = UIButton.Configuration.glass()
    config.cornerStyle = .capsule
    config.image = symbolImage(for: .none)
    config.baseForegroundColor = .label

    let button = UIButton(configuration: config, primaryAction: nil)
    button.translatesAutoresizingMaskIntoConstraints = false
    button.addAction(
      UIAction { [weak self] _ in self?.toggleTrackingMode() },
      for: .touchUpInside
    )
    addSubview(button)
    glassButton = button

    NSLayoutConstraint.activate([
      button.topAnchor.constraint(equalTo: topAnchor),
      button.leadingAnchor.constraint(equalTo: leadingAnchor),
      button.trailingAnchor.constraint(equalTo: trailingAnchor),
      button.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  // MARK: state

  /// Called by the picker when the map's tracking mode changes (either
  /// programmatically or because the user dragged the map and MapKit
  /// dropped tracking back to `.none`).
  func syncState(with mode: MKUserTrackingMode) {
    if #available(iOS 26.0, *) {
      guard let button = glassButton else { return }
      var config = button.configuration ?? .glass()
      config.image = symbolImage(for: mode)
      switch mode {
      case .none:
        button.configuration = .glass().applying(
          image: symbolImage(for: .none),
          tint: .label
        )
      case .follow:
        button.configuration = .prominentGlass().applying(
          image: symbolImage(for: .follow),
          tint: .systemBlue
        )
      case .followWithHeading:
        button.configuration = .prominentGlass().applying(
          image: symbolImage(for: .followWithHeading),
          tint: .systemBlue
        )
      @unknown default:
        button.configuration = config
      }
    }
    // Legacy MKUserTrackingButton manages its own state automatically.
  }

  @available(iOS 26.0, *)
  private func toggleTrackingMode() {
    guard let mapView = mapView else { return }
    let next: MKUserTrackingMode
    switch mapView.userTrackingMode {
    case .none: next = .follow
    case .follow: next = .followWithHeading
    case .followWithHeading: next = .none
    @unknown default: next = .none
    }
    mapView.setUserTrackingMode(next, animated: true)
  }

  private func symbolImage(for mode: MKUserTrackingMode) -> UIImage? {
    let name: String
    switch mode {
    case .none: name = "location"
    case .follow: name = "location.fill"
    case .followWithHeading: name = "location.north.line.fill"
    @unknown default: name = "location"
    }
    return UIImage(
      systemName: name,
      withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)
    )
  }
}

@available(iOS 26.0, *)
private extension UIButton.Configuration {
  /// Returns a copy of this configuration with the given image and foreground tint.
  func applying(image: UIImage?, tint: UIColor) -> UIButton.Configuration {
    var copy = self
    copy.image = image
    copy.baseForegroundColor = tint
    copy.cornerStyle = .capsule
    return copy
  }
}

// MARK: - Pin marker (cross-platform vector)

/// A 32×40 pt teardrop pin drawn by `CAShapeLayer` from a hand-tuned
/// `UIBezierPath`. The path coordinates are **identical** to the Android
/// `expolocationpicker_pin.xml` vector drawable and the inline web
/// `PIN_SVG`, so the pin renders as the same shape on every platform.
///
/// The visible tip lands exactly at viewport (16, 40) — the bottom-center
/// of the view — so a parent that aligns this view's bottom edge to a map
/// point will have the pin tip *on* that point, with no offset math.
internal final class PinMarkerView: UIView {
  /// Pin body fill color. Settable so the picker can theme it from
  /// `PickLocationOptions.theme.pin`.
  var fillColor: UIColor = .systemRed {
    didSet { bodyLayer.fillColor = fillColor.cgColor }
  }

  private let bodyLayer = CAShapeLayer()
  private let holeLayer = CAShapeLayer()

  override init(frame: CGRect) {
    super.init(frame: frame)
    setupLayers()
    isUserInteractionEnabled = false
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

  override var intrinsicContentSize: CGSize {
    CGSize(width: 32, height: 40)
  }

  private func setupLayers() {
    // Teardrop path: identical to expolocationpicker_pin.xml on Android.
    let body = UIBezierPath()
    body.move(to: CGPoint(x: 16, y: 2))
    body.addCurve(
      to: CGPoint(x: 2, y: 14),
      controlPoint1: CGPoint(x: 8.27, y: 2),
      controlPoint2: CGPoint(x: 2, y: 7.27)
    )
    body.addCurve(
      to: CGPoint(x: 5.4, y: 23.2),
      controlPoint1: CGPoint(x: 2, y: 17.5),
      controlPoint2: CGPoint(x: 3.27, y: 20.7)
    )
    body.addLine(to: CGPoint(x: 16, y: 40))
    body.addLine(to: CGPoint(x: 26.6, y: 23.2))
    body.addCurve(
      to: CGPoint(x: 30, y: 14),
      controlPoint1: CGPoint(x: 28.73, y: 20.7),
      controlPoint2: CGPoint(x: 30, y: 17.5)
    )
    body.addCurve(
      to: CGPoint(x: 16, y: 2),
      controlPoint1: CGPoint(x: 30, y: 7.27),
      controlPoint2: CGPoint(x: 23.73, y: 2)
    )
    body.close()

    bodyLayer.path = body.cgPath
    bodyLayer.fillColor = fillColor.cgColor
    bodyLayer.strokeColor = UIColor.white.cgColor
    bodyLayer.lineWidth = 1.5
    bodyLayer.lineJoin = .round
    layer.addSublayer(bodyLayer)

    // White inner circle at (16, 14) with radius 5 — same as Android XML.
    let hole = UIBezierPath(
      arcCenter: CGPoint(x: 16, y: 14),
      radius: 5,
      startAngle: 0,
      endAngle: .pi * 2,
      clockwise: true
    )
    holeLayer.path = hole.cgPath
    holeLayer.fillColor = UIColor.white.cgColor
    layer.addSublayer(holeLayer)

    // Drop shadow for depth against the map.
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.3
    layer.shadowRadius = 5
    layer.shadowOffset = CGSize(width: 0, height: 3)
    layer.masksToBounds = false
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Both shape layers live in the view's coordinate space, which by
    // default is the view's bounds. The path is hand-coded for a 32×40
    // viewport, so we need to scale if the view is sized differently.
    let scaleX = bounds.width / 32
    let scaleY = bounds.height / 40
    let transform = CATransform3DMakeScale(scaleX, scaleY, 1)
    bodyLayer.transform = transform
    holeLayer.transform = transform
  }
}

// MARK: - Center pin view (with shadow + lift animation)

internal final class CenterPinView: UIView {
  private let pinShape = PinMarkerView()

  /// Forwards to the underlying marker so the picker can theme the pin
  /// color from `PickLocationOptions.theme.pin`.
  var pinColor: UIColor {
    get { pinShape.fillColor }
    set { pinShape.fillColor = newValue }
  }

  private let shadowDot: UIView = {
    let view = UIView()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.35)
    view.layer.cornerRadius = 3.5
    view.layer.shadowColor = UIColor.black.cgColor
    view.layer.shadowOpacity = 0.5
    view.layer.shadowRadius = 1
    view.layer.shadowOffset = .zero
    view.alpha = 0
    return view
  }()

  private var pinBottomConstraint: NSLayoutConstraint!

  init() {
    super.init(frame: .zero)
    isUserInteractionEnabled = false

    addSubview(shadowDot)
    addSubview(pinShape)
    shadowDot.translatesAutoresizingMaskIntoConstraints = false
    pinShape.translatesAutoresizingMaskIntoConstraints = false

    // The pin tip (bottom of the marker view) lands exactly on the view's
    // vertical center — which is the point that the parent VC anchors to
    // the map. The shadow dot also sits on that exact point so the pin and
    // dot agree on which pixel they're "pointing" at.
    pinBottomConstraint = pinShape.bottomAnchor.constraint(equalTo: centerYAnchor)

    NSLayoutConstraint.activate([
      pinShape.centerXAnchor.constraint(equalTo: centerXAnchor),
      pinBottomConstraint,
      pinShape.widthAnchor.constraint(equalToConstant: 32),
      pinShape.heightAnchor.constraint(equalToConstant: 40),

      shadowDot.centerXAnchor.constraint(equalTo: centerXAnchor),
      shadowDot.centerYAnchor.constraint(equalTo: centerYAnchor),
      shadowDot.widthAnchor.constraint(equalToConstant: 7),
      shadowDot.heightAnchor.constraint(equalToConstant: 7),
    ])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

  /// Lifts the pin above the map by ~14pt while panning, like Apple Maps
  /// does, and reveals the shadow dot underneath so the user can see the
  /// exact point being picked.
  func setLifted(_ lifted: Bool, animated: Bool) {
    pinBottomConstraint.constant = lifted ? -14 : 0
    let block = {
      self.layoutIfNeeded()
      self.shadowDot.alpha = lifted ? 1 : 0
    }
    if animated {
      UIView.animate(
        withDuration: 0.22,
        delay: 0,
        usingSpringWithDamping: 0.7,
        initialSpringVelocity: 0.6,
        options: [.beginFromCurrentState, .allowUserInteraction],
        animations: block
      )
    } else {
      block()
    }
  }
}
