import { FeatureCollection, Geometry, GeometryCollection, getGeometries } from 'geojsonjs';
import { Request } from '../../services/requests.service';
import { TaxonomySpeciesTypeTranslate } from '../../types/constants';
import { SpeciesById } from '../requests';

export interface VectorExportLayer {
  name: string;
  geojson: ExportFeatureCollection;
  fields: VectorExportField[];
}

export interface ExportFeatureCollection {
  type: 'FeatureCollection';
  features: ExportFeature[];
}

export interface ExportFeature {
  type: 'Feature';
  geometry: Geometry;
  properties: PlaceExportFeature | ObservationExportFeature;
}

export interface VectorExportField {
  name: string;
  // The DBF header caps a name at 10 chars and holds no alias; without a
  // deliberate spelling GDAL truncates and uniquifies it.
  shortName: string;
  type: 'String' | 'Integer' | 'Integer64' | 'Real' | 'Date' | 'DateTime';
  alias: string;
}

export interface VectorExportPayload {
  layers: VectorExportLayer[];
  name: string;
  srid: number;
}

export interface VectorExportDataValidation {
  valid: boolean;
  message: string;
  placesCount: number;
  observationsCount: number;
}

export interface PlaceExportFeature {
  type: 'place';
  placeId: number;
  placeCode: string;
  speciesId: number;
  speciesName: string;
  speciesNameLatin: string;
  placeStatus: string | null;
  placeArea: number;
  placeAreaText: string | null;
  placeCreatedAt: string | null;
  placeLastObservedAt: string | null;
  placeFirstObservedAt: string | null;
}

// `null`, never undefined: JSON.stringify drops an undefined value and the VRT then names a missing field.
export interface ObservationExportFeature {
  type: 'observation';
  formId: number;
  speciesId: number | null;
  speciesName: string;
  speciesNameLatin: string;
  speciesType: string;
  quantity: number;
  quantityTranslate: string;
  description: string | null;
  observedAt: string | null;
  createdAt: string | null;
  source: string | null;
  activity: string | null;
  evolution: string | null;
  placeId: number | null;
  placeCode: string | null;
}

// The slices of getRequestData() output that the vector export consumes.
export interface RequestObservationForm {
  id: number;
  species?: number;
  geom?: FeatureCollection;
  quantity?: number;
  quantityTranslate?: string;
  description?: string;
  observedAt?: string;
  createdAt?: string;
  source?: string;
  activityTranslate?: string;
  evolutionTranslate?: string;
}

export interface RequestPlace {
  id: number;
  species: number;
  placeCode: string;
  geom?: FeatureCollection;
  forms?: RequestObservationForm[];
  placeStatusTranslate?: string;
  placeArea?: number;
  placeAreaText?: string;
  placeCreatedAt?: string;
  placeLastObservedAt?: string;
  placeFirstObservedAt?: string;
}

// Informational forms arrive grouped by species id.
export type InformationalFormsBySpecies = Record<string, { forms?: RequestObservationForm[] }>;

export interface VectorExportRequestData {
  places?: RequestPlace[];
  informationalForms?: InformationalFormsBySpecies;
  speciesById?: SpeciesById;
}

type MultiGeometryType = 'MultiPoint' | 'MultiLineString' | 'MultiPolygon';

const MULTI_TYPE_BY_GEOMETRY_TYPE: Record<string, MultiGeometryType> = {
  Point: 'MultiPoint',
  MultiPoint: 'MultiPoint',
  LineString: 'MultiLineString',
  MultiLineString: 'MultiLineString',
  Polygon: 'MultiPolygon',
  MultiPolygon: 'MultiPolygon',
};

const LAYER_SUFFIX_BY_MULTI_TYPE: Record<MultiGeometryType, string> = {
  MultiPoint: 'taskai',
  MultiLineString: 'linijos',
  MultiPolygon: 'plotai',
};

// OpenFileGDB and Shapefile cannot hold Polygon and MultiPolygon in one layer,
// so promote singles and keep one payload for every format.
function toMultiGeometry(geometry: Geometry): Geometry | null {
  const multiType = MULTI_TYPE_BY_GEOMETRY_TYPE[geometry?.type];
  if (!multiType) return null;
  if (geometry.type === multiType) return geometry;
  // Wrapping single-type coordinates yields the Multi* variant (e.g. Polygon
  // → MultiPolygon) — a pairing TS cannot prove across the coordinates union.
  return { type: multiType, coordinates: [geometry.coordinates] } as Geometry;
}

// A truthy `geom` may still carry nothing a driver accepts; validator and builder must agree.
function toExportGeometries(geom?: FeatureCollection): Geometry[] {
  if (!geom) return [];

  return getGeometries(geom)
    .flatMap((g: Geometry | GeometryCollection) =>
      g?.type === 'GeometryCollection' ? (g as GeometryCollection).geometries : [g as Geometry],
    )
    .map(toMultiGeometry)
    .filter((geometry): geometry is Geometry => !!geometry);
}

