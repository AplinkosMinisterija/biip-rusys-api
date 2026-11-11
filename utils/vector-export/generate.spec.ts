jest.mock('../pdf/requests', () => ({
  getRequestData: jest.fn(),
  getPlaces: jest.fn(),
  getInformationalForms: jest.fn(),
}));

import { Context, Errors, LoggerInstance } from 'moleculer';
import { Request } from '../../services/requests.service';
import { getInformationalForms, getPlaces, getRequestData } from '../pdf/requests';
import { generateAndSaveVectorExport, SHP_EXPORT_FORMAT } from './generate';
import { RequestPlace } from './requests';

const place = (over: Partial<RequestPlace> = {}): RequestPlace => ({
  id: 1,
  species: 7,
  placeCode: 'SRIS-0001',
  geom: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [500000, 6000000],
              [500010, 6000000],
              [500010, 6000010],
              [500000, 6000000],
            ],
          ],
        },
      },
    ],
  } as RequestPlace['geom'],
  ...over,
});

// One page of places, then nothing; informational forms stay empty.
const onePageOf = (places: RequestPlace[]) => {
  (getRequestData as jest.Mock).mockResolvedValue({
    requestDate: '2026-11-11',
    translates: {},
    speciesById: {},
  });
  (getPlaces as jest.Mock).mockImplementation(async (_ctx, _id, { offset }) =>
    offset ? [] : places,
  );
  (getInformationalForms as jest.Mock).mockResolvedValue({});
};

const logger = () =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerInstance);

type Handler = (params?: unknown) => unknown;

const contextOf = (handlers: Record<string, Handler>) =>
  ({
    call: async (action: string, params?: unknown) => {
      if (!handlers[action]) throw new Error(`unexpected call: ${action}`);
      return handlers[action](params);
    },
  } as unknown as Context);

type UploadParams = { folder: string; presign?: boolean };
type ToolsParams = {
  layers: Array<{ name: string; url?: string; geojson?: unknown; fields: unknown[] }>;
  name: string;
  srid: number;
};

// Every temp upload answers with its own object path and presigned url.
const minioHandlers = () => {
  const uploaded: UploadParams[] = [];
  const removed: Array<{ path: string }> = [];
  let n = 0;

  return {
    uploaded,
    removed,
    handlers: {
      'minio.uploadFile': (params: unknown) => {
        const upload = params as UploadParams;
        uploaded.push(upload);
        n += 1;

        return {
          success: true,
          url: `https://example.test/object-${n}`,
          path: `rusys/${upload.folder}/object-${n}.geojson`,
          presignedUrl: `https://minio.test/object-${n}?signature=${n}`,
        };
      },
      'minio.removeFile': (params: unknown) => {
        removed.push(params as { path: string });
        return { sucess: true };
      },
    },
  };
};

describe('generateAndSaveVectorExport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hands the tools service a url per layer instead of a feature collection', async () => {
    onePageOf([place()]);
    const minio = minioHandlers();
    let toolsParams: ToolsParams;

    const ctx = contextOf({
      ...minio.handlers,
      'requests.resolve': () => ({ id: 42 } as Request),
      'tools.makeShp': (params: unknown) => {
        toolsParams = params as ToolsParams;
        return 'stream';
      },
      'requests.saveGeneratedShp': () => ({}),
    });

    await expect(
      generateAndSaveVectorExport(ctx, logger(), 42, SHP_EXPORT_FORMAT),
    ).resolves.toMatchObject({ generated: true });

    expect(toolsParams.name).toBe('israsas-42');
    expect(toolsParams.srid).toBe(3346);
    expect(toolsParams.layers).toHaveLength(1);
    expect(toolsParams.layers[0].name).toBe('Radavietes');
    expect(toolsParams.layers[0].url).toMatch(/^https:\/\/minio\.test\/object-1\?signature=/);
    expect(toolsParams.layers[0].geojson).toBeUndefined();
    expect(toolsParams.layers[0].fields.length).toBeGreaterThan(0);
  });

  it('asks minio to presign the layer files and not the finished export', async () => {
    onePageOf([place()]);
    const minio = minioHandlers();

    const ctx = contextOf({
      ...minio.handlers,
      'requests.resolve': () => ({ id: 42 } as Request),
      'tools.makeShp': () => 'stream',
      'requests.saveGeneratedShp': () => ({}),
    });

    await generateAndSaveVectorExport(ctx, logger(), 42, SHP_EXPORT_FORMAT);

    expect(minio.uploaded.map((u) => !!u.presign)).toEqual([true, false]);
  });

  it('removes every temp object after a successful export', async () => {
    onePageOf([place(), place({ id: 2, geom: pointGeom() })]);
    const minio = minioHandlers();

    const ctx = contextOf({
      ...minio.handlers,
      'requests.resolve': () => ({ id: 42 } as Request),
      'tools.makeShp': () => 'stream',
      'requests.saveGeneratedShp': () => ({}),
    });

    await generateAndSaveVectorExport(ctx, logger(), 42, SHP_EXPORT_FORMAT);

    // Two layer files uploaded and removed; the third upload is the export itself.
    expect(minio.uploaded).toHaveLength(3);
    expect(minio.removed.map((r) => r.path)).toEqual([
      'rusys/uploads/requests/private/user/tmp/object-1.geojson',
      'rusys/uploads/requests/private/user/tmp/object-2.geojson',
    ]);
  });

  it('removes every temp object when the conversion fails', async () => {
    onePageOf([place()]);
    const minio = minioHandlers();

    const ctx = contextOf({
      ...minio.handlers,
      'requests.resolve': () => ({ id: 42 } as Request),
      'tools.makeShp': () => {
        throw new Errors.MoleculerError('ogr2ogr failed to produce the export', 500, 'SHP_FAILED');
      },
    });

    await expect(
      generateAndSaveVectorExport(ctx, logger(), 42, SHP_EXPORT_FORMAT),
    ).rejects.toMatchObject({ data: { requestId: 42, format: 'SHP' } });

    expect(minio.removed.map((r) => r.path)).toEqual(['rusys/uploads/requests/private/user/tmp/object-1.geojson']);
  });

  it('skips without calling the tools when no geometry can be exported', async () => {
    onePageOf([
      place({ geom: { type: 'FeatureCollection', features: [] } as RequestPlace['geom'] }),
    ]);

    const ctx = contextOf({ 'requests.resolve': () => ({ id: 42 } as Request) });

    await expect(
      generateAndSaveVectorExport(ctx, logger(), 42, SHP_EXPORT_FORMAT),
    ).resolves.toMatchObject({ skipped: 'no-data' });
  });
});

function pointGeom(): RequestPlace['geom'] {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [500005, 6000005] },
      },
    ],
  } as RequestPlace['geom'];
}
