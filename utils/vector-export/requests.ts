import { FeatureCollection, Geometry, GeometryCollection, getGeometries } from 'geojsonjs';
import { Context } from 'moleculer';
import { getRequestData } from '../pdf/requests';
import { SpeciesById } from '../requests';
import { Request } from '../../services/requests.service';

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
  type: 'String' | 'Integer' | 'Integer64' | 'Real' | 'Date' | 'DateTime';
  alias: string;
  nullable?: boolean;
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
  placeStatus: string;
  placeArea: number;
  placeAreaText: string;
  placeCreatedAt: string;
  placeLastObservedAt: string;
  placeFirstObservedAt: string;
}

export interface ObservationExportFeature {
  type: 'observation';
  formId: number;
  speciesId?: number;
  speciesName: string;
  speciesNameLatin: string;
  speciesType: string;
  quantity: number;
  quantityTranslate: string;
  description?: string;
  observedAt?: string;
  createdAt?: string;
  source?: string;
  activity?: string;
  evolution?: string;
  placeId?: number;
  placeCode?: string;
}

// The slices of getRequestData() output (utils/pdf/requests.ts getPlaces,
// getInformationalForms, getFormData) that the vector export consumes.
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
  placeStatusTranslate: string;
  placeArea?: number;
  placeAreaText: string;
  placeCreatedAt: string;
  placeLastObservedAt: string;
  placeFirstObservedAt: string;
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

// OpenFileGDB can't hold Polygon and MultiPolygon in one layer — promote
// singles to their Multi* variant so equal shapes always share a type.
// GPKG tolerates mixed layers, but promoting for both keeps the payload
// format-agnostic (the tools /gdb and /gpkg endpoints accept the same body).
function toMultiGeometry(geometry: Geometry): Geometry | null {
  const multiType = MULTI_TYPE_BY_GEOMETRY_TYPE[geometry?.type];
  if (!multiType) return null;
  if (geometry.type === multiType) return geometry;
  // Wrapping single-type coordinates yields the Multi* variant (e.g. Polygon
  // → MultiPolygon) — a pairing TS cannot prove across the coordinates union.
  return { type: multiType, coordinates: [geometry.coordinates] } as Geometry;
}

// `geom` arrives as a FeatureCollection (see getPlaces/getForms in
// utils/pdf/requests.ts) — one entity can hold several geometries, so it
// becomes several features sharing the same properties.
function buildFeaturesFromGeom(
  geom: FeatureCollection,
  properties: PlaceExportFeature | ObservationExportFeature,
): ExportFeature[] {
  return getGeometries(geom)
    .flatMap((g: Geometry | GeometryCollection) =>
      g?.type === 'GeometryCollection' ? (g as GeometryCollection).geometries : [g as Geometry],
    )
    .map(toMultiGeometry)
    .filter((geometry): geometry is Geometry => !!geometry)
    .map((geometry) => ({ type: 'Feature' as const, geometry, properties }));
}

// The tools vector-export contract: one geometry type per layer. Mixed layers
// are split into per-type sub-layers (e.g. Radavietės_taskai, Radavietės_plotai).
function splitLayerByGeometryType(layer: VectorExportLayer): VectorExportLayer[] {
  const featuresByType = new Map<string, ExportFeature[]>();

  layer.geojson.features.forEach((feature) => {
    const type = feature.geometry.type;
    featuresByType.set(type, [...(featuresByType.get(type) || []), feature]);
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
        placeStatus: place.placeStatusTranslate,
        placeArea: place.placeArea || 0,
        placeAreaText: place.placeAreaText,
        placeCreatedAt: place.placeCreatedAt,
        placeLastObservedAt: place.placeLastObservedAt,
        placeFirstObservedAt: place.placeFirstObservedAt,
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
    speciesId,
    speciesName: species?.speciesName || 'N/A',
    speciesNameLatin: species?.speciesNameLatin || '',
    speciesType: species?.speciesType || '',
    quantity: form.quantity || 0,
    quantityTranslate: form.quantityTranslate || '0',
    description: form.description,
    observedAt: form.observedAt,
    createdAt: form.createdAt,
    source: form.source,
    activity: form.activityTranslate,
    evolution: form.evolutionTranslate,
    placeId: place?.id,
    placeCode: place?.placeCode,
  });
}

