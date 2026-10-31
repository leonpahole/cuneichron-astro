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
  timeline: TimelineSection[];
  gallery: GalleryImage[];
  people: Person[];
}

export interface Person {
  name: string;
  slug: string;
  description?: string;
}

export interface GalleryImage {
  src: string;
  alt: string;
  source?: { label: string; url: string };
}

export interface TimelineSection {
  title?: string;
  events: NoteEvent[];
  images: GalleryImage[];
  people?: Person[];
  dateRange?: [HistoricalDate, HistoricalDate];
}

export interface NoteEvent {
  description: string;
  time: NoteEventTime;
  location?: GeoJsonObject;
  people: Person[];
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
  season?: string;
}

export const parseMarkdownIntoNote = (
  filePath: string | undefined,
  mdString: string | undefined,
  location?: string,
): Note | null => {
  if (!filePath || !mdString) {
    return null;
  }

  const source = mdString.replace(/\[person\]([^\[]+?)\[\/person\]/gi, (_, name: string) => `[${name}](/person/${slugifyPerson(name)})`);
  const md = unified().use(remarkParse).parse(source);
  const heading1 = md.children.find(
    (n): n is Heading => n.type === "heading" && n.depth === 1,
  );
  if (!heading1) {
    return null;
  }

  const name = getTextNodeText(heading1);

  const topic = getTopicFromFilePath(filePath);
  const path = getPathFromFilePath(filePath);
  const timeline = getTimelineSections(md, path);
  const people = getPeople(md);

  return {
    location: location ?? "",
    name,
    path,
    fileName: getFileNameFromFilePath(filePath),
    descriptions: getDescriptions(md),
    topic,
    events: timeline.flatMap((section) => section.events),
    timeline,
    gallery: [...timeline.flatMap((section) => section.images), ...getGallery(md, path)],
    people,
  };
};

const getPeople = (md: Root): Person[] => {
  const people = new Map<string, Person>();
  for (const node of md.children) {
    for (const person of getTaggedPeople(node)) people.set(person.slug, person);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const peopleFromInlineTags = (text: string): Person[] => {
  const found: Person[] = [];
  for (const match of text.matchAll(/\[person\]([^\[]+?)\[\/person\]/gi)) {
    const name = match[1].trim();
    if (name) found.push(makePerson(name));
  }
  return found;
};

const getTaggedPeople = (node: object): Person[] => {
  if ((node as { type?: string }).type === "link") {
    const link = node as Link;
    const person = parsePersonLink(link.url, getTextNodeText(link));
    if (person) return [person];
  }
  return ((node as { children?: object[] }).children ?? []).flatMap(getTaggedPeople);
};

const parsePersonLink = (url: string, name: string): Person | null => {
  const match = url.match(/^\/person\/([^/]+)$/);
  return match ? { name, slug: match[1] } : null;
};

export const splitPersonLinks = (text: string) =>
  text.split(/(\[[^\]]+\]\(\/person\/[^)]+\))/g).map((part) => {
    const match = part.match(/^\[([^\]]+)\]\((\/person\/[^)]+)\)$/);
    return match ? { text: match[1], href: match[2] } : { text: part };
  });

export const makePerson = (name: string): Person => ({ name, slug: slugifyPerson(name) });
export const slugifyPerson = (name: string): string => name.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

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

const getTimelineSections = (md: Root, notePath: string): TimelineSection[] => {
  const timelineHeadingIndex = md.children.findIndex(
    (c) =>
      c.type === "heading" &&
      getTextNodeText(c).toLowerCase().includes("timeline"),
  );
  const startIndex = timelineHeadingIndex === -1
    ? md.children.findIndex((c) => c.type === "heading" && c.depth >= 3)
    : timelineHeadingIndex;
  if (startIndex === -1) return [];

  const sections: TimelineSection[] = [];
  let current: TimelineSection = { events: [], images: [] };
  sections.push(current);

  for (let i = startIndex + 1; i < md.children.length; i++) {
    const node = md.children[i];

    if (node.type === "heading") {
      // A depth-2 heading (e.g. `## Gallery`) ends the timeline.
      if (node.depth === 2) {
        break;
      }
      // A deeper heading starts a new timeline subsection.
      current = { title: getTextNodeText(node), events: [], images: [], people: getTaggedPeople(node) };
      sections.push(current);
      continue;
    }

    if (node.type === "list") {
      for (const item of node.children) {
        current.events.push(parseEvent(item, current.people ?? []));
      }
      continue;
    }

    if (node.type === "paragraph") {
      current.images.push(...getGalleryImagesFromNode(node, notePath));
    }

    // Ignore other nodes (loose text/paragraphs) within the timeline.
  }

  return sections
    .filter((section) => section.events.length > 0)
    .map((section) => ({ ...section, dateRange: getEventDateRange(section.events) }));
};

