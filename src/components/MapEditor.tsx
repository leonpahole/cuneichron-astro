import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Coordinates = [longitude: number, latitude: number];

interface BulletEntry {
  lineIndex: number;
  date?: string;
  text: string;
  point?: Coordinates;
  unsupported?: string;
}

interface MapCanvasProps {
  entries: BulletEntry[];
  selectedLine: number | null;
  placementLine: number | null;
  onSelect: (lineIndex: number) => void;
  onPlace: (lineIndex: number, point: Coordinates) => void;
  onMove: (lineIndex: number, point: Coordinates) => void;
}

const GEO_PATTERN = /`?geo:\s*(\{.*?\})`?/;

const parseBullets = (source: string): BulletEntry[] =>
  source.split(/\r?\n/).flatMap((line, lineIndex) => {
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (!bullet) return [];

    const body = bullet[1];
    const geoMatch = body.match(GEO_PATTERN);
    let point: Coordinates | undefined;
    let unsupported: string | undefined;

    if (geoMatch) {
      try {
        const geometry = JSON.parse(geoMatch[1]) as {
          type?: string;
          coordinates?: unknown;
        };
        if (
          geometry.type === "Point" &&
          Array.isArray(geometry.coordinates) &&
          geometry.coordinates.length === 2 &&
          geometry.coordinates.every((coordinate) => typeof coordinate === "number")
        ) {
          const [longitude, latitude] = geometry.coordinates as number[];
          if (longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90) {
            point = [longitude, latitude];
          } else {
            unsupported = "Point coordinates are outside valid ranges";
          }
        } else {
          unsupported = geometry.type
            ? `${geometry.type} geometry is not supported yet`
            : "Unknown geometry";
        }
      } catch {
        unsupported = "Invalid geo JSON";
      }
    }

    const withoutGeo = body.replace(GEO_PATTERN, "").replace(/\s+$/, "").trim();
    const separator = withoutGeo.indexOf(":");
    const date = separator > -1 ? withoutGeo.slice(0, separator).trim() : undefined;
    const text = separator > -1 ? withoutGeo.slice(separator + 1).trim() : withoutGeo;

    return [{ lineIndex, date, text, point, unsupported }];
  });

const writePoint = (source: string, lineIndex: number, point: Coordinates): string => {
  const lines = source.split(/\r?\n/);
  const line = lines[lineIndex];
  if (line == null) return source;

  const normalized: Coordinates = [
    Number(point[0].toFixed(6)),
    Number(point[1].toFixed(6)),
  ];
  const geoCode = `\`geo:${JSON.stringify({ type: "Point", coordinates: normalized })}\``;
  const bullet = line.match(/^(\s*[-*+]\s+)(.*)$/);
  if (!bullet) return source;

  const body = bullet[2];
  const updatedBody = GEO_PATTERN.test(body)
    ? body.replace(GEO_PATTERN, geoCode)
    : `${body.trimEnd()} ${geoCode}`;
  lines[lineIndex] = `${bullet[1]}${updatedBody}`;
  return lines.join("\n");
};

const displayCoordinates = (point: Coordinates) =>
  `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;

function MapCanvas({
  entries,
  selectedLine,
  placementLine,
  onSelect,
  onPlace,
  onMove,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const callbacksRef = useRef({ onSelect, onPlace, onMove });
  const placementRef = useRef<number | null>(placementLine);

  callbacksRef.current = { onSelect, onPlace, onMove };
  placementRef.current = placementLine;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(
      [41.9, 12.5],
      4,
    );
    mapRef.current = map;

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const markers = L.layerGroup().addTo(map);
    markersRef.current = markers;
    map.on("click", (event: L.LeafletMouseEvent) => {
      const lineIndex = placementRef.current;
      if (lineIndex != null) {
        callbacksRef.current.onPlace(lineIndex, [event.latlng.lng, event.latlng.lat]);
      }
    });

    const resize = () => map.invalidateSize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(resize);

    return () => {
      window.removeEventListener("resize", resize);
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    if (!map || !markers) return;

    markers.clearLayers();
    for (const entry of entries) {
      if (!entry.point) continue;
      const [longitude, latitude] = entry.point;
      const isSelected = selectedLine === entry.lineIndex;
      const marker = L.marker([latitude, longitude], {
        draggable: true,
        icon: L.divIcon({
          className: "map-editor-marker-icon",
          html: `<span style="display:block;width:18px;height:18px;border:2px solid white;border-radius:50%;background:${isSelected ? "#1d4ed8" : "#b91c1c"};box-shadow:0 1px 5px #0008"></span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        bubblingMouseEvents: false,
      });

      const tooltip = document.createElement("div");
      tooltip.textContent = `${entry.date ? `${entry.date}: ` : ""}${entry.text}`;
      marker.bindTooltip(tooltip, { direction: "top", offset: [0, -8] });
      marker.on("click", () => callbacksRef.current.onSelect(entry.lineIndex));
      marker.on("dragend", () => {
        const position = marker.getLatLng();
        callbacksRef.current.onMove(entry.lineIndex, [position.lng, position.lat]);
      });
      markers.addLayer(marker);
    }
  }, [entries, selectedLine]);

  const fitMarkers = () => {
    const bounds = L.latLngBounds(
      entries
        .filter((entry) => entry.point)
        .map((entry) => [entry.point![1], entry.point![0]] as L.LatLngTuple),
    );
    if (bounds.isValid()) mapRef.current?.fitBounds(bounds.pad(0.2), { maxZoom: 8 });
  };

  return (
    <div className="relative h-[65vh] min-h-[420px] overflow-hidden rounded-lg border border-gray-300">
      <div ref={containerRef} className="h-full w-full" />
      <button
        type="button"
        onClick={fitMarkers}
        className="absolute right-3 top-3 z-[500] rounded bg-white px-3 py-2 text-sm font-semibold shadow hover:bg-gray-100"
      >
        Fit markers
      </button>
      {placementLine != null && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[500] -translate-x-1/2 rounded bg-white/95 px-4 py-2 text-sm shadow">
          Click the map to place the selected marker
        </div>
      )}
    </div>
  );
}

