import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FeatureCollection } from 'geojsonjs';
import { Taxonomy } from '../../services/taxonomies.service';
import { TaxonomySpeciesType } from '../../types/constants';
import { InformationalFormsBySpecies, RequestPlace } from './requests';
import {
  VectorExportBatch,
  VectorExportLayerFile,
  writeVectorExportLayerFiles,
} from './layer-files';

const polygon = (x: number): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [x, 6000000],
            [x + 10, 6000000],
            [x + 10, 6000010],
            [x, 6000000],
          ],
        ],
      },
    },
  ],
});

const point = (x: number): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, 6000000] } },
  ],
});

const place = (id: number, geom: FeatureCollection): RequestPlace => ({
  id,
  species: 1,
  placeCode: `RAD-${id}`,
  geom,
  forms: [],
  placeStatusTranslate: 'Stabili',
  placeArea: 100,
  placeAreaText: '0,01 ha',
  placeCreatedAt: '2020-01-01',
  placeLastObservedAt: '2024-01-01',
  placeFirstObservedAt: '2020-01-01',
});

const speciesById = {
  '1': {
    speciesId: 1,
    speciesName: 'Pelkinė uolaskėlė',
    speciesNameLatin: 'Saxifraga hirculus',
    speciesType: TaxonomySpeciesType.ENDANGERED,
    speciesSynonyms: [],
  } as Taxonomy,
};

const readFeatures = async (file: VectorExportLayerFile) => {
  const parsed = JSON.parse(await fsp.readFile(file.path, 'utf8'));
  expect(parsed.type).toBe('FeatureCollection');
  return parsed.features as Array<{ geometry: { type: string }; properties: Record<string, any> }>;
};

const byName = (files: VectorExportLayerFile[]) =>
  [...files].sort((a, b) => a.name.localeCompare(b.name));

describe('writeVectorExportLayerFiles', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(join(tmpdir(), 'layer-files-spec-'));
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  // A loader that hands out a fixed list in pages, and records the offsets it was asked for.
  const pagedLoader = (places: RequestPlace[], forms: InformationalFormsBySpecies[] = []) => {
    const offsets: number[] = [];
    const load = async (offset: number, limit: number): Promise<VectorExportBatch> => {
      offsets.push(offset);
      return {
        places: places.slice(offset, offset + limit),
        informationalForms: forms[offset / limit] || {},
      };
    };
    return { load, offsets };
  };

  it('writes one file per layer and geometry type', async () => {
    const places = [
      ...[0, 1, 2].map((i) => place(i + 1, polygon(500000 + i))),
      ...[3, 4].map((i) => place(i + 1, point(500000 + i))),
    ];

    const files = byName(
      await writeVectorExportLayerFiles(dir, speciesById, pagedLoader(places).load, 100),
    );

    expect(files.map((f) => f.name)).toEqual(['Radavietes_plotai', 'Radavietes_taskai']);
    expect(files.map((f) => f.features)).toEqual([3, 2]);
    expect((await readFeatures(files[0])).map((f) => f.geometry.type)).toEqual([
      'MultiPolygon',
      'MultiPolygon',
      'MultiPolygon',
    ]);
  });

  it('keeps the plain layer name when a layer holds one geometry type', async () => {
    const files = await writeVectorExportLayerFiles(
      dir,
      speciesById,
      pagedLoader([place(1, polygon(500000))]).load,
      100,
    );

    expect(files.map((f) => f.name)).toEqual(['Radavietes']);
    expect(files[0].path.endsWith('Radavietes.geojson')).toBe(true);
  });

  it('asks for one page at a time until both sources run dry', async () => {
    const places = Array.from({ length: 250 }, (_, i) => place(i + 1, polygon(500000 + i)));
    const loader = pagedLoader(places);

    const files = await writeVectorExportLayerFiles(dir, speciesById, loader.load, 100);

    expect(loader.offsets).toEqual([0, 100, 200, 300]);
    expect(files.reduce((n, f) => n + f.features, 0)).toBe(250);
    expect(await readFeatures(files[0])).toHaveLength(250);
  });

  it('writes observations from both places and informational forms', async () => {
    const withForm = place(1, polygon(500000));
    withForm.forms = [{ id: 11, species: 1, geom: point(500001), observedAt: '2024-01-01' }];
    const informational: InformationalFormsBySpecies = {
      '1': { forms: [{ id: 12, species: 1, geom: point(500002), observedAt: '2024-02-01' }] },
    };

    const files = byName(
      await writeVectorExportLayerFiles(
        dir,
        speciesById,
        pagedLoader([withForm], [informational]).load,
        100,
      ),
    );

    expect(files.map((f) => f.name)).toEqual(['Radavietes', 'Stebejimai']);
    const observations = await readFeatures(files[1]);
    expect(observations.map((f) => f.properties.formId)).toEqual([11, 12]);
  });

  it('writes null for every declared field the row does not carry', async () => {
    const bare: RequestPlace = { id: 1, species: 1, placeCode: 'RAD-1', geom: polygon(500000) };

    const files = await writeVectorExportLayerFiles(
      dir,
      speciesById,
      pagedLoader([bare]).load,
      100,
    );

    const [feature] = await readFeatures(files[0]);
    for (const field of files[0].fields) {
      expect(feature.properties).toHaveProperty(field.name);
    }
    expect(feature.properties.placeAreaText).toBeNull();
  });

  it('lets a loader failure through after the files it opened are let go', async () => {
    const places = Array.from({ length: 150 }, (_, i) => place(i + 1, polygon(500000 + i)));
    const loader = pagedLoader(places);
    const failOnSecondPage = async (offset: number, limit: number) => {
      if (offset) throw new Error('the database went away');
      return loader.load(offset, limit);
    };

    await expect(
      writeVectorExportLayerFiles(dir, speciesById, failOnSecondPage, 100),
    ).rejects.toThrow('the database went away');
  });

  it('writes no file for a request with nothing to export', async () => {
    const files = await writeVectorExportLayerFiles(dir, speciesById, pagedLoader([]).load, 100);

    expect(files).toEqual([]);
    expect(await fsp.readdir(dir)).toEqual([]);
  });

  it('skips a place whose geom carries no geometry a driver accepts', async () => {
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

    const files = await writeVectorExportLayerFiles(
      dir,
      speciesById,
      pagedLoader([place(1, empty)]).load,
      100,
    );

    expect(files).toEqual([]);
  });
});
