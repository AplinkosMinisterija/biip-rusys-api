import { FeatureCollection, Geometry } from 'geojsonjs';
import { Request } from '../../services/requests.service';
import { Taxonomy } from '../../services/taxonomies.service';
import { TaxonomySpeciesType } from '../../types/constants';
import {
  buildVectorExportPayload,
  ObservationExportFeature,
  PlaceExportFeature,
  RequestPlace,
  validateVectorExportData,
  VectorExportLayer,
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

const layerNames = (layers: VectorExportLayer[]) => layers.map((l) => l.name);

const layer = (layers: VectorExportLayer[], name: string) =>
  layers.find((l) => l.name === name) as VectorExportLayer;

describe('buildVectorExportPayload', () => {
  it('builds a place layer and an observation layer in LKS-94', () => {
    const { layers, name, srid } = buildVectorExportPayload(request, {
      places: [place({ forms: [form()] })],
      speciesById,
    });

    expect(name).toBe('israsas-42');
    expect(srid).toBe(3346);
    expect(layerNames(layers)).toEqual(['Radavietes', 'Stebejimai']);
  });

  it('promotes a single geometry to its Multi* variant — one layer holds one geometry type', () => {
    const { layers } = buildVectorExportPayload(request, {
      places: [place({ forms: [form()] })],
      speciesById,
    });

    expect(layer(layers, 'Radavietes').geojson.features[0].geometry.type).toBe('MultiPolygon');
    expect(layer(layers, 'Stebejimai').geojson.features[0].geometry.type).toBe('MultiPoint');
  });

  it('splits a mixed-geometry layer into per-type sub-layers', () => {
    const { layers } = buildVectorExportPayload(request, {
      places: [place(), place({ id: 2, placeCode: 'SRIS-0002', geom: geom(point) })],
      speciesById,
    });

    expect(layerNames(layers)).toEqual(['Radavietes_plotai', 'Radavietes_taskai']);
    expect(layer(layers, 'Radavietes_plotai').fields).toEqual(
      layer(layers, 'Radavietes_taskai').fields,
    );
  });

  it('emits one feature per geometry of a multi-geometry place', () => {
    const { layers } = buildVectorExportPayload(request, {
      places: [place({ geom: geom(polygon, polygon) })],
      speciesById,
    });

    const features = layer(layers, 'Radavietes').geojson.features;
    expect(features).toHaveLength(2);
    expect(features.map((f) => (f.properties as PlaceExportFeature).placeCode)).toEqual([
      'SRIS-0001',
      'SRIS-0001',
    ]);
  });

  it('includes informational forms, which have no place', () => {
    const { layers } = buildVectorExportPayload(request, {
      informationalForms: { '7': { forms: [form({ species: 7 })] } },
      speciesById,
    });

    const [observation] = layer(layers, 'Stebejimai').geojson.features;
    const properties = observation.properties as ObservationExportFeature;
    expect(properties.formId).toBe(77);
    // Not undefined: JSON.stringify drops the key and the VRT then names a missing field.
    expect(properties.placeId).toBeNull();
    expect(properties.placeCode).toBeNull();
  });

  it('writes the species type in Lithuanian, never the enum value', () => {
    const { layers } = buildVectorExportPayload(request, {
      places: [place({ forms: [form()] })],
      speciesById,
    });

    const [observation] = layer(layers, 'Stebejimai').geojson.features;
    expect((observation.properties as ObservationExportFeature).speciesType).toBe('Saugoma');
  });

  it('gives every field a unique Shapefile name of at most 10 characters', () => {
    const { layers } = buildVectorExportPayload(request, {
      places: [place({ forms: [form()] })],
      speciesById,
    });

    layers.forEach(({ name, fields }) => {
      const shortNames = fields.map((f) => f.shortName);
      expect(shortNames.filter((shortName) => !shortName)).toEqual([]);
      expect(shortNames.filter((shortName) => shortName.length > 10)).toEqual([]);
      expect(new Set(shortNames).size).toBe(fields.length);
      expect(name).toMatch(/^[A-Za-z0-9_]+$/);
    });
  });

  it('writes every declared field on every feature, so the VRT never names a missing source', () => {
    const bare = place({
      placeStatusTranslate: undefined,
      placeAreaText: undefined,
      placeCreatedAt: undefined,
      placeLastObservedAt: undefined,
      placeFirstObservedAt: undefined,
    });
    const { layers } = buildVectorExportPayload(request, {
      places: [bare],
      informationalForms: {
        '7': {
          forms: [
            form({
              species: 7,
              description: undefined,
              activityTranslate: undefined,
              evolutionTranslate: undefined,
            }),
          ],
        },
      },
      speciesById,
    });

    layers.forEach(({ name, fields, geojson }) => {
      geojson.features.forEach((feature) => {
        // The round-trip is what the pipeline does to the payload.
        const serialized = Object.keys(JSON.parse(JSON.stringify(feature.properties)));
        const missing = fields.map((f) => f.name).filter((n) => !serialized.includes(n));
        expect({ name, missing }).toEqual({ name, missing: [] });
      });
    });
  });

  it('declares the date fields as Date — the export carries YYYY-MM-DD, not timestamps', () => {
    const { layers } = buildVectorExportPayload(request, {
      places: [place({ forms: [form()] })],
      speciesById,
    });

    const dateFields = layers
      .flatMap((l) => l.fields)
      .filter((f) => ['placeCreatedAt', 'observedAt', 'createdAt'].includes(f.name));

    expect(dateFields.map((f) => f.type)).toEqual(['Date', 'Date', 'Date']);
  });
});

describe('splitLayerByGeometryType', () => {
  it('groups a large mixed layer in linear time', () => {
    const places = Array.from({ length: 20_000 }, (_, i) =>
      place({ id: i, placeCode: `SRIS-${i}`, geom: geom(polygon, point) }),
    );

    const started = Date.now();
    const { layers } = buildVectorExportPayload(request, { places, speciesById });
    const elapsed = Date.now() - started;

    expect(layers.map((l) => `${l.name}=${l.geojson.features.length}`)).toEqual([
      'Radavietes_plotai=20000',
      'Radavietes_taskai=20000',
    ]);
    // Copying the group array per feature makes this ~1s; grouping in place is ~20ms.
    expect(elapsed).toBeLessThan(250);
  });
});

describe('validateVectorExportData', () => {
  it('rejects a request with no places and no forms', () => {
    expect(validateVectorExportData({ places: [], informationalForms: {} })).toMatchObject({
      valid: false,
      placesCount: 0,
      observationsCount: 0,
    });
  });

  it('rejects a request whose places and forms all lack geometry', () => {
    expect(
      validateVectorExportData({
        places: [place({ geom: undefined, forms: [form({ geom: undefined })] })],
      }),
    ).toMatchObject({ valid: false, placesCount: 1, observationsCount: 1 });
  });

  it('accepts a request with one place geometry', () => {
    expect(validateVectorExportData({ places: [place()] })).toMatchObject({ valid: true });

    const emptyGeom = { places: [place({ geom: geom() })], informationalForms: {} };

    expect({
      valid: validateVectorExportData(emptyGeom).valid,
      layers: buildVectorExportPayload(request, emptyGeom).layers.length,
    }).toEqual({ valid: false, layers: 0 });
  });
});