export default function MapEditor() {
  const [source, setSource] = useState("");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [placementLine, setPlacementLine] = useState<number | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const entries = useMemo(() => parseBullets(source), [source]);
  const points = entries.filter((entry) => entry.point).length;
  const placeable = entries.filter((entry) => !entry.point && !entry.unsupported).length;
  const unsupported = entries.filter((entry) => entry.unsupported).length;

  const updatePoint = (lineIndex: number, point: Coordinates) => {
    setSource((current) => writePoint(current, lineIndex, point));
    setSelectedLine(lineIndex);
    setPlacementLine(null);
    setCopyMessage("");
  };

  const selectEntry = (entry: BulletEntry) => {
    setSelectedLine(entry.lineIndex);
    setCopyMessage("");
    setPlacementLine(entry.point || entry.unsupported ? null : entry.lineIndex);
  };

  const copyNotes = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopyMessage("Updated note copied to clipboard.");
    } catch {
      setCopyMessage("Clipboard access failed. Select and copy the note text manually.");
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Map editor</h1>
        <p className="max-w-4xl">
          Paste note text below. Existing Point coordinates become draggable markers.
          Select a bullet without a marker, then click the map to place one. Dragging
          or placing a marker updates the pasted text with a GeoJSON Point.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
          <span>{points} point markers</span>
          <span>{placeable} bullets without markers</span>
          {unsupported > 0 && <span>{unsupported} unsupported geometries preserved</span>}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.6fr)]">
        <section className="flex min-h-[65vh] flex-col gap-3">
          <label htmlFor="map-note-source" className="font-semibold">
            Note text
          </label>
          <textarea
            id="map-note-source"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setCopyMessage("");
            }}
            placeholder={`Paste a note or a section of one, for example:\n\n### First Samnite War\n\n- 343–341 BCE: Rome fought the Samnites.\n- 342 BCE: Plebeian reforms took place. \`geo:{"type":"Point","coordinates":[12.4964,41.9028]}\``}
            className="min-h-64 flex-1 resize-y rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm leading-6 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            spellCheck={false}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={copyNotes}
              disabled={!source}
              className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Copy updated note
            </button>
            {copyMessage && <span aria-live="polite" className="text-sm text-gray-600">{copyMessage}</span>}
          </div>

          <section className="min-h-0 flex-1 space-y-2">
            <h2 className="font-semibold">Bullets ({entries.length})</h2>
            {entries.length === 0 ? (
              <p className="text-sm text-gray-500">Paste Markdown containing bullet points to begin.</p>
            ) : (
              <ul className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                {entries.map((entry) => {
                  const isSelected = selectedLine === entry.lineIndex;
                  const state = entry.point
                    ? `Point · ${displayCoordinates(entry.point)}`
                    : entry.unsupported
                      ? entry.unsupported
                      : "Click to place a point";
                  return (
                    <li key={entry.lineIndex}>
                      <button
                        type="button"
                        onClick={() => selectEntry(entry)}
                        disabled={Boolean(entry.unsupported)}
                        className={`w-full rounded-lg border p-3 text-left transition ${isSelected ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-gray-200 bg-white hover:border-gray-400"} disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <span className="block text-xs font-semibold text-gray-500">
                          {entry.date || `Line ${entry.lineIndex + 1}`}
                        </span>
                        <span className="mt-1 block text-sm">{entry.text || "(empty bullet)"}</span>
                        <span className={`mt-2 block text-xs ${entry.point ? "font-medium text-red-700" : entry.unsupported ? "text-amber-700" : "text-blue-700"}`}>
                          {state}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Map</h2>
            <span className="text-sm text-gray-500">Coordinates use [longitude, latitude]</span>
          </div>
          <MapCanvas
            entries={entries}
            selectedLine={selectedLine}
            placementLine={placementLine}
            onSelect={(lineIndex) => {
              setSelectedLine(lineIndex);
              setPlacementLine(null);
            }}
            onPlace={updatePoint}
            onMove={updatePoint}
          />
        </section>
      </div>
    </section>
  );
}
