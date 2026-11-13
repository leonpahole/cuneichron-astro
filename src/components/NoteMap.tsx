import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { noteEventTimeToString, type Location, type NoteEvent } from "../data/note";

interface Props {
  events: NoteEvent[];
  places?: Location[];
}

const POPUP_STYLE = `
  <style>
    .note-map-popup { font-family: var(--font-sans, sans-serif); }
    .note-map-popup .time { font-weight: 700; }
  </style>
`;

export default function NoteMap({ events, places = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const locatedEvents = events.filter((event) => event.location || event.locations.some((location) => location.coordinates));
  const mappedPlaces = places.filter((place) => place.coordinates || place.geojson);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || (locatedEvents.length === 0 && mappedPlaces.length === 0)) {
      return;
    }

    const map = L.map(container, { scrollWheelZoom: true });
    mapRef.current = map;

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const bounds = L.latLngBounds([]);

    locatedEvents.forEach((event) => {
      if (event.location) {
        const layer = L.geoJSON(event.location, {
          pointToLayer: (_, latlng) => L.circleMarker(latlng, {
            radius: 6,
            color: "#b91c1c",
            fillColor: "#b91c1c",
            fillOpacity: 0.8,
            weight: 1,
          }),
        });
        layer.bindPopup(`${POPUP_STYLE}<div class="note-map-popup"><span class="time">${noteEventTimeToString(event.time)}</span>: ${event.description}</div>`);
        layer.addTo(map);
        const layerBounds = layer.getBounds();
        if (layerBounds.isValid()) bounds.extend(layerBounds);
      }

      event.locations.forEach((location) => {
        if (!location.coordinates) return;
        const [longitude, latitude] = location.coordinates;
        if (mappedPlaces.some((place) => place.coordinates?.[0] === longitude && place.coordinates?.[1] === latitude)) return;
        const marker = L.circleMarker([latitude, longitude], {
          radius: 7,
          color: "#1d4ed8",
          fillColor: "#3b82f6",
          fillOpacity: 0.85,
          weight: 2,
        });
        marker.bindPopup(`${POPUP_STYLE}<div class="note-map-popup"><strong>${location.name}</strong><br/><span class="time">${noteEventTimeToString(event.time)}</span>: ${event.description}</div>`);
        marker.addTo(map);
        bounds.extend(marker.getLatLng());
      });
    });

    mappedPlaces.forEach((place) => {
      if (place.geojson) {
        const layer = L.geoJSON(place.geojson, {
          pointToLayer: (_, latlng) => L.circleMarker(latlng, {
            radius: 7,
            color: "#1d4ed8",
            fillColor: "#3b82f6",
            fillOpacity: 0.85,
            weight: 2,
          }),
          style: { color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.25, weight: 2 },
        });
        const popup = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = place.name;
        popup.append(name);
        if (place.description) {
          const description = document.createElement("p");
          description.textContent = place.description;
          popup.append(description);
        }
        layer.bindPopup(popup).addTo(map);
        const layerBounds = layer.getBounds();
        if (layerBounds.isValid()) bounds.extend(layerBounds);
      }
      if (!place.coordinates) return;
      const [longitude, latitude] = place.coordinates;
      const marker = L.circleMarker([latitude, longitude], {
        radius: 7,
        color: "#1d4ed8",
        fillColor: "#3b82f6",
        fillOpacity: 0.85,
        weight: 2,
      });
      const popup = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = place.name;
      popup.append(name);
      if (place.description) {
        const description = document.createElement("p");
        description.textContent = place.description;
        popup.append(description);
      }
      marker.bindPopup(popup).addTo(map);
      bounds.extend(marker.getLatLng());
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
  }, [locatedEvents, mappedPlaces]);

  if (locatedEvents.length === 0 && mappedPlaces.length === 0) {
    return null;
  }

  return (
    <section className="mt-4">
      <h3 className="text-2xl font-bold mb-2">Map</h3>

      <div
        ref={containerRef}
        className="h-96 w-full rounded-md border border-gray-300"
      />
    </section>
  );
}
