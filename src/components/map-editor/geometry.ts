import type { BulletEntry, Coordinates, Geometry, PolygonCoordinates } from "./types";

const GEO_PATTERN = /`?geo:\s*(\{.*?\})`?/g;
const PERSON_PATTERN = /\[person\](.*?)\[\/person\]/gi;

const parseGeometry = (value: string): Geometry | null => {
  try {
    const geometry = JSON.parse(value) as { type?: string; coordinates?: unknown };
    if (geometry.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length === 2 && geometry.coordinates.every((coordinate) => typeof coordinate === "number")) {
      const [longitude, latitude] = geometry.coordinates as number[];
      return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
        ? { type: "Point", coordinates: [longitude, latitude] }
        : null;
    }
    if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) {
      const rings = geometry.coordinates as unknown[];
      const parsed = rings.map((ring) => Array.isArray(ring) && ring.every((coordinate) => Array.isArray(coordinate) && coordinate.length === 2 && coordinate.every((number) => typeof number === "number")) ? ring as Coordinates[] : null);
      return parsed.every((ring) => ring && ring.length >= 4) ? { type: "Polygon", coordinates: parsed as PolygonCoordinates } : null;
    }
    if (geometry.type === "LineString" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every((coordinate) => Array.isArray(coordinate) && coordinate.length === 2 && coordinate.every((number) => typeof number === "number"))) {
      return { type: "LineString", coordinates: geometry.coordinates as Coordinates[] };
    }
    return null;
  } catch {
    return null;
  }
};

export const parseBullets = (source: string): BulletEntry[] =>
  source.split(/\r?\n/).flatMap((line, lineIndex) => {
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (!bullet) return [];

    const body = bullet[1];
    const people = [...body.matchAll(PERSON_PATTERN)].map((match) => match[1]!.trim()).filter(Boolean);
    const geometries = [...body.matchAll(GEO_PATTERN)].map((match) => parseGeometry(match[1]!));
    const unsupported = geometries.some((geometry) => geometry === null) ? "Contains unsupported or invalid GeoJSON" : undefined;
    const withoutGeo = body.replace(GEO_PATTERN, "").replace(/\s+$/, "").trim();
    const separator = withoutGeo.indexOf(":");
    const date = separator > -1 ? withoutGeo.slice(0, separator).trim() : undefined;
    const taggedText = separator > -1 ? withoutGeo.slice(separator + 1).trim() : withoutGeo;
    const text = taggedText.replace(PERSON_PATTERN, "$1");
    return [{ lineIndex, date, text, people, geometries, unsupported }];
  });

const normalizeCoordinates = (coordinates: Coordinates[]): Coordinates[] =>
  coordinates.map(([longitude, latitude]) => [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))]);

const closeRing = (ring: Coordinates[]): Coordinates[] => {
  const normalized = normalizeCoordinates(ring);
  const first = normalized[0];
  const last = normalized.at(-1);
  if (first && (!last || first[0] !== last[0] || first[1] !== last[1])) normalized.push([...first]);
  return normalized;
};

export const writeGeometry = (source: string, lineIndex: number, geometryIndex: number | null, geometry: Geometry): string => {
  const lines = source.split(/\r?\n/);
  const line = lines[lineIndex];
  if (line == null) return source;

  const normalized = geometry.type === "Point"
    ? { ...geometry, coordinates: normalizeCoordinates([geometry.coordinates])[0] }
    : geometry.type === "Polygon"
      ? { ...geometry, coordinates: geometry.coordinates.map(closeRing) }
      : { ...geometry, coordinates: normalizeCoordinates(geometry.coordinates) };
  const geoCode = `\`geo:${JSON.stringify(normalized)}\``;
  const bullet = line.match(/^(\s*[-*+]\s+)(.*)$/);
  if (!bullet) return source;

  const body = bullet[2];
  const matches = [...body.matchAll(GEO_PATTERN)];
  let replacementIndex = 0;
  const updatedBody = geometryIndex != null && geometryIndex < matches.length
    ? body.replace(GEO_PATTERN, (match) => replacementIndex++ === geometryIndex ? geoCode : match)
    : `${body.trimEnd()} ${geoCode}`;
  lines[lineIndex] = `${bullet[1]}${updatedBody}`;
  return lines.join("\n");
};

export const removeGeometries = (source: string, lineIndex: number, geometryIndexes: number[]): string => {
  const lines = source.split(/\r?\n/);
  if (lines[lineIndex] == null) return source;
  const body = lines[lineIndex]!;
  const removals = new Set(geometryIndexes);
  let current = 0;
  lines[lineIndex] = body.replace(GEO_PATTERN, (match) => removals.has(current++) ? "" : match).replace(/\s+$/, "");
  return lines.join("\n");
};