const getEventDateRange = (events: NoteEvent[]): [HistoricalDate, HistoricalDate] | undefined => {
  const dates = events.flatMap((event) => event.time.type === "single"
    ? [event.time.date]
    : [event.time.from, event.time.to]);
  if (dates.length === 0) return undefined;
  const sorted = [...dates].sort((a, b) => historicalDateToNumber(a) - historicalDateToNumber(b));
  return [sorted[0], sorted[sorted.length - 1]];
};

const parseEvent = (item: ListItem, sectionPeople: Person[] = []): NoteEvent => {
  const text = getListItemText(item);
  const [time, ...description] = text.split(":");
  const people = [...new Map([...sectionPeople, ...getTaggedPeople(item)].map((p) => [p.slug, p])).values()];

  return {
    description: description.join(":"),
    time: parseTimeString(time),
    location: getListItemLocation(item),
    people,
  };
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

  return listNote.children.flatMap((item) => getGalleryImagesFromNode(item, notePath));
};

const getGalleryImagesFromNode = (node: object, notePath: string): GalleryImage[] => {
  const images = findImages(node);
  const source = findSourceLink(node);
  return images.map((img) => ({
    src: resolveImageSrc(img.url, notePath),
    alt: img.alt || "",
    source: source ? { label: getTextNodeText(source) || "Source", url: source.url } : undefined,
  }));
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

  const months = "January|February|March|April|May|June|July|August|September|October|November|December";
  const monthNumber = (name: string) => new Date(`${name} 1, 2000`).getMonth() + 1;
  const monthRange = time.match(new RegExp(`^\\s*~?(${months})\\s*[–-]\\s*(${months})\\s+(\\d+)\\s*(BCE|CE)\\s*$`, "i"));
  if (monthRange) {
    const year = Number(monthRange[3]);
    return {
      type: "range",
      from: { year, period, isCirca, month: monthNumber(monthRange[1]) },
      to: { year, period, isCirca, month: monthNumber(monthRange[2]) },
    };
  }

  const namedDate = time.match(new RegExp(`^\\s*~?(?:(\\d{1,2})\\s+)?(${months})\\s+(\\d+)\\s*(BCE|CE)\\s*$`, "i"));
  if (namedDate) {
    return { type: "single", date: { year: Number(namedDate[3]), period, isCirca, month: monthNumber(namedDate[2]), day: namedDate[1] ? Number(namedDate[1]) : undefined } };
  }
  const seasonDate = time.match(/^\s*~?(Spring|Summer|Autumn|Fall|Winter)\s+(\d+)\s*(BCE|CE)\s*$/i);
  if (seasonDate) {
    const season = seasonDate[1][0].toUpperCase() + seasonDate[1].slice(1).toLowerCase();
    return { type: "single", date: { year: Number(seasonDate[2]), period, isCirca, season } };
  }

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

  if (type === "link") {
    const link = node as Link;
    const label = (link.children ?? []).map(getEventText).join("");
    const person = parsePersonLink(link.url, label);
    return person ? `[${label}](/person/${person.slug})` : label;
  }

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

  // Inline Markdown nodes already carry their own spacing in adjacent text
  // nodes. Adding spaces here separates punctuation after links and emphasis.
  return children.map(getEventText).join("");
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
  (date.period === "BCE" ? -date.year : date.year) + ((date.month ?? seasonMonth(date.season) ?? 1) - 1) / 12;

const seasonMonth = (season?: string): number | undefined => ({ Spring: 3, Summer: 6, Autumn: 9, Fall: 9, Winter: 12 } as Record<string, number>)[season ?? ""];

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

  if (time.from.year === time.to.year && (time.from.month || time.from.season) && (time.to.month || time.to.season)) {
    const circa = time.from.isCirca || time.to.isCirca ? "~" : "";
    return `${circa}${datePrefix(time.from).trimEnd()}–${datePrefix(time.to).trimEnd()} ${formatNumber(time.to.year)} ${time.to.period}`;
  }

  const from = historicalDateToString(time.from, "from");
  const to = historicalDateToString(time.to, "to");
  return `${from}–${to}`;
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
    return `${date.isCirca ? "~" : ""}${datePrefix(date)}${dateStr} ${period}`;
  }
  const suffix = type === "to" ? ` ${period}` : "";
  return `${date.isCirca ? "~" : ""}${datePrefix(date)}${dateStr}${suffix}`;
};

const datePrefix = (date: HistoricalDate): string => {
  const month = date.month ? new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, date.month - 1, 1))) : "";
  return date.season ? `${date.season} ` : date.day && month ? `${date.day} ${month} ` : month ? `${month} ` : "";
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
