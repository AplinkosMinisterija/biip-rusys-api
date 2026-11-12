export interface FormImportRow {
  species?: number;
  quantity?: number;
  observedAt?: string;
  observedBy?: string;
  x?: number;
  y?: number;
  geometry?: string;
  description?: string;
  method?: string;
  source?: number;
  photos?: { url: string; name?: string; size?: number }[];
}

export interface FormImportTaxonomy {
  speciesId: number;
  speciesType?: string;
  formType?: string;
}

export const LKS_BOUNDS = {
  minX: 200000,
  maxX: 700000,
  minY: 5950000,
  maxY: 6300000,
};

export const FormImportErrors = {
  NO_SPECIES: 'IMPORT_NO_SPECIES',
  UNKNOWN_SPECIES: 'IMPORT_UNKNOWN_SPECIES',
  BAD_QUANTITY: 'IMPORT_BAD_QUANTITY',
  NO_DATE: 'IMPORT_NO_DATE',
  BAD_DATE: 'IMPORT_BAD_DATE',
  FUTURE_DATE: 'IMPORT_FUTURE_DATE',
  NO_OBSERVER: 'IMPORT_NO_OBSERVER',
  NO_COORDINATES: 'IMPORT_NO_COORDINATES',
  BAD_COORDINATES: 'IMPORT_BAD_COORDINATES',
  BAD_GEOMETRY: 'IMPORT_BAD_GEOMETRY',
  BAD_METHOD: 'IMPORT_BAD_METHOD',
  BAD_SOURCE: 'IMPORT_BAD_SOURCE',
  UNKNOWN_SOURCE: 'IMPORT_UNKNOWN_SOURCE',
  CREATE_FAILED: 'IMPORT_CREATE_FAILED',
};

const isBlank = (value: unknown) =>
  value === undefined || value === null || String(value).trim() === '';

type Position = [number, number];

type GeometryPart =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] };

type ImportGeometry =
  | GeometryPart
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

const MULTI_TYPES = {
  Point: 'MultiPoint',
  LineString: 'MultiLineString',
  Polygon: 'MultiPolygon',
};

const isPosition = (value: any) =>
  Array.isArray(value) &&
  value.length >= 2 &&
  value.length <= 4 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n));

const toPosition = (value: any): Position => [value[0], value[1]];

const toLine = (value: any): Position[] | null =>
  Array.isArray(value) && value.length >= 2 && value.every(isPosition)
    ? value.map(toPosition)
    : null;

const toRing = (value: any): Position[] | null => {
  const ring = toLine(value);
  if (!ring || ring.length < 4) return null;
  const [first, last] = [ring[0], ring[ring.length - 1]];
  return first[0] === last[0] && first[1] === last[1] ? ring : null;
};

const toPolygon = (value: any): Position[][] | null => {
  if (!Array.isArray(value) || !value.length) return null;
  const rings = value.map(toRing);
  return rings.every(Boolean) ? (rings as Position[][]) : null;
};

const allOrNull = <T>(items: (T | null)[]): T[] | null =>
  items.length && items.every((item) => item !== null) ? (items as T[]) : null;

const partsOf = (value: any): any[] | null => (Array.isArray(value) && value.length ? value : null);

function normalizeGeometry(geometry: any): GeometryPart[] | null {
  const coordinates = geometry?.coordinates;

  switch (geometry?.type) {
    case 'Point':
      return isPosition(coordinates)
        ? [{ type: 'Point', coordinates: toPosition(coordinates) }]
        : null;
    case 'MultiPoint':
      return allOrNull(
        (partsOf(coordinates) || []).map((part) =>
          normalizeGeometry({ type: 'Point', coordinates: part }),
        ),
      )?.flat();
    case 'LineString': {
      const line = toLine(coordinates);
      return line ? [{ type: 'LineString', coordinates: line }] : null;
    }
    case 'MultiLineString':
      return allOrNull(
        (partsOf(coordinates) || []).map((part) =>
          normalizeGeometry({ type: 'LineString', coordinates: part }),
        ),
      )?.flat();
    case 'Polygon': {
      const polygon = toPolygon(coordinates);
      return polygon ? [{ type: 'Polygon', coordinates: polygon }] : null;
    }
    case 'MultiPolygon':
      return allOrNull(
        (partsOf(coordinates) || []).map((part) =>
          normalizeGeometry({ type: 'Polygon', coordinates: part }),
        ),
      )?.flat();
    case 'GeometryCollection':
      return allOrNull((partsOf(geometry.geometries) || []).map(normalizeGeometry))?.flat();
    case 'Feature':
      return normalizeGeometry(geometry.geometry);
    case 'FeatureCollection':
      return allOrNull((partsOf(geometry.features) || []).map(normalizeGeometry))?.flat();
    default:
      return null;
  }
}

const WKT_TYPES: Record<string, string> = {
  POINT: 'Point',
  MULTIPOINT: 'MultiPoint',
  LINESTRING: 'LineString',
  MULTILINESTRING: 'MultiLineString',
  POLYGON: 'Polygon',
  MULTIPOLYGON: 'MultiPolygon',
};

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const WKT_POSITION = new RegExp(`(${NUMBER})\\s+(${NUMBER})(?:\\s+${NUMBER}){0,2}`, 'g');

