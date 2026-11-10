package expo.modules.map3d

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.android.gms.maps3d.GoogleMap3D
import com.google.android.gms.maps3d.Map3DView
import com.google.android.gms.maps3d.OnMap3DViewReadyCallback
import com.google.android.gms.maps3d.model.AltitudeMode
import com.google.android.gms.maps3d.model.LatLngAltitude
import com.google.android.gms.maps3d.model.Map3DMode
import com.google.android.gms.maps3d.model.Marker
import com.google.android.gms.maps3d.model.Polyline
import com.google.android.gms.maps3d.model.camera
import com.google.android.gms.maps3d.model.flyToOptions
import com.google.android.gms.maps3d.model.latLngAltitude
import com.google.android.gms.maps3d.model.markerOptions
import com.google.android.gms.maps3d.model.polylineOptions
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

class Map3DStatusEvent(@Field val isSteady: Boolean) : Record

// Android side of the same "real photorealistic 3D satellite" feature already shipped on
// web (see web/src/components/Map3DView.tsx) -- this wraps Google's newer, separate Maps 3D
// SDK for Android (com.google.android.gms.maps3d), not the classic react-native-maps
// MapView, since only this SDK actually has real mesh-based 3D terrain/buildings that tilt
// cleanly instead of warping like flat satellite photos do.
//
// Stage 1 scope, matching the web build: camera + live position marker + the active route
// polyline only. No traffic-light/speed-camera/alert overlays yet.
//
// This SDK is pre-1.0 (0.2.0) and, unlike the web JS API, requires the hosting Activity's
// lifecycle to be forwarded into the Map3DView by hand (onCreate/onStart/onResume/onPause/
// onStop/onDestroy) -- there's no Compose/Fragment host doing that automatically here since
// this view is mounted dynamically by React Native. Registering a LifecycleEventObserver on
// the Activity handles that, including replaying any states already passed (e.g. onResume)
// by the time this view actually gets created.
class ExpoMap3DView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val map3DView = Map3DView(context)
  private var googleMap3D: GoogleMap3D? = null
  private var hasAppliedInitialCamera = false

  private var markerObj: Marker? = null
  private var polylineObj: Polyline? = null

  // Latest desired state from JS -- applied immediately if the map's ready, or once it
  // becomes ready if props arrive first (React can set props before onMap3DViewReady fires).
  private var centerLat: Double? = null
  private var centerLng: Double? = null
  private var heading = 0.0
  private var tilt = 0.0
  private var range = 400.0
  private var mapMode = Map3DMode.HYBRID
  private var markerLat: Double? = null
  private var markerLng: Double? = null
  private var routeCoordinates: List<LatLngAltitude> = emptyList()

  private val onStatusChange by EventDispatcher<Map3DStatusEvent>()

  private val lifecycleObserver = LifecycleEventObserver { _, event ->
    when (event) {
      Lifecycle.Event.ON_START -> map3DView.onStart()
      Lifecycle.Event.ON_RESUME -> map3DView.onResume()
      Lifecycle.Event.ON_PAUSE -> map3DView.onPause()
      Lifecycle.Event.ON_STOP -> map3DView.onStop()
      Lifecycle.Event.ON_DESTROY -> map3DView.onDestroy()
      else -> {}
    }
  }

  init {
    map3DView.onCreate(null)
    addView(map3DView)
    (appContext.throwingActivity as? ComponentActivity)?.lifecycle?.addObserver(lifecycleObserver)

    // Real, confirmed-via-reproduction Kotlin 2.2 regression: a plain trailing-lambda SAM
    // conversion here (`getMap3DViewAsync { map -> ... }`) fails to type-check under the
    // Kotlin 2.2.20 compiler this project moved to (to read google-mobile-ads' own newer
    // Kotlin metadata -- see android/build.gradle's own comment) with "Argument type
    // mismatch: actual type is Function1<ERROR CLASS: Unknown return lambda parameter
    // type...>". play-services-maps3d 0.2.0's own OnMap3DViewReadyCallback is itself compiled
    // with Kotlin metadata version 2.2.0 (confirmed by inspecting its class file), and its
    // callback interface carries a `default` method (onError) alongside the one abstract
    // method -- SAM conversion of a bare lambda apparently can't resolve cleanly against that
    // shape under 2.2.20's K2 compiler. An explicit anonymous object implementing the real
    // interface directly (not a SAM-converted lambda) sidesteps whatever inference path broke.
    map3DView.getMap3DViewAsync(object : OnMap3DViewReadyCallback {
      override fun onMap3DViewReady(map: GoogleMap3D) {
        googleMap3D = map
        map.setMapMode(mapMode)
        map.setOnMapSteadyListener { isSteady -> onStatusChange(Map3DStatusEvent(isSteady)) }
        applyMarker()
        applyPolyline()
        applyInitialCameraIfReady()
      }
    })
  }

  override fun onDetachedFromWindow() {
    (appContext.throwingActivity as? ComponentActivity)?.lifecycle?.removeObserver(lifecycleObserver)
    super.onDetachedFromWindow()
  }

  private fun applyInitialCameraIfReady() {
    val map = googleMap3D ?: return
    val lat = centerLat ?: return
    val lng = centerLng ?: return
    if (hasAppliedInitialCamera) return
    hasAppliedInitialCamera = true
    // Same reasoning as the web build: photorealistic tiles stream in progressively, so
    // starting already close-in and steeply tilted asks for the most expensive tiles
    // immediately. Construct wide/flat, then ease down to the real target.
    map.setCamera(
      camera {
        center = latLngAltitude {
          latitude = lat
          longitude = lng
          altitude = 0.0
        }
        this.heading = this@ExpoMap3DView.heading
        this.tilt = 0.0
        this.range = maxOf(this@ExpoMap3DView.range * 3, 1500.0)
      }
    )
    map.flyCameraTo(
      flyToOptions {
        endCamera = camera {
          center = latLngAltitude {
            latitude = lat
            longitude = lng
            altitude = 0.0
          }
          heading = this@ExpoMap3DView.heading
          tilt = this@ExpoMap3DView.tilt
          range = this@ExpoMap3DView.range
        }
        durationInMillis = 1200
      }
    )
  }

  private fun applyMarker() {
    val map = googleMap3D ?: return
    val lat = markerLat ?: return
    val lng = markerLng ?: return
    val position = latLngAltitude {
      latitude = lat
      longitude = lng
      altitude = 0.0
    }
    val existing = markerObj
    if (existing != null) {
      // Real, confirmed-via-decompiling-the-SDK fix: Marker's own Kotlin source declares
      // `position` as a read-only (val) property with setPosition() as a separate, unrelated
      // method -- not a property setter -- so `existing.position = position` doesn't compile
      // now that the compiler can read that real metadata (see getMap3DViewAsync's own comment
      // above for why this project's compiler only started seeing it now).
      existing.setPosition(position)
    } else {
      markerObj = map.addMarker(
        markerOptions {
          this.position = position
          altitudeMode = AltitudeMode.CLAMP_TO_GROUND
        }
      )
    }
  }

  private fun applyPolyline() {
    val map = googleMap3D ?: return
    val existing = polylineObj
    if (existing != null) {
      existing.path = routeCoordinates
    } else if (routeCoordinates.isNotEmpty()) {
      polylineObj = map.addPolyline(
        polylineOptions {
          // Real, confirmed-via-decompiling-the-SDK fix: PolylineOptions has no "coordinates"
          // property at all (only Polyline itself, the already-constructed object, has a
          // legacy getCoordinates()/setCoordinates() pair alongside path) -- "path" is this
          // builder's own real property, same name applyPolyline already uses on the existing-
          // polyline branch just above.
          path = routeCoordinates
          strokeColor = android.graphics.Color.parseColor("#2563EB")
          strokeWidth = 8.0
          altitudeMode = AltitudeMode.CLAMP_TO_GROUND
          geodesic = true
        }
      )
    }
  }

  // --- Prop setters, called from Map3DModule's View{} Prop blocks ---

  fun setCenter(lat: Double, lng: Double) {
    centerLat = lat
    centerLng = lng
    applyInitialCameraIfReady()
  }

  fun setMapMode(mode: String) {
    mapMode = if (mode == "SATELLITE") Map3DMode.SATELLITE else Map3DMode.HYBRID
    googleMap3D?.setMapMode(mapMode)
  }

  fun setMarkerPosition(lat: Double, lng: Double) {
    markerLat = lat
    markerLng = lng
    applyMarker()
  }

  fun setRouteCoordinates(points: List<Map<String, Double>>) {
    routeCoordinates = points.mapNotNull { point ->
      val lat = point["latitude"] ?: return@mapNotNull null
      val lng = point["longitude"] ?: return@mapNotNull null
      latLngAltitude {
        latitude = lat
        longitude = lng
        altitude = 0.0
      }
    }
    applyPolyline()
  }

  // --- Imperative joystick functions, called from Map3DModule's Function blocks ---

  fun rotateCamera(deltaDeg: Double) {
    val map = googleMap3D ?: return
    // getCamera() is nullable (GoogleMap3D's own Kotlin metadata, confirmed via decompiling
    // its real class file -- see the Kotlin 2.2 upgrade comment in getMap3DViewAsync above for
    // why this project's compiler only started seeing/enforcing its true nullability now).
    val current = map.getCamera() ?: return
    map.setCamera(
      camera {
        center = current.center
        // Real, confirmed-via-decompiling-the-SDK fix: Camera.heading/tilt/range are each
        // individually nullable java.lang.Double on the real play-services-maps3d API (only
        // visible now that this project's Kotlin compiler can actually read the SDK's own
        // Kotlin metadata -- see the getMap3DViewAsync comment above). Falling back to this
        // view's own last-known defaults (same fields setCamera's initial/explicit calls
        // already use) rather than crashing on a genuinely-absent value.
        heading = ((current.heading ?: this@ExpoMap3DView.heading) + deltaDeg + 360.0) % 360.0
        tilt = current.tilt ?: this@ExpoMap3DView.tilt
        range = current.range ?: this@ExpoMap3DView.range
      }
    )
  }

  fun tiltCamera(deltaDeg: Double) {
    val map = googleMap3D ?: return
    val current = map.getCamera() ?: return
    map.setCamera(
      camera {
        center = current.center
        heading = current.heading ?: this@ExpoMap3DView.heading
        tilt = ((current.tilt ?: this@ExpoMap3DView.tilt) + deltaDeg).coerceIn(0.0, 67.5)
        range = current.range ?: this@ExpoMap3DView.range
      }
    )
  }
}
