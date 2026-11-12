import type { Feature, FeatureCollection, Geometry } from 'geojsonjs/src/types';
import knex, { Knex } from 'knex';
import config from '../knexfile';
import { isInsideLithuania } from './lithuania';

const point = (x: number, y: number): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [x, y] } as Geometry,
  properties: {},
});

const collection = (...features: Feature[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

const PLACES: [string, Feature, boolean][] = [
  ['Vilnius', point(582000, 6060000), true],
  ['the Curonian lagoon', point(321500, 6145000), true],
  ['the shore at Palanga', point(325700, 6191000), true],
  ['the Baltic sea 18 km out', point(306945, 6134367), true],
  ['the Baltic sea 40 km out', point(280000, 6134367), false],
  ['Belarus', point(700000, 6060000), false],
  ['Latvia', point(500000, 6250000), false],
  ['Poland', point(500000, 5955000), false],
];

describe('isInsideLithuania', () => {
  let adapter: Knex;

  beforeAll(() => {
    adapter = knex(config);
  });

  afterAll(async () => {
    await adapter.destroy();
  });

  it.each(PLACES)('answers %s', async (_place, feature, expected) => {
    expect(await isInsideLithuania(adapter, collection(feature))).toBe(expected);
  });

  it('rejects a collection where only one feature is abroad', async () => {
    const [, vilnius] = PLACES[0];
    const [, belarus] = PLACES[5];

    expect(await isInsideLithuania(adapter, collection(vilnius, belarus))).toBe(false);
  });

  it('accepts a shape that only reaches into Lithuania', async () => {
    const crossingTheLatvianBorder: Feature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [500000, 6250000],
          [500000, 6220000],
        ],
      } as Geometry,
      properties: {},
    };

    expect(await isInsideLithuania(adapter, collection(crossingTheLatvianBorder))).toBe(true);
  });

  const withCrs = (x: number, y: number): Feature => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [x, y],
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
    } as Geometry,
    properties: {},
  });

  it('reads a geometry that carries a crs as lon/lat, the way it is stored', async () => {
    expect(await isInsideLithuania(adapter, collection(withCrs(25.28, 54.69)))).toBe(true);
    expect(await isInsideLithuania(adapter, collection(withCrs(25.28, 51.5)))).toBe(false);
  });

  it('refuses to answer for coordinates postgis cannot project', async () => {
    await expect(isInsideLithuania(adapter, collection(withCrs(582000, 6060000)))).rejects.toThrow(
      'Invalid coordinate',
    );
  });

  it('refuses nothing while the boundary table is missing', async () => {
    const withoutTheTable = {
      raw: () =>
        Promise.reject(
          Object.assign(new Error('relation "lithuania_boundary" does not exist'), {
            code: '42P01',
          }),
        ),
    } as unknown as Knex;

    expect(await isInsideLithuania(withoutTheTable, collection(PLACES[5][1]))).toBe(true);
  });

  it('asks nothing when there is no geometry', async () => {
    expect(await isInsideLithuania(adapter, undefined)).toBe(true);
  });
});
