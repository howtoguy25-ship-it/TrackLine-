package expo.modules.map3d

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class Map3DModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Map3D")

    View(ExpoMap3DView::class) {
      Events("onStatusChange")

      Prop("center") { view, center: Map<String, Double> ->
        val lat = center["latitude"] ?: return@Prop
        val lng = center["longitude"] ?: return@Prop
        view.setCenter(lat, lng)
      }

      Prop("mapMode") { view, mode: String? ->
        view.setMapMode(mode ?: "HYBRID")
      }

      Prop("markerPosition") { view, position: Map<String, Double>? ->
        val lat = position?.get("latitude") ?: return@Prop
        val lng = position["longitude"] ?: return@Prop
        view.setMarkerPosition(lat, lng)
      }

      Prop("routeCoordinates") { view, points: List<Map<String, Double>>? ->
        view.setRouteCoordinates(points ?: emptyList())
      }

      // Real, confirmed-via-reproduction Kotlin 2.2 regression (same upgrade as
      // ExpoMap3DView.kt's own getMap3DViewAsync fix above): the K2 compiler now reports
      // "cannot be called in this context with an implicit receiver" for this reified
      // Function(name, body) overload -- it's really a member of the OUTER ModuleDefinition{}
      // block's own receiver (ModuleDefinitionBuilder, via its ObjectDefinitionBuilder base),
      // not View{}'s own ViewDefinitionBuilder (confirmed: that type has no Function member at
      // all, only AsyncFunction). The labelled `this@ModuleDefinition` receiver resolves it
      // explicitly instead of relying on (now-rejected) implicit cross-scope lookup.
      this@ModuleDefinition.Function("rotateCamera") { view: ExpoMap3DView, deltaDeg: Double ->
        view.rotateCamera(deltaDeg)
      }

      this@ModuleDefinition.Function("tiltCamera") { view: ExpoMap3DView, deltaDeg: Double ->
        view.tiltCamera(deltaDeg)
      }
    }
  }
}
