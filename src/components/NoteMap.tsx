import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { historicalDateToNumber, noteEventTimeToString, splitNoteLinks, type Location, type NoteEvent } from "../data/note";

interface PopupNavigation {
  previousIndex?: number;
  nextIndex?: number;
  onNavigate: (eventIndex: number) => void;
}

interface Props {
  events: NoteEvent[];
  eventHeadings?: (string | undefined)[];
  places?: Location[];
  showLocations?: boolean;
  containerClassName?: string;
  mapClassName?: string;
  showTitle?: boolean;
  baseLayer?: "regular" | "satellite";
  showLayerControl?: boolean;
  showSubchapterLegend?: boolean;
}

const POPUP_STYLE = `
  <style>
    .note-map-popup { font-family: var(--font-sans, sans-serif); }
    .note-map-popup .heading { font-weight: 700; margin: 0 0 0.25rem; }
    .note-map-popup .time { font-weight: 700; }
    .note-map-popup-navigation { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.6rem; padding-top: 0.35rem; border-top: 1px solid #d1d5db; }
    .note-map-popup-navigation button { cursor: pointer; text-decoration: underline; }
    .note-map-popup-navigation button:disabled { cursor: default; opacity: 0.4; text-decoration: none; }
  </style>
`;

const createEventPopup = (event: NoteEvent, heading: string | undefined, navigation?: PopupNavigation) => {
  const popup = document.createElement("div");
  popup.className = "note-map-popup";
  popup.innerHTML = POPUP_STYLE;

  if (heading) {
    const title = document.createElement("h3");
    title.className = "heading";
    title.textContent = heading;
    popup.append(title);
  }

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = noteEventTimeToString(event.time);
  popup.append(time, document.createTextNode(": "));

  for (const part of splitNoteLinks(event.description)) {
    if (part.href) {
      const link = document.createElement("a");
      link.href = part.href;
      link.textContent = part.text;
      link.className = "underline";
      popup.append(link);
    } else {
      popup.append(document.createTextNode(part.text));
    }
  }

  if (navigation) {
    const controls = document.createElement("div");
    controls.className = "note-map-popup-navigation";
    for (const [label, eventIndex] of [["← Previous", navigation.previousIndex], ["Next →", navigation.nextIndex]] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = eventIndex == null;
      button.setAttribute("aria-label", label.replace(/[←→]/g, "").trim() + " mapped event in chronology");
      button.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        if (eventIndex != null) navigation.onNavigate(eventIndex);
      });
      controls.append(button);
    }
    popup.append(controls);
  }

  return popup;
};

