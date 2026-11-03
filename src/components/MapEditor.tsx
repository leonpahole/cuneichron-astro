import { useMemo, useState } from "react";
import MapCanvas from "./map-editor/MapCanvas";
import NotePanel from "./map-editor/NotePanel";
import { parseBullets, removeGeometries, writeGeometry } from "./map-editor/geometry";
import type { BulletEntry, Geometry } from "./map-editor/types";

export default function MapEditor() {
  const [source, setSource] = useState("");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [placementLine, setPlacementLine] = useState<number | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const entries = useMemo(() => parseBullets(source), [source]);

  const handleSourceChange = (value: string) => {
    setSource(value);
    setCopyMessage("");
  };

  const handleGeometryChange = (lineIndex: number, geometryIndex: number | null, geometry: Geometry) => {
    setSource((current) => writeGeometry(current, lineIndex, geometryIndex, geometry));
    setSelectedLine(lineIndex);
    setPlacementLine(lineIndex);
    setCopyMessage("");
  };

  const selectEntry = (entry: BulletEntry) => {
    setSelectedLine(entry.lineIndex);
    setCopyMessage("");
    setPlacementLine(entry.lineIndex);
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
    <section className="flex h-full min-h-0 flex-col">
      <style>{`.leaflet-tooltip.map-editor-centered-tooltip { width: 240px; max-width: min(240px, calc(100vw - 32px)); white-space: normal; overflow-wrap: break-word; text-align: center; box-sizing: border-box; }`}</style>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3 lg:grid-cols-[minmax(22rem,0.75fr)_minmax(0,2.25fr)] lg:grid-rows-1">
        <NotePanel
          source={source}
          entries={entries}
          selectedLine={selectedLine}
          copyMessage={copyMessage}
          onSourceChange={handleSourceChange}
          onCopy={copyNotes}
          onSelect={selectEntry}
        />
        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-none flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Map</h2>
            <span className="text-sm text-gray-500">Coordinates use [longitude, latitude]</span>
          </div>
          <MapCanvas
            entries={entries}
            selectedLine={selectedLine}
            placementLine={placementLine}
            onSelect={(lineIndex) => {
              setSelectedLine(lineIndex);
              setPlacementLine(lineIndex);
            }}
            onChangeGeometry={handleGeometryChange}
            onRemoveGeometries={(lineIndex, geometryIndexes) => {
              setSource((current) => removeGeometries(current, lineIndex, geometryIndexes));
              setCopyMessage("");
            }}
          />
        </section>
      </div>
    </section>
  );
}