// Observations come from two sources, same as the GeoJSON export
// (requests.getGeojson): forms attached to a place, and standalone
// informational forms (which have no place).
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
    speciesGroup.forms?.forEach((form: any) => {
      features.push(...buildObservationFeaturesFromForm(form, form.species, speciesById));
    });
  });

  return features;
}

// Loads request data with the option set every vector-export flow needs:
// places and observation forms with geometries, no PDF legend.
export async function getVectorExportRequestData(ctx: Context, id: number) {
  return getRequestData(ctx, id, {
    loadPlaces: true,
    loadLegend: false,
    loadInformationalForms: true,
  });
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

  // Aliases match the property labels of the GeoJSON export (requests.getGeojson).
  const placeLayers: VectorExportLayer = {
    name: 'Radavietės',
    geojson: {
      type: 'FeatureCollection',
      features: placeFeatures,
    },
    fields: [
      { name: 'placeId', type: 'Integer', alias: 'Radavietės ID' },
      { name: 'placeCode', type: 'String', alias: 'Radavietės kodas' },
      { name: 'speciesId', type: 'Integer', alias: 'Rūšies ID' },
      { name: 'speciesName', type: 'String', alias: 'Rūšies pavadinimas' },
      { name: 'speciesNameLatin', type: 'String', alias: 'Rūšies lotyniškas pavadinimas' },
      { name: 'placeStatus', type: 'String', alias: 'Radavietės būsena' },
      { name: 'placeArea', type: 'Real', alias: 'Radavietės plotas (m²)' },
      { name: 'placeAreaText', type: 'String', alias: 'Radavietės plotas' },
      { name: 'placeCreatedAt', type: 'DateTime', alias: 'Radavietės sukūrimo data' },
      { name: 'placeLastObservedAt', type: 'DateTime', alias: 'Paskutinio stebėjimo data' },
      { name: 'placeFirstObservedAt', type: 'DateTime', alias: 'Pirmo stebėjimo data' },
    ],
  };

  const observationLayers: VectorExportLayer = {
    name: 'Stebėjimai',
    geojson: {
      type: 'FeatureCollection',
      features: observationFeatures,
    },
    fields: [
      { name: 'formId', type: 'Integer', alias: 'Anketos ID' },
      { name: 'speciesId', type: 'Integer', alias: 'Rūšies ID' },
      { name: 'speciesName', type: 'String', alias: 'Rūšies pavadinimas' },
      { name: 'speciesNameLatin', type: 'String', alias: 'Rūšies lotyniškas pavadinimas' },
      { name: 'speciesType', type: 'String', alias: 'Rūšies tipas' },
      { name: 'quantity', type: 'Integer', alias: 'Individų skaičius' },
      { name: 'quantityTranslate', type: 'String', alias: 'Kiekis' },
      { name: 'description', type: 'String', alias: 'Aprašymas' },
      { name: 'observedAt', type: 'DateTime', alias: 'Stebėta' },
      { name: 'createdAt', type: 'DateTime', alias: 'Sukurta' },
      { name: 'source', type: 'String', alias: 'Šaltinis' },
      { name: 'activity', type: 'String', alias: 'Veiklos požymiai' },
      { name: 'evolution', type: 'String', alias: 'Vystymosi stadija' },
      { name: 'placeId', type: 'Integer', alias: 'Radavietės ID', nullable: true },
      { name: 'placeCode', type: 'String', alias: 'Radavietės kodas', nullable: true },
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

  const placesWithGeom = places.filter((p) => !!p.geom).length;
  const observationsWithGeom = forms.filter((f) => !!f.geom).length;

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
