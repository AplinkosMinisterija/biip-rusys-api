const INVASIVE_SPECIES_TYPE = 'INVASIVE';

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
  NO_PHOTOS: 'IMPORT_NO_PHOTOS',
  BAD_METHOD: 'IMPORT_BAD_METHOD',
  CREATE_FAILED: 'IMPORT_CREATE_FAILED',
};

const isBlank = (value: unknown) =>
  value === undefined || value === null || String(value).trim() === '';

type Position = [number, number];

type ImportGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] };

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

function normalizeGeometry(geometry: any): ImportGeometry[] | null {
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

export function parseGeometry(text: string): ImportGeometry[] | null {
  const value = text.trim();
  if (!value.startsWith('{')) return normalizeGeometry(wktToGeoJson(value));

  try {
    return normalizeGeometry(JSON.parse(value));
  } catch {
    return null;
  }
}

function getRowGeometries(row: FormImportRow): ImportGeometry[] | null | undefined {
  if (!isBlank(row.geometry)) return parseGeometry(String(row.geometry));
  if (isBlank(row.x) || isBlank(row.y)) return undefined;

  return [{ type: 'Point', coordinates: [Number(row.x), Number(row.y)] }];
}

const geometryPoints = (geometry: ImportGeometry): Position[] => {
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString') return geometry.coordinates;
  return geometry.coordinates.flat();
};

const isInsideLithuania = ([x, y]: Position) =>
  x >= LKS_BOUNDS.minX && x <= LKS_BOUNDS.maxX && y >= LKS_BOUNDS.minY && y <= LKS_BOUNDS.maxY;

export function validateFormImportRow(
  row: FormImportRow,
  taxonomy: FormImportTaxonomy | undefined,
  now: Date = new Date(),
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

  const geometries = getRowGeometries(row);
  if (geometries === undefined) {
    errors.push(FormImportErrors.NO_COORDINATES);
  } else if (geometries === null) {
    errors.push(FormImportErrors.BAD_GEOMETRY);
  } else if (!geometries.every((geometry) => geometryPoints(geometry).every(isInsideLithuania))) {
    errors.push(FormImportErrors.BAD_COORDINATES);
  }

  if (taxonomy?.speciesType === INVASIVE_SPECIES_TYPE && !row.photos?.length) {
    errors.push(FormImportErrors.NO_PHOTOS);
  }

  return errors;
}

export function formImportRowToParams(row: FormImportRow, source?: number) {
  return {
    species: Number(row.species),
    ...(!isBlank(row.quantity) && { quantity: Number(row.quantity) }),
    observedAt: row.observedAt,
    observedBy: String(row.observedBy).trim(),
    ...(!isBlank(row.description) && { description: String(row.description) }),
    ...(!isBlank(row.method) && { method: String(row.method).trim() }),
    ...(source && { source }),
    photos: row.photos || [],
    geom: {
      type: 'FeatureCollection',
      features: (getRowGeometries(row) || []).map((geometry) => ({
        type: 'Feature',
        geometry,
        properties: geometry.type === 'Polygon' ? {} : { bufferSize: 1 },
      })),
    },
  };
}
