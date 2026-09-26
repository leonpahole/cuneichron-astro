import { getCollection } from "astro:content";
import {
  parseMarkdownIntoNote,
  type HistoricalDate,
  type Note,
  type NoteEvent,
} from "./note";
import periodsRaw from "./periods.json";

export type ExploreView = "topic" | "period" | "location";

export interface Bucket {
  name: string;
  notes: Note[];
}

interface PeriodRange {
  name: string;
  from: HistoricalDate;
  to: HistoricalDate;
}

interface PeriodDef {
  name: string;
  times: { from: HistoricalDate; to: HistoricalDate };
}

const periods: PeriodRange[] = (periodsRaw as PeriodDef[])
  .map((p) => ({
    name: p.name,
    from: p.times.from,
    to: p.times.to,
  }));

export const getNotes = async (): Promise<Note[]> => {
  const allNotes = await getCollection("notes");

  return allNotes
    .map((n) => parseMarkdownIntoNote(n.filePath, n.body, n.data.locations))
    .filter((n): n is Note => n != null);
};

export const groupNotes = (
  view: ExploreView,
  notes: Note[],
): Bucket[] => {
  switch (view) {
    case "topic":
      return groupByTopic(notes);
    case "period":
      return groupByPeriod(notes);
    case "location":
      return groupByLocation(notes);
  }
};

const groupByTopic = (notes: Note[]): Bucket[] => {
  return groupByLabel(notes, (n) => (n.topic ? [n.topic] : []));
};

const groupByPeriod = (notes: Note[]): Bucket[] => {
  const buckets = periods
    .map((period) => ({
      name: period.name,
      notes: sortNotesByFileName(
        notes.filter((n) => overlaps(period, noteSpan(n))),
      ),
    }))
    .filter((bucket) => bucket.notes.length > 0);

  return sortBucketsChronologically(buckets);
};

const groupByLocation = (notes: Note[]): Bucket[] => {
  return groupByLabel(
    notes,
    (n) => n.location.split(",").map((s) => s.trim()).filter(Boolean),
  );
};

const groupByLabel = (
  notes: Note[],
  labels: (n: Note) => string[],
): Bucket[] => {
  const bucketsByName = new Map<string, Note[]>();

  for (const note of notes) {
    for (const label of labels(note)) {
      if (!bucketsByName.has(label)) {
        bucketsByName.set(label, []);
      }
      bucketsByName.get(label)!.push(note);
    }
  }

  const buckets = [...bucketsByName.entries()].map(([name, bucketNotes]) => ({
    name,
    notes: sortNotesByFileName(bucketNotes),
  }));

  return sortBucketsChronologically(buckets);
};

// Notes within a bucket are ordered by their file name (e.g. "1_primates").
// Natural numeric collation keeps numbered prefixes grouped: 1_*, 2_*, 3_*,
// then unnumbered files in alphabetical order.
const sortNotesByFileName = (notes: Note[]): Note[] => {
  return [...notes].sort((a, b) =>
    a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
  );
};

const sortBucketsChronologically = (buckets: Bucket[]): Bucket[] => {
  return [...buckets].sort((a, b) => {
    const aStart = Math.min(...a.notes.map(earliestEventTime));
    const bStart = Math.min(...b.notes.map(earliestEventTime));
    return aStart - bStart;
  });
};

// A note's overall time span, in comparable chronological units
// (BCE dates become negative, CE dates positive).
const noteSpan = (note: Note): [number, number] => {
  if (note.events.length === 0) {
    return [Infinity, -Infinity];
  }

  let min = Infinity;
  let max = -Infinity;

  for (const event of note.events) {
    const points = eventTimePoints(event);
    min = Math.min(min, ...points);
    max = Math.max(max, ...points);
  }

  return [min, max];
};

const eventTimePoints = (event: NoteEvent): number[] => {
  if (event.time.type === "single") {
    return [historicalDateToNumber(event.time.date)];
  }

  return [
    historicalDateToNumber(event.time.from),
    historicalDateToNumber(event.time.to),
  ];
};

const earliestEventTime = (note: Note): number => noteSpan(note)[0];

const overlaps = (period: PeriodRange, note: [number, number]): boolean => {
  const periodStart = historicalDateToNumber(period.from);
  const periodEnd = historicalDateToNumber(period.to);
  const from = Math.min(periodStart, periodEnd);
  const to = Math.max(periodStart, periodEnd);

  return note[0] <= to && note[1] >= from;
};

const historicalDateToNumber = (date: HistoricalDate): number =>
  date.period === "BCE" ? -date.year : date.year;