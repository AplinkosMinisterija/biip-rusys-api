jest.mock('../pdf/requests', () => ({ getRequestData: jest.fn() }));

import { Context, Errors, LoggerInstance } from 'moleculer';
import { Request } from '../../services/requests.service';
import { getRequestData } from '../pdf/requests';
import { generateAndSaveVectorExport, SHP_EXPORT_FORMAT } from './generate';
import { RequestPlace } from './requests';

const requestData = (places: RequestPlace[]) => ({
  places,
  informationalForms: {},
  speciesById: {},
});

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

describe('generateAndSaveVectorExport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('names the request and the format on the error it rethrows', async () => {
    (getRequestData as jest.Mock).mockResolvedValue(requestData([place()]));

    const ctx = contextOf({
      'requests.resolve': () => ({ id: 42 } as Request),
      'tools.makeShp': () => {
        throw new Errors.MoleculerError('ogr2ogr failed to produce the export', 500, 'SHP_FAILED');
      },
    });

    await expect(
      generateAndSaveVectorExport(ctx, logger(), 42, SHP_EXPORT_FORMAT),
    ).rejects.toMatchObject({ data: { requestId: 42, format: 'SHP' } });
  });

  it('skips without calling the tools when no geometry can be exported', async () => {
    (getRequestData as jest.Mock).mockResolvedValue(
      requestData([
        place({ geom: { type: 'FeatureCollection', features: [] } as RequestPlace['geom'] }),
      ]),
    );

    const ctx = contextOf({ 'requests.resolve': () => ({ id: 42 } as Request) });

    await expect(
      generateAndSaveVectorExport(ctx, logger(), 42, SHP_EXPORT_FORMAT),
    ).resolves.toMatchObject({ skipped: 'no-data' });
  });
});
