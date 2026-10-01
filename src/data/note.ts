import { unified } from "unified";
import remarkParse from "remark-parse";
import type { GeoJsonObject } from "geojson";
import type {
  BlockContent,
  Break,
  DefinitionContent,
  Delete,
  Emphasis,
  Heading,
  Image,
  ListItem,
  Link,
  Paragraph,
  PhrasingContent,
  Root,
  TableCell,
  TableRow,
} from "mdast";

export interface Note {
  location: string;
  topic: string;
  name: string;
  path: string;
  fileName: string;
  descriptions: string[];
  events: NoteEvent[];
  gallery: GalleryImage[];
}

export interface GalleryImage {
  src: string;
  alt: string;
  source?: { label: string; url: string };
}

export interface NoteEvent {
  description: string;
  time: NoteEventTime;
  location?: GeoJsonObject;
}

export type NoteEventTime =
  | {
      type: "range";
      from: HistoricalDate;
      to: HistoricalDate;
    }
  | {
      type: "single";
      date: HistoricalDate;
    };

export interface HistoricalDate {
  period: "BCE" | "CE";
  isCirca: boolean;
  year: number;
  month?: number;
  day?: number;
}

export const parseMarkdownIntoNote = (
  filePath: string | undefined,
  mdString: string | undefined,
  location?: string,
): Note | null => {
  if (!filePath || !mdString) {
    return null;
  }

  const md = unified().use(remarkParse).parse(mdString);
  const heading1 = md.children.find(
    (n): n is Heading => n.type === "heading" && n.depth === 1,
  );
  if (!heading1) {
    return null;
  }

  const name = getTextNodeText(heading1);

  const topic = getTopicFromFilePath(filePath);
  const path = getPathFromFilePath(filePath);

  return {
    location: location ?? "",
    name,
    path,
    fileName: getFileNameFromFilePath(filePath),
    descriptions: getDescriptions(md),
    topic,
    events: getEvents(md),
    gallery: getGallery(md, path),
  };
};

const getPathFromFilePath = (filePath: string): string => {
  const [dir, file] = filePath.split("/").slice(-2);
  return [stripLeadingNumber(dir), stripLeadingNumber(stripMarkdownExt(file))]
    .filter(Boolean)
    .join("/");
};

const getFileNameFromFilePath = (filePath: string): string => {
  const file = filePath.split("/").pop() ?? "";
  return stripMarkdownExt(file);
};

// All body paragraphs that come before the first section heading
// (Timeline / Gallery). Timeline and gallery content are lists, so every
// top-level paragraph here belongs to the note's prose body.
const getDescriptions = (md: Root): string[] => {
  const sectionStart = md.children.findIndex(
    (c) =>
      c.type === "heading" &&
      /timeline|gallery/i.test(getTextNodeText(c)),
  );
  const end = sectionStart === -1 ? md.children.length : sectionStart;

  return md.children
    .slice(0, end)
    .filter((n): n is Paragraph => n.type === "paragraph")
    .map(getTextNodeText);
};

const stripLeadingNumber = (str: string): string => str.replace(/^\d+_/, "");

const stripMarkdownExt = (str: string): string => str.replace(/\.md$/, "");

const getEvents = (md: Root): NoteEvent[] => {
  const timelineHeadingIndex = md.children.findIndex(
    (c) =>
      c.type === "heading" &&
      getTextNodeText(c).toLowerCase().includes("timeline"),
  );

  const listNote = md.children[timelineHeadingIndex + 1];
  if (listNote.type !== "list") {
    return [];
  }

  return listNote.children.map((c) => {
    const text = getListItemText(c);
    const [time, ...description] = text.split(":");

    return {
      description: description.join(":"),
      time: parseTimeString(time),
      location: getListItemLocation(c),
    };
  });
};

const getGallery = (md: Root, notePath: string): GalleryImage[] => {
  const galleryHeadingIndex = md.children.findIndex(
    (c) =>
      c.type === "heading" &&
      getTextNodeText(c).toLowerCase().includes("gallery"),
  );
  if (galleryHeadingIndex === -1) {
    return [];
  }

  const listNote = md.children[galleryHeadingIndex + 1];
  if (!listNote || listNote.type !== "list") {
    return [];
  }

  return listNote.children.flatMap((item) => {
    const images = findImages(item);
    const source = findSourceLink(item);
    return images.map((img) => ({
      src: resolveImageSrc(img.url, notePath),
      alt: img.alt || "",
      source: source
        ? { label: getTextNodeText(source) || "Source", url: source.url }
        : undefined,
    }));
  });
};

const findImages = (node: object): Image[] => {
  if ((node as { type?: string }).type === "image") {
    return [node as Image];
  }

  const children = (node as { children?: object[] }).children;
  if (!children) {
    return [];
  }

  return children.flatMap(findImages);
};

const findSourceLink = (node: object): Link | null => {
  if ((node as { type?: string }).type === "link") {
    return node as Link;
  }

  const children = (node as { children?: object[] }).children;
  if (!children) {
    return null;
  }

  for (const child of children) {
    const found = findSourceLink(child);
    if (found) {
      return found;
    }
  }

  return null;
};

const resolveImageSrc = (url: string, notePath: string): string => {
  // Root-relative and http(s) URLs are used as-is (root-relative paths are
  // served straight from the `public/` directory). Bare filenames are
  // resolved into the note's image folder as a fallback.
  if (url.startsWith("/") || /^https?:\/\//i.test(url)) {
    return url;
  }

  return `/images/notes/${notePath}/${url}`;
};

