import { FeatureCollection, Geometry } from 'geojsonjs';
import { Request } from '../../services/requests.service';
import { Taxonomy } from '../../services/taxonomies.service';
import { TaxonomySpeciesType } from '../../types/constants';
import {
  buildObservationFeatures,
  buildPlaceFeatures,
  ExportFeature,
  ObservationExportFeature,
  OBSERVATION_EXPORT_FIELDS,
  OBSERVATION_LAYER_NAME,
  PlaceExportFeature,
  PLACE_EXPORT_FIELDS,
  PLACE_LAYER_NAME,
  RequestPlace,
  VectorExportField,
} from './requests';

const species = (over: Partial<Taxonomy> = {}): Taxonomy =>
  ({
    speciesId: 7,
    speciesName: 'Vapsvaėdis',
    speciesNameLatin: 'Pernis apivorus',
    speciesType: TaxonomySpeciesType.ENDANGERED,
    speciesSynonyms: [],
    ...over,
  } as Taxonomy);

const speciesById = { '7': species() };

const request = { id: 42 } as Request;

const polygon: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [500000, 6000000],
      [500010, 6000000],
      [500010, 6000010],
      [500000, 6000000],
    ],
  ],
} as Geometry;

const point: Geometry = { type: 'Point', coordinates: [500005, 6000005] } as Geometry;

const geom = (...geometries: Geometry[]): FeatureCollection =>
  ({
    type: 'FeatureCollection',
    features: geometries.map((geometry) => ({ type: 'Feature', geometry, properties: {} })),
  } as FeatureCollection);

const place = (over: Partial<RequestPlace> = {}): RequestPlace => ({
  id: 1,
  species: 7,
  placeCode: 'SRIS-0001',
  geom: geom(polygon),
  placeStatusTranslate: 'Patvirtinta',
  placeArea: 15230.5,
  placeAreaText: '15230.500 m²',
  placeCreatedAt: '2024-03-01',
  placeLastObservedAt: '2024-04-02',
  placeFirstObservedAt: '2024-03-01',
  ...over,
});

const form = (over = {}) => ({
  id: 77,
  geom: geom(point),
  quantity: 3,
  quantityTranslate: '3',
  description: 'Lizdas pušyje',
  observedAt: '2024-04-02',
  createdAt: '2024-04-03',
  source: 'Stebėjimo anketa',
  activityTranslate: 'Lizdas',
  evolutionTranslate: 'Subrendęs',
  ...over,
});

const places = (...list: RequestPlace[]) => buildPlaceFeatures(list, speciesById);

const observations = (
  list: RequestPlace[],
  informationalForms: Parameters<typeof buildObservationFeatures>[1] = {},
) => buildObservationFeatures(list, informationalForms, speciesById);

const declaredLayers: Array<{ name: string; fields: VectorExportField[] }> = [
  { name: PLACE_LAYER_NAME, fields: PLACE_EXPORT_FIELDS },
  { name: OBSERVATION_LAYER_NAME, fields: OBSERVATION_EXPORT_FIELDS },
];

describe('the exported features', () => {
  it('promotes a single geometry to its Multi* variant — one layer holds one geometry type', () => {
    expect(places(place()).map((f) => f.geometry.type)).toEqual(['MultiPolygon']);
    expect(observations([place({ forms: [form()] })]).map((f) => f.geometry.type)).toEqual([
      'MultiPoint',
    ]);
  });

  it('emits one feature per geometry of a multi-geometry place', () => {
    const features = places(place({ geom: geom(polygon, polygon) }));

    expect(features).toHaveLength(2);
    expect(features.map((f) => (f.properties as PlaceExportFeature).placeCode)).toEqual([
      'SRIS-0001',
      'SRIS-0001',
    ]);
  });

  it('drops a place whose geom carries nothing a driver accepts', () => {
    expect(places(place({ geom: geom() }))).toEqual([]);
  });

  it('includes informational forms, which have no place', () => {
    const [observation] = observations([], { '7': { forms: [form({ species: 7 })] } });
    const properties = observation.properties as ObservationExportFeature;

    expect(properties.formId).toBe(77);
    // Not undefined: JSON.stringify drops the key and the VRT then names a missing field.
    expect(properties.placeId).toBeNull();
    expect(properties.placeCode).toBeNull();
  });

  it('writes the species type in Lithuanian, never the enum value', () => {
    const [observation] = observations([place({ forms: [form()] })]);

    expect((observation.properties as ObservationExportFeature).speciesType).toBe('Saugoma');
  });

  it('writes every declared field on every feature, so the VRT never names a missing source', () => {
    const bare = place({
      placeStatusTranslate: undefined,
      placeAreaText: undefined,
      placeCreatedAt: undefined,
      placeLastObservedAt: undefined,
      placeFirstObservedAt: undefined,
    });
    const bareForm = form({
      species: 7,
      description: undefined,
      activityTranslate: undefined,
      evolutionTranslate: undefined,
    });

    const built: Array<[string, VectorExportField[], ExportFeature[]]> = [
      [PLACE_LAYER_NAME, PLACE_EXPORT_FIELDS, places(bare)],
      [
        OBSERVATION_LAYER_NAME,
        OBSERVATION_EXPORT_FIELDS,
        observations([], { '7': { forms: [bareForm] } }),
      ],
    ];

    built.forEach(([name, fields, features]) => {
      features.forEach((feature) => {
        // The round-trip is what the pipeline does to the payload.
        const serialized = Object.keys(JSON.parse(JSON.stringify(feature.properties)));
        const missing = fields.map((f) => f.name).filter((n) => !serialized.includes(n));
        expect({ name, missing }).toEqual({ name, missing: [] });
      });
    });
  });
});

describe('the declared fields', () => {
  it('gives every field a unique Shapefile name of at most 10 characters', () => {
    declaredLayers.forEach(({ name, fields }) => {
      const shortNames = fields.map((f) => f.shortName);

      expect(shortNames.filter((shortName) => !shortName)).toEqual([]);
      expect(shortNames.filter((shortName) => shortName.length > 10)).toEqual([]);
      expect(new Set(shortNames).size).toBe(fields.length);
      expect(name).toMatch(/^[A-Za-z0-9_]+$/);
    });
  });

  it('declares the date fields as Date — the export carries YYYY-MM-DD, not timestamps', () => {
    const dateFields = declaredLayers
      .flatMap((l) => l.fields)
      .filter((f) => ['placeCreatedAt', 'observedAt', 'createdAt'].includes(f.name));

    expect(dateFields.map((f) => f.type)).toEqual(['Date', 'Date', 'Date']);
  });
});
