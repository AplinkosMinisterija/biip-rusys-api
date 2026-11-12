import {
  formImportRowToParams,
  FormImportErrors,
  parseGeometry,
  validateFormImportRow,
} from './formsImport';

const SQUARE = 'POLYGON((306900 6134300, 307000 6134300, 307000 6134400, 306900 6134300))';

describe('validateFormImportRow', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const taxonomy = { speciesId: 767, speciesType: 'ENDANGERED' };
  const row = {
    species: 767,
    quantity: 2,
    observedAt: '2026-10-24T15:15:00.000Z',
    observedBy: 'Vardenis Pavardenis',
    x: 306945.2,
    y: 6134367.25,
    description: 'Stebėti du suaugę paukščiai jūroje',
  };

  it('accepts a complete row, including a point at sea', () => {
    expect(validateFormImportRow(row, taxonomy, now)).toEqual([]);
  });

  it('accepts a row without a quantity', () => {
    expect(validateFormImportRow({ ...row, quantity: undefined }, taxonomy, now)).toEqual([]);
  });

  it('reports an unknown species', () => {
    expect(validateFormImportRow(row, undefined, now)).toEqual([FormImportErrors.UNKNOWN_SPECIES]);
  });

  it('reports a missing species once', () => {
    expect(validateFormImportRow({ ...row, species: undefined }, undefined, now)).toEqual([
      FormImportErrors.NO_SPECIES,
    ]);
  });

  it('rejects negative and fractional quantities', () => {
    expect(validateFormImportRow({ ...row, quantity: -1 }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_QUANTITY,
    ]);
    expect(validateFormImportRow({ ...row, quantity: 1.5 }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_QUANTITY,
    ]);
  });

  it('rejects missing, broken and future dates', () => {
    expect(validateFormImportRow({ ...row, observedAt: '' }, taxonomy, now)).toEqual([
      FormImportErrors.NO_DATE,
    ]);
    expect(validateFormImportRow({ ...row, observedAt: 'vakar' }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_DATE,
    ]);
    expect(
      validateFormImportRow({ ...row, observedAt: '2027-01-01T00:00:00Z' }, taxonomy, now),
    ).toEqual([FormImportErrors.FUTURE_DATE]);
  });

  it('requires an observer', () => {
    expect(validateFormImportRow({ ...row, observedBy: ' ' }, taxonomy, now)).toEqual([
      FormImportErrors.NO_OBSERVER,
    ]);
  });

  it('rejects swapped axes and WGS-84 degrees', () => {
    expect(validateFormImportRow({ ...row, x: row.y, y: row.x }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_COORDINATES,
    ]);
    expect(validateFormImportRow({ ...row, x: 21.1, y: 55.7 }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_COORDINATES,
    ]);
  });

  it('accepts a polygon instead of x and y', () => {
    expect(
      validateFormImportRow(
        { ...row, x: undefined, y: undefined, geometry: SQUARE },
        taxonomy,
        now,
      ),
    ).toEqual([]);
  });

  it('reports a missing location', () => {
    expect(validateFormImportRow({ ...row, x: undefined, y: undefined }, taxonomy, now)).toEqual([
      FormImportErrors.NO_COORDINATES,
    ]);
  });

  it('rejects unreadable geometry and polygons outside Lithuania', () => {
    const open = 'POLYGON((306900 6134300, 307000 6134300, 307000 6134400, 306950 6134350))';
    expect(validateFormImportRow({ ...row, geometry: open }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_GEOMETRY,
    ]);
    expect(validateFormImportRow({ ...row, geometry: 'CIRCLE(1 2, 3)' }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_GEOMETRY,
    ]);
    expect(validateFormImportRow({ ...row, geometry: '{"type":"Point"' }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_GEOMETRY,
    ]);
    expect(
      validateFormImportRow({ ...row, geometry: 'LINESTRING(1 2, 3 4)' }, taxonomy, now),
    ).toEqual([FormImportErrors.BAD_COORDINATES]);
    expect(
      validateFormImportRow(
        { ...row, geometry: 'POLYGON((21.1 55.7, 21.2 55.7, 21.2 55.8, 21.1 55.7))' },
        taxonomy,
        now,
      ),
    ).toEqual([FormImportErrors.BAD_COORDINATES]);
  });

  it('requires a photo for invasive species only', () => {
    const invasive = { speciesId: 1, speciesType: 'INVASIVE' };
    expect(validateFormImportRow(row, invasive, now)).toEqual([FormImportErrors.NO_PHOTOS]);
    expect(
      validateFormImportRow({ ...row, photos: [{ url: 'https://x/y.jpg' }] }, invasive, now),
    ).toEqual([]);
  });
});