function wktToGeoJson(wkt: string) {
  const match = wkt
    .trim()
    .replace(/^SRID=\d+;/i, '')
    .match(/^([A-Z]+)\s*(?:ZM|Z|M)?\s*(\(.*\))$/is);
  const type = match && WKT_TYPES[match[1].toUpperCase()];
  if (!type) return null;

  const json = match[2]
    .replace(WKT_POSITION, (_, x, y) => `[${Number(x)},${Number(y)}]`)
    .replace(/\(/g, '[')
    .replace(/\)/g, ']');

  try {
    const parsed = JSON.parse(json);
    if (type === 'Point') return { type, coordinates: parsed[0] };
    if (type === 'MultiPoint') {
      return {
        type,
        coordinates: parsed.map((part: any) => (isPosition(part) ? part : part?.[0])),
      };
    }
    return { type, coordinates: parsed };
  } catch {
    return null;
  }
}

function combineParts(parts: GeometryPart[] | null): ImportGeometry | null {
  if (!parts?.length) return null;
  if (parts.length === 1) return parts[0];

  const type = parts[0].type;
  if (!parts.every((part) => part.type === type)) return null;

  return {
    type: MULTI_TYPES[type],
    coordinates: parts.map((part) => part.coordinates),
  } as ImportGeometry;
}

function parseParts(value: string): GeometryPart[] | null {
  if (!value.startsWith('{')) return normalizeGeometry(wktToGeoJson(value));

  try {
    return normalizeGeometry(JSON.parse(value));
  } catch {
    return null;
  }
}

export function parseGeometry(text: string): ImportGeometry | null {
  return combineParts(parseParts(text.trim()));
}

function getRowGeometry(row: FormImportRow): ImportGeometry | null | undefined {
  if (!isBlank(row.geometry)) return parseGeometry(String(row.geometry));
  if (isBlank(row.x) || isBlank(row.y)) return undefined;

  return { type: 'Point', coordinates: [Number(row.x), Number(row.y)] };
}

const geometryPoints = (coordinates: any): Position[] =>
  isPosition(coordinates) ? [coordinates] : coordinates.flatMap(geometryPoints);

const isInsideLithuania = ([x, y]: Position) =>
  x >= LKS_BOUNDS.minX && x <= LKS_BOUNDS.maxX && y >= LKS_BOUNDS.minY && y <= LKS_BOUNDS.maxY;

export function validateFormImportRow(
  row: FormImportRow,
  taxonomy: FormImportTaxonomy | undefined,
  now: Date = new Date(),
  sources?: Set<number>,
): string[] {
  const errors: string[] = [];

  if (isBlank(row.species)) {
    errors.push(FormImportErrors.NO_SPECIES);
  } else if (!taxonomy) {
    errors.push(FormImportErrors.UNKNOWN_SPECIES);
  }

  if (!isBlank(row.quantity)) {
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      errors.push(FormImportErrors.BAD_QUANTITY);
    }
  }

  if (isBlank(row.observedAt)) {
    errors.push(FormImportErrors.NO_DATE);
  } else {
    const observedAt = new Date(row.observedAt);
    if (Number.isNaN(observedAt.getTime())) {
      errors.push(FormImportErrors.BAD_DATE);
    } else if (observedAt.getTime() > now.getTime()) {
      errors.push(FormImportErrors.FUTURE_DATE);
    }
  }

  if (isBlank(row.observedBy)) {
    errors.push(FormImportErrors.NO_OBSERVER);
  }

  const geometry = getRowGeometry(row);
  if (geometry === undefined) {
    errors.push(FormImportErrors.NO_COORDINATES);
  } else if (geometry === null) {
    errors.push(FormImportErrors.BAD_GEOMETRY);
  } else if (!geometryPoints(geometry.coordinates).every(isInsideLithuania)) {
    errors.push(FormImportErrors.BAD_COORDINATES);
  }

  if (!isBlank(row.source)) {
    const source = Number(row.source);
    if (!Number.isInteger(source) || source <= 0) {
      errors.push(FormImportErrors.BAD_SOURCE);
    } else if (sources && !sources.has(source)) {
      errors.push(FormImportErrors.UNKNOWN_SOURCE);
    }
  }

  return errors;
}

export function formImportRowToParams(row: FormImportRow) {
  const geometry = getRowGeometry(row);
  const isArea = geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';

  return {
    species: Number(row.species),
    ...(!isBlank(row.quantity) && { quantity: Number(row.quantity) }),
    observedAt: row.observedAt,
    observedBy: String(row.observedBy).trim(),
    ...(!isBlank(row.description) && { description: String(row.description) }),
    ...(!isBlank(row.method) && { method: String(row.method).trim() }),
    ...(!isBlank(row.source) && { source: Number(row.source) }),
    photos: row.photos || [],
    geom: {
      type: 'FeatureCollection',
      features: geometry
        ? [{ type: 'Feature', geometry, properties: isArea ? {} : { bufferSize: 1 } }]
        : [],
    },
  };
}
