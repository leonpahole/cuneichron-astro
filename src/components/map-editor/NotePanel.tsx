import { useState } from "react";
import type { BulletEntry, Geometry } from "./types";

interface NotePanelProps {
  source: string;
  entries: BulletEntry[];
  selectedLine: number | null;
  copyMessage: string;
  onSourceChange: (source: string) => void;
  onCopy: () => void;
  onSelect: (entry: BulletEntry) => void;
}

export default function NotePanel({ source, entries, selectedLine, copyMessage, onSourceChange, onCopy, onSelect }: NotePanelProps) {
  const [activeTab, setActiveTab] = useState<"note" | "bullets">("note");

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-none border-b border-gray-200" role="tablist" aria-label="Map editor input">
        <button type="button" role="tab" aria-selected={activeTab === "note"} onClick={() => setActiveTab("note")} className={`border-b-2 px-4 py-2 text-sm font-semibold ${activeTab === "note" ? "border-blue-700 text-blue-800" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
          Note text
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "bullets"} onClick={() => setActiveTab("bullets")} className={`border-b-2 px-4 py-2 text-sm font-semibold ${activeTab === "bullets" ? "border-blue-700 text-blue-800" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
          Bullets ({entries.length})
        </button>
      </div>

      {activeTab === "note" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" role="tabpanel">
          <textarea
            id="map-note-source"
            aria-label="Note text"
            value={source}
            onChange={(event) => onSourceChange(event.target.value)}
            placeholder={`Paste a note or a section of one, for example:\n\n### First Samnite War\n\n- 343–341 BCE: Rome fought the Samnites.\n- 342 BCE: Plebeian reforms took place. \`geo:{"type":"Point","coordinates":[12.4964,41.9028]}\``}
            className="min-h-0 flex-1 resize-none overflow-y-auto rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm leading-6 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            spellCheck={false}
          />
          <div className="flex flex-none flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={onCopy} disabled={!source} className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
              Copy updated note
            </button>
            {copyMessage && <span aria-live="polite" className="text-sm text-gray-600">{copyMessage}</span>}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-500">Paste Markdown containing bullet points to begin.</p>
          ) : (
            <ul className="space-y-2 pr-1">
              {entries.map((entry) => {
                const isSelected = selectedLine === entry.lineIndex;
                const supported = entry.geometries.filter((geometry): geometry is Geometry => geometry !== null);
                const state = supported.length
                  ? `${supported.length} mapped shape${supported.length === 1 ? "" : "s"}${entry.unsupported ? " · some unsupported GeoJSON" : ""}`
                  : entry.unsupported ? entry.unsupported : "Unmapped";
                return (
                  <li key={entry.lineIndex}>
                    <button type="button" onClick={() => onSelect(entry)} className={`w-full rounded-lg border p-3 text-left transition ${isSelected ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-gray-200 bg-white hover:border-gray-400"}`}>
                      <span className="block text-xs font-semibold text-gray-500">{entry.date || `Line ${entry.lineIndex + 1}`}</span>
                      <span className="mt-1 block text-sm">{entry.text || "(empty bullet)"}</span>
                      {entry.people.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {entry.people.map((person, index) => <span key={`${person}-${index}`} className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-700">{person}</span>)}
                        </span>
                      )}
                      <span className={`mt-2 block text-xs ${supported.length ? "font-medium text-red-700" : entry.unsupported ? "text-amber-700" : "text-blue-700"}`}>{state}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