// One entity can hold several geometries, which share its properties.
function buildFeaturesFromGeom(
  geom: FeatureCollection,
  properties: PlaceExportFeature | ObservationExportFeature,
): ExportFeature[] {
  return toExportGeometries(geom).map((geometry) => ({
    type: 'Feature' as const,
    geometry,
    properties,
  }));
}

// The tools vector-export contract: one geometry type per layer. Mixed layers
// are split into per-type sub-layers (e.g. Radavietes_taskai, Radavietes_plotai).
// Names stay ASCII: a Shapefile layer name becomes a filename inside the ZIP.
function splitLayerByGeometryType(layer: VectorExportLayer): VectorExportLayer[] {
  const featuresByType = new Map<string, ExportFeature[]>();

  layer.geojson.features.forEach((feature) => {
    const type = feature.geometry.type;
    const group = featuresByType.get(type);
    if (group) group.push(feature);
    else featuresByType.set(type, [feature]);
  });

  if (featuresByType.size <= 1) return [layer];

  return [...featuresByType.entries()].map(([type, features]) => ({
    ...layer,
    name: `${layer.name}_${LAYER_SUFFIX_BY_MULTI_TYPE[type as MultiGeometryType] || type}`,
    geojson: { type: 'FeatureCollection', features },
  }));
}

function buildPlaceFeatures(places: RequestPlace[], speciesById: SpeciesById): ExportFeature[] {
  const features: ExportFeature[] = [];

  places?.forEach((place) => {
    if (!place.geom) return;

    const species = speciesById[`${place.species}`];

    features.push(
      ...buildFeaturesFromGeom(place.geom, {
        type: 'place',
        placeId: place.id,
        placeCode: place.placeCode,
        speciesId: place.species,
        speciesName: species?.speciesName || 'N/A',
        speciesNameLatin: species?.speciesNameLatin || '',
        placeStatus: place.placeStatusTranslate ?? null,
        placeArea: place.placeArea || 0,
        placeAreaText: place.placeAreaText ?? null,
        placeCreatedAt: place.placeCreatedAt ?? null,
        placeLastObservedAt: place.placeLastObservedAt ?? null,
        placeFirstObservedAt: place.placeFirstObservedAt ?? null,
      }),
    );
  });

  return features;
}

function buildObservationFeaturesFromForm(
  form: RequestObservationForm,
  speciesId: number | undefined,
  speciesById: SpeciesById,
  place?: { id: number; placeCode: string },
): ExportFeature[] {
  if (!form.geom) return [];

  const species = speciesById[`${speciesId}`];

  return buildFeaturesFromGeom(form.geom, {
    type: 'observation',
    formId: form.id,
    speciesId: speciesId ?? null,
    speciesName: species?.speciesName || 'N/A',
    speciesNameLatin: species?.speciesNameLatin || '',
    speciesType: TaxonomySpeciesTypeTranslate[species?.speciesType] || '',
    quantity: form.quantity || 0,
    quantityTranslate: form.quantityTranslate || '0',
    description: form.description ?? null,
    observedAt: form.observedAt ?? null,
    createdAt: form.createdAt ?? null,
    source: form.source ?? null,
    activity: form.activityTranslate ?? null,
    evolution: form.evolutionTranslate ?? null,
    placeId: place?.id ?? null,
    placeCode: place?.placeCode ?? null,
  });
}

// Two sources, as in the GeoJSON export: forms on a place, and informational
// forms that have none.
function buildObservationFeatures(
  places: RequestPlace[],
  informationalForms: InformationalFormsBySpecies,
  speciesById: SpeciesById,
): ExportFeature[] {
  const features: ExportFeature[] = [];

  places?.forEach((place) => {
    place.forms?.forEach((form) => {
      features.push(
        ...buildObservationFeaturesFromForm(form, place.species, speciesById, {
          id: place.id,
          placeCode: place.placeCode,
        }),
      );
    });
  });

  Object.values(informationalForms || {}).forEach((speciesGroup) => {
    speciesGroup.forms?.forEach((form) => {
      features.push(...buildObservationFeaturesFromForm(form, form.species, speciesById));
    });
  });

  return features;
}

function getAllForms(informationalForms?: InformationalFormsBySpecies): RequestObservationForm[] {
  return Object.values(informationalForms || {}).flatMap((group) => group.forms || []);
}