describe('formImportRowToParams', () => {
  it('builds a point in LKS-94 and keeps optional fields out when empty', () => {
    const params = formImportRowToParams(
      {
        species: 767,
        observedAt: '2026-10-24T15:15:00.000Z',
        observedBy: ' Vardenis ',
        x: 306945.2,
        y: 6134367.25,
        description: '',
      },
      7,
    );

    expect(params).toEqual({
      species: 767,
      observedAt: '2026-10-24T15:15:00.000Z',
      observedBy: 'Vardenis',
      source: 7,
      photos: [],
      geom: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [306945.2, 6134367.25] },
            properties: { bufferSize: 1 },
          },
        ],
      },
    });
  });
});

describe('parseGeometry', () => {
  it('reads WKT points, lines and polygons, including multi parts and holes', () => {
    expect(parseGeometry('POINT (306945.2 6134367.25)')).toEqual({
      type: 'Point',
      coordinates: [306945.2, 6134367.25],
    });
    expect(parseGeometry('LINESTRING Z (0 0 1, 10 10 1)')).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [10, 10],
      ],
    });
    expect(parseGeometry('MULTIPOINT ((1 2), (3 4))')).toEqual({
      type: 'MultiPoint',
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    });
    expect(parseGeometry('MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))')?.type).toBe('MultiLineString');

    const withHole = 'SRID=3346;POLYGON((0 0, 10 0, 10 10, 0 10, 0 0), (2 2, 3 2, 3 3, 2 2))';
    expect(parseGeometry(withHole)?.coordinates).toHaveLength(2);

    const multi =
      'MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5), (5.2 5.1, 5.5 5.1, 5.5 5.4, 5.2 5.1)))';
    expect(parseGeometry(multi)?.type).toBe('MultiPolygon');
    expect(parseGeometry(multi)?.coordinates).toHaveLength(2);
  });

  it('reads GeoJSON geometries, features and feature collections', () => {
    const line = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [5, 5],
      ],
    };
    expect(parseGeometry(JSON.stringify(line))).toEqual(line);
    expect(
      parseGeometry(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', geometry: line, properties: {} },
            {
              type: 'Feature',
              geometry: {
                ...line,
                coordinates: [
                  [1, 1],
                  [2, 2],
                ],
              },
              properties: {},
            },
          ],
        }),
      )?.type,
    ).toBe('MultiLineString');
  });

  it('rejects open rings, one-point lines and mixed geometry types', () => {
    expect(parseGeometry('POLYGON((0 0, 1 0, 1 1, 0 1))')).toBeNull();
    expect(parseGeometry('LINESTRING(0 0)')).toBeNull();
    expect(parseGeometry('{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,0]]]}')).toBeNull();
    expect(parseGeometry('GEOMETRYCOLLECTION(POINT(1 2), LINESTRING(0 0, 1 1))')).toBeNull();
    expect(
      parseGeometry(
        JSON.stringify({
          type: 'GeometryCollection',
          geometries: [
            { type: 'Point', coordinates: [1, 2] },
            {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('gives lines a buffer and keeps a multipolygon as one feature', () => {
    const lineParams = formImportRowToParams({
      species: 767,
      observedAt: '2026-10-24T15:15:00.000Z',
      observedBy: 'Vardenis',
      geometry: 'LINESTRING(306900 6134300, 307000 6134400)',
    });
    expect(lineParams.geom.features[0].properties).toEqual({ bufferSize: 1 });

    const params = formImportRowToParams({
      species: 767,
      observedAt: '2026-10-24T15:15:00.000Z',
      observedBy: 'Vardenis',
      geometry: `MULTIPOLYGON(((306900 6134300, 307000 6134300, 307000 6134400, 306900 6134300)), ((308000 6135000, 308100 6135000, 308100 6135100, 308000 6135000)))`,
    });

    expect(params.geom.features).toEqual([
      {
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [306900, 6134300],
                [307000, 6134300],
                [307000, 6134400],
                [306900, 6134300],
              ],
            ],
            [
              [
                [308000, 6135000],
                [308100, 6135000],
                [308100, 6135100],
                [308000, 6135000],
              ],
            ],
          ],
        },
        properties: {},
      },
    ]);
  });
});
