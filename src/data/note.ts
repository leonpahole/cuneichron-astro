import { unified } from "unified";
import remarkParse from "remark-parse";
import type {
  BlockContent,
  Break,
  DefinitionContent,
  Delete,
  Emphasis,
  Heading,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  TableCell,
  TableRow,
} from "mdast";

export interface Note {
  location: string;
  period: string;
  name: string;
  path: string;
  description?: string;
  events: NoteEvent[];
}

interface NoteEvent {
  description: string;
  time: NoteEventTime;
}

type NoteEventTime =
  | {
      type: "range";
      from: HistoricalDate;
      to: HistoricalDate;
    }
  | {
      type: "single";
      date: HistoricalDate;
    };

interface HistoricalDate {
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

  const descriptionParagraph = md.children.find(
    (n): n is Paragraph => n.type === "paragraph",
  );
  const period = getPeriodFromFilePath(filePath);

  return {
    location: location ?? "",
    name,
    path: getPathFromFilePath(filePath),
    description: descriptionParagraph
      ? getTextNodeText(descriptionParagraph)
      : undefined,
    period,
    events: getEvents(md),
  };
};

const getPathFromFilePath = (filePath: string): string => {
  const [dir, file] = filePath.split("/").slice(-2);
  return [stripLeadingNumber(dir), stripLeadingNumber(stripMarkdownExt(file))]
    .filter(Boolean)
    .join("/");
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
    };
  });
};

const parseTimeString = (time: string): NoteEventTime => {
  const period = time.includes("BCE") ? "BCE" : "CE";
  const isCirca = time.includes("~");

  const range = time.replaceAll("~", "").replaceAll("BCE", "").split("-");

  if (range.length === 1) {
    return {
      type: "single",
      date: {
        year: parseStringToNumber(range[0]),
        period,
        isCirca,
      },
    };
  } else {
    return {
      type: "range",
      from: {
        year: parseStringToNumber(range[0]),
        period,
        isCirca,
      },
      to: {
        year: parseStringToNumber(range[1]),
        period,
        isCirca,
      },
    };
  }
};

const parseStringToNumber = (str: string): number => {
  const num = parseFloat(str.replace(",", ""));
  if (str.includes("billion")) {
    return num * Math.pow(10, 9);
  } else if (str.includes("million")) {
    return num * Math.pow(10, 6);
  }

  return num;
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
  return i.children.map((c) => getTextNodeText(c)).join(" ");
};

const getPeriodFromFilePath = (filePath: string): string => {
  const pathArr = filePath.split("/");
  const periodName = pathArr[pathArr.length - 2].split("_")[1];
  return unslug(periodName);
};

function capitalizeFirstLetter(val: string) {
  return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

const unslug = (slug: string) =>
  slug.split("-").map(capitalizeFirstLetter).join(" ");

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