export default function NoteMap({ events, eventHeadings = [], places = [], showLocations = true, containerClassName = "mt-4", mapClassName = "h-96 w-full rounded-md border border-gray-300", showTitle = true, baseLayer = "regular", showLayerControl = false, showSubchapterLegend = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const locatedEvents = events.filter((event) => event.location || event.locations.some((location) => location.coordinates || location.geojson));
  const mappedPlaces = showLocations ? places.filter((place) => place.coordinates || place.geojson) : [];

  useEffect(() => {
    const container = containerRef.current;
    if (!container || (locatedEvents.length === 0 && mappedPlaces.length === 0)) {
      return;
    }

    // Give Leaflet a loaded view before adding GeoJSON paths, so its SVG
    // renderer has bounds ready when it projects the event geometries.
    const map = L.map(container, { scrollWheelZoom: true }).setView([41.9, 12.5], 6);
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);
    requestAnimationFrame(() => map.invalidateSize());

    const regular = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    const imagery = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    });
    const labels = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: 'Labels &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, FAO, NOAA, USGS, EPA, and NPS',
    });
    const satellite = L.layerGroup([imagery, labels]);
    (baseLayer === "satellite" ? satellite : regular).addTo(map);
    if (showLayerControl) {
      L.control.layers({ Satellite: satellite, Regular: regular }).addTo(map);
    }

    const subchapterForEvent = (eventIndex: number) => eventHeadings[eventIndex] ?? "Other events";
    const subchapters = [...new Set(events.map((_, eventIndex) => subchapterForEvent(eventIndex)))];
    const subchapterColors = new Map(subchapters.map((heading, index) => [
      heading,
      `hsl(${Math.round((index * 137.508) % 360)} 72% 44%)`,
    ]));
    const subchapterLayers = new Map(subchapters.map((heading) => [heading, L.layerGroup().addTo(map)]));
    const legendCheckboxes = new Map<string, HTMLInputElement>();
    const initialParams = new URLSearchParams(window.location.search);
    const requestedChapters = initialParams.getAll("chapter");
    const chaptersWereSpecified = requestedChapters.length > 0;
    const requestedAllNone = requestedChapters.includes("none");
    let refreshEventPopupContent = () => {};

    const writeMapQuery = (updates: (params: URLSearchParams) => void) => {
      const url = new URL(window.location.href);
      updates(url.searchParams);
      window.history.replaceState(window.history.state, "", url);
    };

    if (showSubchapterLegend && subchapters.length > 0) {
      const legend = L.control({ position: "bottomright" });
      legend.onAdd = () => {
        const container = L.DomUtil.create("div", "map-subchapter-legend leaflet-control");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "map-subchapter-legend-toggle";
        toggle.textContent = "Subchapters +";
        toggle.setAttribute("aria-expanded", "false");
        container.append(toggle);

        const content = document.createElement("div");
        content.className = "map-subchapter-legend-content";
        content.hidden = true;
        container.append(content);

        toggle.addEventListener("click", () => {
          content.hidden = !content.hidden;
          toggle.textContent = content.hidden ? "Subchapters +" : "Subchapters −";
          toggle.setAttribute("aria-expanded", String(!content.hidden));
        });

        const actions = document.createElement("div");
        actions.className = "map-subchapter-legend-actions";
        content.append(actions);

        const setSubchaptersVisible = (visible: boolean) => {
          for (const heading of subchapters) {
            const layer = subchapterLayers.get(heading);
            const checkbox = legendCheckboxes.get(heading);
            if (visible) layer?.addTo(map);
            else if (layer) map.removeLayer(layer);
            if (checkbox) checkbox.checked = visible;
          }
          refreshEventPopupContent();
          notifySubchapterSelection();
        };

        for (const [label, visible] of [["Select all", true], ["Select none", false]] as const) {
          const action = document.createElement("button");
          action.type = "button";
          action.textContent = label;
          action.addEventListener("click", () => setSubchaptersVisible(visible));
          actions.append(action);
        }

        const list = document.createElement("ul");
        list.className = "map-subchapter-legend-list";
        content.append(list);

        for (const heading of subchapters) {
          const item = document.createElement("li");
          const label = document.createElement("label");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = requestedAllNone
            ? false
            : !chaptersWereSpecified || requestedChapters.includes(heading);
          if (!checkbox.checked) subchapterLayers.get(heading)?.remove();
          checkbox.addEventListener("change", () => {
            const layer = subchapterLayers.get(heading);
            if (checkbox.checked) layer?.addTo(map);
            else if (layer) map.removeLayer(layer);
            refreshEventPopupContent();
            notifySubchapterSelection();
          });
          legendCheckboxes.set(heading, checkbox);

          const swatch = document.createElement("span");
          swatch.className = "map-subchapter-legend-swatch";
          swatch.style.backgroundColor = subchapterColors.get(heading) ?? "#64748b";
          const name = document.createElement("span");
          name.textContent = heading;
          label.append(checkbox, swatch, name);
          item.append(label);
          list.append(item);
        }

        return container;
      };
      legend.addTo(map);
    }

    const notifySubchapterSelection = () => {
      const headings = subchapters.filter((heading) => legendCheckboxes.get(heading)?.checked);
      writeMapQuery((params) => {
        params.delete("chapter");
        if (headings.length === 0) params.append("chapter", "none");
        else if (headings.length < subchapters.length) headings.forEach((heading) => params.append("chapter", heading));
      });
      window.dispatchEvent(new CustomEvent("map-subchapters-selected", { detail: { headings } }));
    };

    const bounds = L.latLngBounds([]);
    const eventBounds: L.LatLngBounds[] = [];
    const eventLayers: L.GeoJSON[] = [];
    const eventVisibleByRange = events.map(() => true);
    const eventDateRanges = events.map((event) => {
      const start = event.time.type === "single" ? event.time.date : event.time.from;
      const end = event.time.type === "single" ? event.time.date : event.time.to;
      return [historicalDateToNumber(start), historicalDateToNumber(end)] as const;
    });
    let focusMapEvent: (eventIndex: number) => void = () => {};

    const chronologicalEventIndices = events
      .map((event, eventIndex) => ({ event, eventIndex }))
      .filter(({ event }) => event.location != null)
      .sort((a, b) => {
        const aDate = a.event.time.type === "single" ? a.event.time.date : a.event.time.from;
        const bDate = b.event.time.type === "single" ? b.event.time.date : b.event.time.from;
        return historicalDateToNumber(aDate) - historicalDateToNumber(bDate) || a.eventIndex - b.eventIndex;
      })
      .map(({ eventIndex }) => eventIndex);

    const getVisibleNeighbor = (eventIndex: number, direction: -1 | 1) => {
      const currentPosition = chronologicalEventIndices.indexOf(eventIndex);
      for (let position = currentPosition + direction; position >= 0 && position < chronologicalEventIndices.length; position += direction) {
        const candidateIndex = chronologicalEventIndices[position];
        const candidateLayer = subchapterLayers.get(subchapterForEvent(candidateIndex));
        if (eventVisibleByRange[candidateIndex] && candidateLayer && map.hasLayer(candidateLayer)) return candidateIndex;
      }
      return undefined;
    };

    const createNavigablePopup = (eventIndex: number) => createEventPopup(
      events[eventIndex],
      eventHeadings[eventIndex],
      {
        previousIndex: getVisibleNeighbor(eventIndex, -1),
        nextIndex: getVisibleNeighbor(eventIndex, 1),
        onNavigate: (nextEventIndex) => focusMapEvent(nextEventIndex),
      },
    );

    refreshEventPopupContent = () => {
      eventLayers.forEach((layer, eventIndex) => layer.setPopupContent(createNavigablePopup(eventIndex)));
    };

    const notifyNoteForMapEvent = (eventIndex: number) => {
      window.dispatchEvent(new CustomEvent("note-map-event-selected", { detail: { eventIndex } }));
    };
    const clearNoteForMapEvent = (eventIndex: number) => {
      window.dispatchEvent(new CustomEvent("note-map-event-deselected", { detail: { eventIndex } }));
    };

    events.forEach((event, eventIndex) => {
      const focusedBounds = L.latLngBounds([]);
      eventBounds[eventIndex] = focusedBounds;
      const subchapter = subchapterForEvent(eventIndex);
      const color = subchapterColors.get(subchapter) ?? "#dc2626";
      const subchapterLayer = subchapterLayers.get(subchapter) ?? map;
      if (event.location) {
        const layer = L.geoJSON(event.location, {
          pointToLayer: (_, latlng) => L.circleMarker(latlng, {
            radius: 8,
            color: "#ffffff",
            fillColor: color,
            fillOpacity: 1,
            weight: 2,
          }),
          style: { color, fillColor: color, fillOpacity: 0.25, weight: 3 },
        });
        layer.bindPopup(createNavigablePopup(eventIndex), { autoPan: false });
        layer.on("popupopen", () => notifyNoteForMapEvent(eventIndex));
        layer.on("popupclose", () => clearNoteForMapEvent(eventIndex));
        layer.addTo(subchapterLayer);
        eventLayers[eventIndex] = layer;
        const layerBounds = layer.getBounds();
        if (layerBounds.isValid()) {
          bounds.extend(layerBounds);
          focusedBounds.extend(layerBounds);
        }
      }

      if (showLocations) event.locations.forEach((location) => {
        if (location.geojson) {
          const locationBounds = L.geoJSON(location.geojson).getBounds();
          if (locationBounds.isValid()) {
            bounds.extend(locationBounds);
            focusedBounds.extend(locationBounds);
          }
        }
        if (location.coordinates) {
          const [longitude, latitude] = location.coordinates;
          const point = L.latLng(latitude, longitude);
          bounds.extend(point);
          focusedBounds.extend(point);
          if (mappedPlaces.some((place) => place.coordinates?.[0] === longitude && place.coordinates?.[1] === latitude)) return;
          const marker = L.circleMarker(point, {
            radius: 7,
            color,
            fillColor: color,
            fillOpacity: 0.85,
            weight: 2,
          });
          marker.bindPopup(`${POPUP_STYLE}<div class="note-map-popup"><strong>${location.name}</strong><br/><span class="time">${noteEventTimeToString(event.time)}</span>: ${event.description}</div>`);
          marker.addTo(subchapterLayer);
        }
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

    eventLayers.forEach((layer) => layer.bringToFront());

    const savedLat = initialParams.get("lat");
    const savedLng = initialParams.get("lng");
    const savedZoom = initialParams.get("zoom");
    const queryLat = savedLat == null ? NaN : Number(savedLat);
    const queryLng = savedLng == null ? NaN : Number(savedLng);
    const queryZoom = savedZoom == null ? NaN : Number(savedZoom);
    if (Number.isFinite(queryLat) && Number.isFinite(queryLng) && Number.isFinite(queryZoom) && queryZoom >= 0 && queryZoom <= 19) {
      map.setView([queryLat, queryLng], queryZoom);
    } else if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.25));
    } else {
      map.setView([41.9, 12.5], 6);
    }

    focusMapEvent = (eventIndex: number) => {
      const eventBoundsForIndex = eventBounds[eventIndex];
      if (!Number.isInteger(eventIndex) || !eventBoundsForIndex?.isValid()) return;

      const subchapter = subchapterForEvent(eventIndex);
      const subchapterLayer = subchapterLayers.get(subchapter);
      if (subchapterLayer && !map.hasLayer(subchapterLayer)) {
        subchapterLayer.addTo(map);
        const checkbox = legendCheckboxes.get(subchapter);
        if (checkbox) checkbox.checked = true;
        refreshEventPopupContent();
      }

      map.panTo(eventBoundsForIndex.getCenter(), { animate: true });
      eventLayers[eventIndex]?.openPopup();
    };
    const handleFocusMapEvent = (event: Event) => {
      const eventIndex = Number((event as CustomEvent<{ eventIndex?: number }>).detail?.eventIndex);
      focusMapEvent(eventIndex);
    };
    window.addEventListener("note-map-focus-event", handleFocusMapEvent);

    const handleTimelineFilter = (event: Event) => {
      const detail = (event as CustomEvent<{ from?: number; to?: number }>).detail;
      const from = Number(detail?.from);
      const to = Number(detail?.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;

      events.forEach((_, eventIndex) => {
        const [eventStart, eventEnd] = eventDateRanges[eventIndex];
        const visible = eventStart <= to && eventEnd >= from;
        eventVisibleByRange[eventIndex] = visible;
        const layer = eventLayers[eventIndex];
        const group = subchapterLayers.get(subchapterForEvent(eventIndex));
        if (!layer || !group) return;
        if (visible) group.addLayer(layer);
        else group.removeLayer(layer);
      });
      refreshEventPopupContent();
    };
    window.addEventListener("map-timeline-filter", handleTimelineFilter);

    map.on("moveend", () => {
      const center = map.getCenter();
      writeMapQuery((params) => {
        params.set("lat", center.lat.toFixed(5));
        params.set("lng", center.lng.toFixed(5));
        params.set("zoom", String(map.getZoom()));
      });
    });
    window.dispatchEvent(new Event("note-map-ready"));

    const mountedMap = map;
    return () => {
      window.removeEventListener("note-map-focus-event", handleFocusMapEvent);
      window.removeEventListener("map-timeline-filter", handleTimelineFilter);
      resizeObserver.disconnect();
      mountedMap.remove();
      if (mapRef.current === mountedMap) {
        mapRef.current = null;
      }
    };
  }, [locatedEvents, mappedPlaces, eventHeadings, baseLayer, showLayerControl, showSubchapterLegend, showLocations]);

  if (locatedEvents.length === 0 && mappedPlaces.length === 0) {
    return null;
  }

  return (
    <section className={containerClassName}>
      {showTitle && <h3 className="text-2xl font-bold mb-2">Map</h3>}

      <div
        ref={containerRef}
        className={mapClassName}
      />
    </section>
  );
}
