import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { noteEventTimeToString, type NoteEvent } from "../data/note";

interface Props {
  events: NoteEvent[];
}

const POPUP_STYLE = `
  <style>
    .note-map-popup { font-family: var(--font-sans, sans-serif); }
    .note-map-popup .time { font-weight: 700; }
  </style>
`;

export default function NoteMap({ events }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const locatedEvents = events.filter((event) => event.location);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || locatedEvents.length === 0) {
      return;
    }

    const map = L.map(container, { scrollWheelZoom: false });
    mapRef.current = map;

    const bounds = L.latLngBounds([]);

    locatedEvents.forEach((event) => {
      const layer = L.geoJSON(event.location as L.GeoJSONObject, {
        pointToLayer: (_, latlng) =>
          L.circleMarker(latlng, {
            radius: 6,
            color: "#b91c1c",
            fillColor: "#b91c1c",
            fillOpacity: 0.8,
            weight: 1,
          }),
      });

      layer.bindPopup(
        `${POPUP_STYLE}<div class="note-map-popup"><span class="time">${noteEventTimeToString(event.time)}</span>: ${event.description}</div>`,
      );
      layer.addTo(map);

      const layerBounds = layer.getBounds();
      if (layerBounds.isValid()) {
        bounds.extend(layerBounds);
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.25));
    } else {
      map.setView([41.9, 12.5], 6);
    }

    const mountedMap = map;
    return () => {
      mountedMap.remove();
      if (mapRef.current === mountedMap) {
        mapRef.current = null;
      }
    };
  }, [locatedEvents]);

  if (locatedEvents.length === 0) {
    return null;
  }

  return (
    <section class="mt-4">
      <h3 class="text-lg font-bold mb-2">Map</h3>

      <div
        ref={containerRef}
        class="h-96 w-full rounded-md border border-gray-300"
      />
    </section>
  );
}