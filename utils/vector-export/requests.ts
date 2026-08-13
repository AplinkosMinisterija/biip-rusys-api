import { getGeometries } from 'geojsonjs';
import { Context } from 'moleculer';
import { getRequestData } from '../pdf/requests';
import { Request } from '../../services/requests.service';

export interface VectorExportLayer {
  name: string;
  geojson: {
    type: 'FeatureCollection';
    features: any[];
  };
  fields: VectorExportField[];
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
  formId: number;
  speciesId: number;
  speciesName: string;
  speciesNameLatin: string;
  speciesType: string;
  quantity: number;
  quantityTranslate: string;
  description: string;
  observedAt: string;
  createdAt: string;
  source: string;
  activity: string;
  evolution: string;
  placeId?: number;
  placeCode?: string;
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
function toMultiGeometry(geometry: any): any | null {
  const multiType = MULTI_TYPE_BY_GEOMETRY_TYPE[geometry?.type];
  if (!multiType) return null;
  if (geometry.type === multiType) return geometry;
  return { type: multiType, coordinates: [geometry.coordinates] };
}

// `geom` arrives as a FeatureCollection (see getPlaces/getForms in
// utils/pdf/requests.ts) — one entity can hold several geometries, so it
// becomes several features sharing the same properties.
function buildFeaturesFromGeom(geom: any, properties: any): any[] {
  return getGeometries(geom)
    .flatMap((g: any) => (g?.type === 'GeometryCollection' ? g.geometries : [g]))
    .map(toMultiGeometry)
    .filter(Boolean)
    .map((geometry: any) => ({ type: 'Feature', geometry, properties }));
}

// The tools vector-export contract: one geometry type per layer. Mixed layers
// are split into per-type sub-layers (e.g. Radavietos_taskai, Radavietos_plotai).
function splitLayerByGeometryType(layer: VectorExportLayer): VectorExportLayer[] {
  const featuresByType = new Map<string, any[]>();

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

function buildPlaceFeatures(places: any[]): any[] {
  const features: any[] = [];

  places?.forEach((place: any) => {
    if (!place.geom) return;

    const speciesName = place.inheritedSpecies?.[0]?.speciesName || 'N/A';
    const speciesNameLatin = place.inheritedSpecies?.[0]?.speciesNameLatin || '';

    features.push(
      ...buildFeaturesFromGeom(place.geom, {
        placeId: place.id,
        placeCode: place.placeCode,
        speciesId: place.species,
        speciesName: speciesName,
        speciesNameLatin: speciesNameLatin,
        placeStatus: place.placeStatusTranslate,
        placeArea: place.placeArea?.value || 0,
        placeAreaText: place.placeAreaText,
        placeCreatedAt: place.placeCreatedAt,
        placeLastObservedAt: place.placeLastObservedAt,
        placeFirstObservedAt: place.placeFirstObservedAt,
        type: 'place',
      } as PlaceExportFeature),
    );
  });

  return features;
}

function buildObservationFeatures(informationalForms: any[], speciesById: any): any[] {
  const features: any[] = [];

  Object.values(informationalForms || {}).forEach((speciesGroup: any) => {
    speciesGroup.forms?.forEach((form: any) => {
      if (!form.geom) return;

      const species = speciesById[`${form.species}`];

      features.push(
        ...buildFeaturesFromGeom(form.geom, {
          formId: form.id,
          speciesId: form.species,
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
          type: 'observation',
        } as ObservationExportFeature),
      );
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

function getAllForms(informationalForms: any): any[] {
  return Object.values(informationalForms || {}).flatMap((group: any) => group.forms || []);
}

export function buildVectorExportPayload(request: Request, requestData: any): VectorExportPayload {
  const placeFeatures = buildPlaceFeatures(requestData.places || []);
  const observationFeatures = buildObservationFeatures(
    requestData.informationalForms || {},
    requestData.speciesById || {},
  );

  const placeLayers: VectorExportLayer = {
    name: 'Radavietos',
    geojson: {
      type: 'FeatureCollection',
      features: placeFeatures,
    },
    fields: [
      { name: 'placeId', type: 'Integer', alias: 'Vietos ID' },
      { name: 'placeCode', type: 'String', alias: 'Vietos kodas' },
      { name: 'speciesId', type: 'Integer', alias: 'Rūšies ID' },
      { name: 'speciesName', type: 'String', alias: 'Rūšies pavadinimas' },
      { name: 'speciesNameLatin', type: 'String', alias: 'Rūšies lotyniškas pavadinimas' },
      { name: 'placeStatus', type: 'String', alias: 'Vietos būklė' },
      { name: 'placeArea', type: 'Real', alias: 'Vietos plotas (m²)' },
      { name: 'placeAreaText', type: 'String', alias: 'Vietos plotas' },
      { name: 'placeCreatedAt', type: 'DateTime', alias: 'Vieta sukurta' },
      { name: 'placeLastObservedAt', type: 'DateTime', alias: 'Paskutinis stebėjimas' },
      { name: 'placeFirstObservedAt', type: 'DateTime', alias: 'Pirmas stebėjimas' },
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
      { name: 'activity', type: 'String', alias: 'Veikla' },
      { name: 'evolution', type: 'String', alias: 'Vystymosi stadija' },
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

export function validateVectorExportData(requestData: any): VectorExportDataValidation {
  const places = requestData?.places || [];
  const forms = getAllForms(requestData?.informationalForms);
  const counts = { placesCount: places.length, observationsCount: forms.length };

  if (!counts.placesCount && !counts.observationsCount) {
    return {
      ...counts,
      valid: false,
      message: 'No places or observation forms available',
    };
  }

  const placesWithGeom = places.filter((p: any) => !!p.geom).length;
  const observationsWithGeom = forms.filter((f: any) => !!f.geom).length;

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