const parseTimeString = (time: string): NoteEventTime => {
  const period = time.includes("BCE") ? "BCE" : "CE";
  const isCirca = time.includes("~");

  // A unit such as "billion"/"million" applies to the whole value/range
  // (e.g. "~2.4–2.1 billion BCE"), so derive the scale once from the string.
  const scale = time.includes("billion")
    ? Math.pow(10, 9)
    : time.includes("million")
      ? Math.pow(10, 6)
      : 1;

  const cleaned = time
    .replaceAll("~", "")
    .replaceAll("BCE", "")
    .replace("billion", "")
    .replace("million", "")
    .replaceAll(",", "")
    .replace("–", "-");

  const [fromStr, toStr] = cleaned.split("-");

  if (!toStr) {
    return {
      type: "single",
      date: {
        year: parseStringToNumber(fromStr, scale),
        period,
        isCirca,
      },
    };
  } else {
    return {
      type: "range",
      from: {
        year: parseStringToNumber(fromStr, scale),
        period,
        isCirca,
      },
      to: {
        year: parseStringToNumber(toStr, scale),
        period,
        isCirca,
      },
    };
  }
};

const parseStringToNumber = (str: string, scale: number): number => {
  const num = parseFloat(str.replace(",", ""));
  return num * scale;
};

const getTextNodeText = (
  h:
    | BlockContent
    | DefinitionContent
    | PhrasingContent
    | ListItem
    | TableRow
    | TableCell,
): string => {
  if ("value" in h) {
    return h.value;
  }

  if (!("children" in h)) {
    return "";
  }

  return h.children
    .map((c) => getTextNodeText(c))
    .filter(Boolean)
    .join(" ");
};

const getListItemText = (i: ListItem) => {
  return i.children.map((c) => getEventText(c)).join(" ");
};

// Text content of a node, omitting `geo:` inline code spans (they contain the
// JSON location and are not part of the visible description).
const getEventText = (node: object): string => {
  const type = (node as { type?: string }).type;

  if (type === "inlineCode") {
    const value = (node as { value?: string }).value ?? "";
    return /^\s*geo\s*:/i.test(value) ? "" : value;
  }

  if ("value" in node) {
    return (node as { value: unknown }).value as string;
  }

  const children = (node as { children?: object[] }).children;
  if (!children) {
    return "";
  }

  return children.map(getEventText).filter(Boolean).join(" ");
};

// A bullet may carry an optional GeoJSON location as an inline code span such
// as `geo:{"type":"Point","coordinates":[resolved,lat]}`. The first one that
// parses is used.
const getListItemLocation = (item: object): GeoJsonObject | undefined => {
  for (const value of findGeoJsonCodeValues(item)) {
    const match = value.match(/^\s*geo\s*:\s*/i);
    if (!match) {
      continue;
    }

    try {
      return JSON.parse(value.slice(match[0].length)) as GeoJsonObject;
    } catch {
      continue;
    }
  }

  return undefined;
};

const findGeoJsonCodeValues = (node: object): string[] => {
  if ((node as { type?: string }).type === "inlineCode") {
    return [(node as { value?: string }).value ?? ""];
  }

  const children = (node as { children?: object[] }).children;
  if (!children) {
    return [];
  }

  return children.flatMap(findGeoJsonCodeValues);
};

const getTopicFromFilePath = (filePath: string): string => {
  const pathArr = filePath.split("/");
  const topicName = pathArr[pathArr.length - 2].split("_")[1];
  return unslug(topicName);
};

function capitalizeFirstLetter(val: string) {
  return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

const unslug = (slug: string) =>
  slug.split("-").map(capitalizeFirstLetter).join(" ");

export const historicalDateToNumber = (date: HistoricalDate): number =>
  date.period === "BCE" ? -date.year : date.year;

// A note's overall time span in comparable chronological units
// (BCE negative, CE positive). Notes without events return an empty span.
export const getNoteTimeSpan = (note: Note): [number, number] => {
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

export const sortNotesByFileName = (notes: Note[]): Note[] => {
  return [...notes].sort((a, b) =>
    a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
  );
};

export const noteEventTimeToString = (time: NoteEventTime): string => {
  if (time.type === "single") {
    return historicalDateToString(time.date, "single");
  }

  return `${historicalDateToString(time.from, "from")}-${historicalDateToString(time.to, "to")}`;
};

const historicalDateToString = (
  date: HistoricalDate,
  type: "single" | "from" | "to",
): string => {
  const dateStr = formatNumber(date.year);

  let period: string = date.period;
  if (period === "BCE" && date.year >= Math.pow(10, 6)) {
    period = "years ago";
  }

  if (type === "single") {
    return `${date.isCirca ? "~" : ""}${dateStr} ${period}`;
  } else if (type === "from") {
    return `${date.isCirca ? "~" : ""}${dateStr}`;
  } else {
    return `${dateStr} ${period}`;
  }
};

const formatNumber = (n: number) => {
  if (Math.abs(n) >= 1_000_000_000) {
    return `${n / 1_000_000_000} billion`;
  }

  if (Math.abs(n) >= 1_000_000) {
    return `${n / 1_000_000} million`;
  }

  return new Intl.NumberFormat().format(n);
};
