export type Coordinates = [longitude: number, latitude: number];
export type PolygonCoordinates = Coordinates[][];
export type Geometry =
  | { type: "Point"; coordinates: Coordinates }
  | { type: "Polygon"; coordinates: PolygonCoordinates }
  | { type: "LineString"; coordinates: Coordinates[] };

export interface BulletEntry {
  lineIndex: number;
  date?: string;
  text: string;
  people: string[];
  geometries: (Geometry | null)[];
  unsupported?: string;
}
