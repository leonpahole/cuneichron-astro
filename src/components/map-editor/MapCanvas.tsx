import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet-draw";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { BulletEntry, Coordinates, Geometry } from "./types";

interface MapCanvasProps {
  entries: BulletEntry[];
  selectedLine: number | null;
  placementLine: number | null;
  onSelect: (lineIndex: number) => void;
  onChangeGeometry: (lineIndex: number, geometryIndex: number | null, geometry: Geometry) => void;
  onRemoveGeometries: (lineIndex: number, geometryIndexes: number[]) => void;
}

export default function MapCanvas({ entries, selectedLine, placementLine, onSelect, onChangeGeometry, onRemoveGeometries }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.FeatureGroup | null>(null);
  const callbacksRef = useRef({ onSelect, onChangeGeometry, onRemoveGeometries });
  const placementRef = useRef<number | null>(placementLine);
  callbacksRef.current = { onSelect, onChangeGeometry, onRemoveGeometries };
  placementRef.current = placementLine;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView([41.9, 12.5], 4);
    mapRef.current = map;
    const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    const imagery = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    });
    const placeLabels = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: 'Labels &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, FAO, NOAA, USGS, EPA, and NPS',
    });
    const satellite = L.layerGroup([imagery, placeLabels]);
    satellite.addTo(map);
    L.control.layers({ Satellite: satellite, Regular: streets }, undefined, { position: "topright" }).addTo(map);
    const layers = L.featureGroup().addTo(map);
    layersRef.current = layers;
    const resize = () => map.invalidateSize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(resize);
    return () => {
      window.removeEventListener("resize", resize);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();
    const selectedLayers: L.Layer[] = [];

    entries.forEach((entry) => {
      const isSelected = selectedLine === entry.lineIndex;
      entry.geometries.forEach((geometry, geometryIndex) => {
        if (!geometry) return;
        let feature: L.Layer;
        if (geometry.type === "Point") {
          feature = L.marker([geometry.coordinates[1], geometry.coordinates[0]], {
            icon: L.divIcon({
              className: "map-editor-marker-icon",
              html: `<span style="display:block;width:18px;height:18px;border:2px solid white;border-radius:50%;background:${isSelected ? "#1d4ed8" : "#b91c1c"};box-shadow:0 1px 5px #0008"></span>`,
              iconSize: [18, 18],
              iconAnchor: [9, 9],
            }),
          });
        } else if (geometry.type === "Polygon") {
          feature = L.polygon(geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)), {
            color: isSelected ? "#1d4ed8" : "#b91c1c",
            fillColor: isSelected ? "#3b82f6" : "#ef4444",
            fillOpacity: 0.2,
            weight: 2,
          });
        } else {
          feature = L.polyline(geometry.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngTuple), { color: isSelected ? "#1d4ed8" : "#b91c1c", weight: 3 });
        }

        (feature as L.Layer & { __geoGeometryIndex?: number }).__geoGeometryIndex = geometryIndex;
        const tooltipContent = document.createElement("div");
        tooltipContent.textContent = `${entry.date ? `${entry.date}: ` : ""}${entry.text}`;
        const tooltipAnchor = feature instanceof L.Marker
          ? feature.getLatLng()
          : L.latLng(feature.getBounds().getNorth(), feature.getBounds().getCenter().lng);
        const tooltipOptions: L.TooltipOptions = { direction: "top", offset: [0, -8], className: "map-editor-centered-tooltip" };
        const tooltip = L.tooltip(tooltipOptions).setContent(tooltipContent);
        feature.on("mouseover", () => map.openTooltip(tooltip, tooltipAnchor));
        feature.on("mouseout", () => map.closeTooltip(tooltip));
        feature.on("click", () => {
          map.closeTooltip(tooltip);
          callbacksRef.current.onSelect(entry.lineIndex);
        });
        layers.addLayer(feature);
        if (isSelected) selectedLayers.push(feature);
      });
    });

    let drawControl: L.Control.Draw | null = null;
    let editableGroup: L.FeatureGroup | null = null;
    if (placementLine != null) {
      const editable = L.featureGroup();
      editableGroup = editable;
      selectedLayers.forEach((layer) => {
        layers.removeLayer(layer);
        editable.addLayer(layer);
      });
      editable.addTo(map);
      drawControl = new L.Control.Draw({
        position: "topleft",
        draw: { marker: {}, polygon: {}, rectangle: {}, polyline: {}, circle: {}, circlemarker: {} },
        edit: { featureGroup: editable, remove: true },
      });
      map.addControl(drawControl);
      map.on(L.Draw.Event.CREATED, (event: L.DrawEvents.Created) => {
        const lineIndex = placementRef.current;
        if (lineIndex == null) return;
        const created = event.layer;
        if ((event.layerType === "marker" || event.layerType === "circlemarker") && (created instanceof L.Marker || created instanceof L.CircleMarker)) {
          const point = created.getLatLng();
          callbacksRef.current.onChangeGeometry(lineIndex, null, { type: "Point", coordinates: [point.lng, point.lat] });
        } else if ((event.layerType === "polygon" || event.layerType === "rectangle") && created instanceof L.Polygon) {
          const rings = created.getLatLngs() as L.LatLng[][];
          callbacksRef.current.onChangeGeometry(lineIndex, null, { type: "Polygon", coordinates: rings.map((ring) => ring.map((point) => [point.lng, point.lat] as Coordinates)) });
        } else if (event.layerType === "polyline" && created instanceof L.Polyline) {
          const points = created.getLatLngs() as L.LatLng[];
          callbacksRef.current.onChangeGeometry(lineIndex, null, { type: "LineString", coordinates: points.map((point) => [point.lng, point.lat]) });
        } else if (event.layerType === "circle" && created instanceof L.Circle) {
          callbacksRef.current.onChangeGeometry(lineIndex, null, { type: "Polygon", coordinates: [circleRing(created)] });
        }
      });
      map.on(L.Draw.Event.EDITED, (event: L.DrawEvents.Edited) => {
        const lineIndex = placementRef.current;
        if (lineIndex == null) return;
        event.layers.eachLayer((layer) => {
          const geometryIndex = (layer as L.Layer & { __geoGeometryIndex?: number }).__geoGeometryIndex;
          if (geometryIndex == null) return;
          if (layer instanceof L.Marker) {
            const point = layer.getLatLng();
            callbacksRef.current.onChangeGeometry(lineIndex, geometryIndex, { type: "Point", coordinates: [point.lng, point.lat] });
          } else if (layer instanceof L.Polygon) {
            const rings = layer.getLatLngs() as L.LatLng[][];
            callbacksRef.current.onChangeGeometry(lineIndex, geometryIndex, { type: "Polygon", coordinates: rings.map((ring) => ring.map((point) => [point.lng, point.lat] as Coordinates)) });
          } else if (layer instanceof L.Polyline) {
            const points = layer.getLatLngs() as L.LatLng[];
            callbacksRef.current.onChangeGeometry(lineIndex, geometryIndex, { type: "LineString", coordinates: points.map((point) => [point.lng, point.lat]) });
          }
        });
      });
      map.on(L.Draw.Event.DELETED, (event: L.DrawEvents.Deleted) => {
        const lineIndex = placementRef.current;
        if (lineIndex == null) return;
        const indexes: number[] = [];
        event.layers.eachLayer((layer) => {
          const index = (layer as L.Layer & { __geoGeometryIndex?: number }).__geoGeometryIndex;
          if (index != null) indexes.push(index);
        });
        callbacksRef.current.onRemoveGeometries(lineIndex, indexes);
      });
    }

    return () => {
      if (drawControl) map.removeControl(drawControl);
      if (editableGroup) map.removeLayer(editableGroup);
      map.off(L.Draw.Event.CREATED);
      map.off(L.Draw.Event.EDITED);
      map.off(L.Draw.Event.DELETED);
    };
  }, [entries, selectedLine, placementLine]);

  const fitMarkers = () => {
    const bounds = L.latLngBounds(entries.flatMap((entry) => entry.geometries.flatMap((geometry) => {
      if (!geometry) return [];
      if (geometry.type === "Point") return [[geometry.coordinates[1], geometry.coordinates[0]] as L.LatLngTuple];
      if (geometry.type === "Polygon") return geometry.coordinates.flatMap((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple));
      return geometry.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
    })));
    if (bounds.isValid()) mapRef.current?.fitBounds(bounds.pad(0.2), { maxZoom: 8 });
  };

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-300">
      <div ref={containerRef} className="h-full w-full" />
      <button type="button" onClick={fitMarkers} className="absolute bottom-8 left-3 z-[500] rounded bg-white px-3 py-2 text-sm font-semibold shadow hover:bg-gray-100">
        Fit markers
      </button>
    </div>
  );
}

function circleRing(circle: L.Circle): Coordinates[] {
  const center = circle.getLatLng();
  const angularRadius = circle.getRadius() / 6378137;
  const lat1 = center.lat * Math.PI / 180;
  const lon1 = center.lng * Math.PI / 180;
  return Array.from({ length: 64 }, (_, index) => {
    const bearing = (index / 64) * Math.PI * 2;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularRadius) + Math.cos(lat1) * Math.sin(angularRadius) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(lat1), Math.cos(angularRadius) - Math.sin(lat1) * Math.sin(lat2));
    return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
  });
}