export function buildVectorExportPayload(
  request: Request,
  requestData: VectorExportRequestData,
): VectorExportPayload {
  const placeFeatures = buildPlaceFeatures(requestData.places || [], requestData.speciesById || {});
  const observationFeatures = buildObservationFeatures(
    requestData.places || [],
    requestData.informationalForms || {},
    requestData.speciesById || {},
  );

  const placeLayers: VectorExportLayer = {
    name: 'Radavietes',
    geojson: {
      type: 'FeatureCollection',
      features: placeFeatures,
    },
    fields: [
      { name: 'placeId', shortName: 'RADAV_ID', type: 'Integer', alias: 'Radavietės ID' },
      { name: 'placeCode', shortName: 'RADAV_KOD', type: 'String', alias: 'Radavietės kodas' },
      { name: 'speciesId', shortName: 'RUSIS_ID', type: 'Integer', alias: 'Rūšies ID' },
      { name: 'speciesName', shortName: 'RUSIS_PAV', type: 'String', alias: 'Rūšies pavadinimas' },
      {
        name: 'speciesNameLatin',
        shortName: 'RUSIS_LOT',
        type: 'String',
        alias: 'Rūšies lotyniškas pavadinimas',
      },
      { name: 'placeStatus', shortName: 'BUSENA', type: 'String', alias: 'Radavietės būsena' },
      { name: 'placeArea', shortName: 'PLOTAS_M2', type: 'Real', alias: 'Radavietės plotas (m²)' },
      { name: 'placeAreaText', shortName: 'PLOTAS', type: 'String', alias: 'Radavietės plotas' },
      {
        name: 'placeCreatedAt',
        shortName: 'SUKURTA',
        type: 'Date',
        alias: 'Radavietės sukūrimo data',
      },
      {
        name: 'placeLastObservedAt',
        shortName: 'PASK_STEB',
        type: 'Date',
        alias: 'Paskutinio stebėjimo data',
      },
      {
        name: 'placeFirstObservedAt',
        shortName: 'PIRM_STEB',
        type: 'Date',
        alias: 'Pirmo stebėjimo data',
      },
    ],
  };

  const observationLayers: VectorExportLayer = {
    name: 'Stebejimai',
    geojson: {
      type: 'FeatureCollection',
      features: observationFeatures,
    },
    fields: [
      { name: 'formId', shortName: 'ANKET_ID', type: 'Integer', alias: 'Anketos ID' },
      { name: 'speciesId', shortName: 'RUSIS_ID', type: 'Integer', alias: 'Rūšies ID' },
      { name: 'speciesName', shortName: 'RUSIS_PAV', type: 'String', alias: 'Rūšies pavadinimas' },
      {
        name: 'speciesNameLatin',
        shortName: 'RUSIS_LOT',
        type: 'String',
        alias: 'Rūšies lotyniškas pavadinimas',
      },
      { name: 'speciesType', shortName: 'RUSIES_TIP', type: 'String', alias: 'Rūšies tipas' },
      { name: 'quantity', shortName: 'INDIV_SK', type: 'Integer', alias: 'Individų skaičius' },
      { name: 'quantityTranslate', shortName: 'KIEKIS', type: 'String', alias: 'Kiekis' },
      { name: 'description', shortName: 'APRASYMAS', type: 'String', alias: 'Aprašymas' },
      { name: 'observedAt', shortName: 'STEB_DATA', type: 'Date', alias: 'Stebėta' },
      { name: 'createdAt', shortName: 'SUKURTA', type: 'Date', alias: 'Sukurta' },
      { name: 'source', shortName: 'SALTINIS', type: 'String', alias: 'Šaltinis' },
      { name: 'activity', shortName: 'VEIK_POZ', type: 'String', alias: 'Veiklos požymiai' },
      { name: 'evolution', shortName: 'VYST_STAD', type: 'String', alias: 'Vystymosi stadija' },
      {
        name: 'placeId',
        shortName: 'RADAV_ID',
        type: 'Integer',
        alias: 'Radavietės ID',
      },
      {
        name: 'placeCode',
        shortName: 'RADAV_KOD',
        type: 'String',
        alias: 'Radavietės kodas',
      },
    ],
  };

  const layers: VectorExportLayer[] = [];

  if (placeFeatures.length > 0) {
    layers.push(...splitLayerByGeometryType(placeLayers));
  }

  if (observationFeatures.length > 0) {
    layers.push(...splitLayerByGeometryType(observationLayers));
  }

  return {
    layers,
    name: `israsas-${request.id}`,
    srid: 3346,
  };
}

export function validateVectorExportData(
  requestData: VectorExportRequestData,
): VectorExportDataValidation {
  const places = requestData?.places || [];
  // Observations include forms attached to places, mirroring buildObservationFeatures.
  const forms = [
    ...places.flatMap((p) => p.forms || []),
    ...getAllForms(requestData?.informationalForms),
  ];
  const counts = { placesCount: places.length, observationsCount: forms.length };

  if (!counts.placesCount && !counts.observationsCount) {
    return {
      ...counts,
      valid: false,
      message: 'No places or observation forms available',
    };
  }

  const placesWithGeom = places.filter((p) => toExportGeometries(p.geom).length).length;
  const observationsWithGeom = forms.filter((f) => toExportGeometries(f.geom).length).length;

  if (!placesWithGeom && !observationsWithGeom) {
    return {
      ...counts,
      valid: false,
      message: 'No geometries found for places or observations',
    };
  }

  return {
    ...counts,
    valid: true,
    message: `Valid: ${placesWithGeom} places, ${observationsWithGeom} observations`,
  };
}
