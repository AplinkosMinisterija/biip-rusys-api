// Same value as TaxonomySpeciesType.INVASIVE; kept here so this file stays free of services.
const INVASIVE_SPECIES_TYPE = 'INVASIVE';

export interface FormImportRow {
  species?: number;
  quantity?: number;
  observedAt?: string;
  observedBy?: string;
  x?: number;
  y?: number;
  description?: string;
  method?: string;
  photos?: { url: string; name?: string; size?: number }[];
}

export interface FormImportTaxonomy {
  speciesId: number;
  speciesType?: string;
  formType?: string;
}

// LKS-94 (EPSG:3346) box around Lithuania with its territorial waters and economic zone.
// It catches swapped axes and WGS-84 degrees, not borders.
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
  NO_COORDINATES: 'Nenurodytos koordinatės',
  BAD_COORDINATES: 'Koordinatės ne LKS-94 sistemoje arba už Lietuvos ribų',
  NO_PHOTOS: 'Invazinės rūšies stebėjimui privaloma nuotrauka',
  BAD_METHOD: 'Šios rūšies anketai reikia nurodyti tinkamą stebėjimo metodą',
};

const isBlank = (value: unknown) =>
  value === undefined || value === null || String(value).trim() === '';

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

  if (isBlank(row.x) || isBlank(row.y)) {
    errors.push(FormImportErrors.NO_COORDINATES);
  } else {
    const x = Number(row.x);
    const y = Number(row.y);
    const inside =
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= LKS_BOUNDS.minX &&
      x <= LKS_BOUNDS.maxX &&
      y >= LKS_BOUNDS.minY &&
      y <= LKS_BOUNDS.maxY;
    if (!inside) {
      errors.push(FormImportErrors.BAD_COORDINATES);
    }
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
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(row.x), Number(row.y)] },
          properties: { bufferSize: 1 },
        },
      ],
    },
  };
}
