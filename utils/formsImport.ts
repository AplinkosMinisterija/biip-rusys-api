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
  NO_SPECIES: 'Nenurodyta rūšis',
  UNKNOWN_SPECIES: 'Rūšis su tokiu ID nerasta',
  BAD_QUANTITY: 'Kiekis turi būti sveikas neneigiamas skaičius',
  NO_DATE: 'Nenurodyta stebėjimo data',
  BAD_DATE: 'Neteisinga stebėjimo data',
  FUTURE_DATE: 'Stebėjimo data negali būti ateityje',
  NO_OBSERVER: 'Nenurodytas stebėtojas',
  NO_COORDINATES: 'Nenurodytos koordinatės (x, y) arba geometrija',
  BAD_COORDINATES: 'Koordinatės ne LKS-94 sistemoje arba už Lietuvos ribų',
  BAD_GEOMETRY:
    'Neteisinga geometrija: tinka WKT POINT, POLYGON arba MULTIPOLYGON su uždarais kontūrais',
  NO_PHOTOS: 'Invazinės rūšies stebėjimui privaloma nuotrauka',
  BAD_METHOD: 'Šios rūšies anketai reikia nurodyti tinkamą stebėjimo metodą',
};

const isBlank = (value: unknown) =>
  value === undefined || value === null || String(value).trim() === '';

type Position = [number, number];

type ImportGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'Polygon'; coordinates: Position[][] };

const RING = /\(([^()]*)\)/g;
const POLYGON_IN_MULTI = /\(((?:\s*\([^()]*\)\s*,?)+)\)/g;

const parsePositions = (text: string): Position[] | null => {
  const positions = text.split(',').map((pair) => pair.trim().split(/\s+/).map(Number));
  if (!positions.every((p) => p.length >= 2 && p.length <= 4 && p.every(Number.isFinite))) {
    return null;
  }
  return positions.map(([x, y]) => [x, y]);
};

const isClosedRing = (ring: Position[]) =>
  ring.length >= 4 &&
  ring[0][0] === ring[ring.length - 1][0] &&
  ring[0][1] === ring[ring.length - 1][1];

const parsePolygon = (body: string): Position[][] | null => {
  if (body.replace(RING, '').replace(/[\s,]/g, '') !== '') return null;
  const rings = [...body.matchAll(RING)].map((match) => parsePositions(match[1]));
  if (!rings.length || rings.some((ring) => !ring || !isClosedRing(ring))) return null;
  return rings as Position[][];
};

export function parseWktGeometry(wkt: string): ImportGeometry[] | null {
  const text = wkt.trim().replace(/^SRID=\d+;/i, '');
  const match = text.match(/^(POINT|POLYGON|MULTIPOLYGON)\s*(?:Z|M|ZM)?\s*\((.*)\)$/is);
  if (!match) return null;

  const type = match[1].toUpperCase();
  const body = match[2];

  if (type === 'POINT') {
    const positions = parsePositions(body);
    return positions?.length === 1 ? [{ type: 'Point', coordinates: positions[0] }] : null;
  }

  if (type === 'POLYGON') {
    const polygon = parsePolygon(body);
    return polygon ? [{ type: 'Polygon', coordinates: polygon }] : null;
  }

  if (body.replace(POLYGON_IN_MULTI, '').replace(/[\s,]/g, '') !== '') return null;
  const polygons = [...body.matchAll(POLYGON_IN_MULTI)].map((part) => parsePolygon(part[1]));
  if (!polygons.length || polygons.some((polygon) => !polygon)) return null;
  return polygons.map((polygon) => ({ type: 'Polygon', coordinates: polygon }));
}

function getRowGeometries(row: FormImportRow): ImportGeometry[] | null | undefined {
  if (!isBlank(row.geometry)) return parseWktGeometry(String(row.geometry));
  if (isBlank(row.x) || isBlank(row.y)) return undefined;

  return [{ type: 'Point', coordinates: [Number(row.x), Number(row.y)] }];
}

const geometryPoints = (geometry: ImportGeometry): Position[] =>
  geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates.flat();

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
        properties: geometry.type === 'Point' ? { bufferSize: 1 } : {},
      })),
    },
  };
}
