jest.mock('../utils/mails', () => ({
  emailCanBeSent: () => true,
  notifyOnFileGenerated: jest.fn(),
  notifyOnRequestUpdate: jest.fn(),
}));

jest.mock('../utils/pdf/requests', () => ({
  getRequestData: jest.fn(),
}));

import { notifyOnFileGenerated } from '../utils/mails';
import { getRequestData } from '../utils/pdf/requests';
import { LKS_94_CRS } from '../utils/requests';
import { ServiceBroker } from 'moleculer';
import { EndpointType } from '../types';
import { UserType } from './users.service';
import DbConnection from '../mixins/database.mixin';
import RequestsService, {
  Request,
  RequestDocumentType,
  RequestStatus,
  RequestType,
} from './requests.service';

type GenerateDocumentsIfNeeded = (this: unknown, request: Request) => void;

type SaveGeneratedFile = (
  this: unknown,
  ctx: { params: { id: number; url: string } },
  documentType: string,
) => Promise<Request>;

type InitiateDocumentGenerate = (
  this: unknown,
  ctx: { params: { id: number }; call: (action: string, params?: unknown) => Promise<unknown> },
  documentType: string,
  initiateAction: string,
) => Promise<{ generating: boolean }>;

const generateDocumentsIfNeeded = (
  RequestsService.prototype as unknown as {
    generateDocumentsIfNeeded: GenerateDocumentsIfNeeded;
  }
).generateDocumentsIfNeeded;

type SendNotificationOnFileGenerated = (
  this: unknown,
  ctx: { call: (action: string, params?: unknown) => Promise<unknown> },
  request: Partial<Request>,
  documentType: string,
  sendEmail: boolean,
) => Promise<void>;

type Geojson = { crs: unknown; features: Array<{ geometry: Record<string, unknown> }> };

type GetGeojson = (
  this: unknown,
  ctx: {
    params: { id: number };
    meta: Record<string, unknown>;
    call: (action: string, params?: unknown) => Promise<unknown>;
  },
) => Promise<Geojson>;

type GetApprovalComment = (
  this: unknown,
  ctx: { call: (action: string, params?: unknown) => Promise<unknown> },
  requestId: number | string,
) => Promise<string | undefined>;

const {
  saveGeneratedFile,
  initiateDocumentGenerate,
  sendNotificationOnFileGenerated,
  getApprovalComment,
  getGeojson,
} = RequestsService.prototype as unknown as {
  saveGeneratedFile: SaveGeneratedFile;
  initiateDocumentGenerate: InitiateDocumentGenerate;
  sendNotificationOnFileGenerated: SendNotificationOnFileGenerated;
  getApprovalComment: GetApprovalComment;
  getGeojson: GetGeojson;
};

const approvedRequest = {
  id: 42,
  status: RequestStatus.APPROVED,
  type: RequestType.GET_ONCE,
  documentTypes: Object.values(RequestDocumentType),
} as Request;

describe('expert automatic assignment preference', () => {
  const prototype = RequestsService.prototype as any;
  const requests = [
    { createdBy: 20, inheritedSpecies: [7, 8], data: { autoAssignDisabled: true } },
    { createdBy: 20, inheritedSpecies: [7], data: {} },
    { createdBy: 30, inheritedSpecies: [7, 8], data: { autoAssignDisabled: true } },
    { createdBy: 40, inheritedSpecies: [7], data: { autoAssignDisabled: false } },
  ];
  const experts = (speciesId: number, forAutoAssign?: boolean) =>
    prototype.getExpertsIdsBySpecies.call(
      {},
      {
        params: { speciesId, forAutoAssign },
        call: jest.fn().mockResolvedValue(requests),
      },
    );

  it('skips marked requests while retaining overlapping unmarked coverage', async () => {
    await expect(experts(7, true)).resolves.toEqual([20, 40]);
  });

  it('does not use species covered only by a marked request', async () => {
    await expect(experts(8, true)).resolves.toEqual([]);
  });

  it('keeps marked experts for manual callers by default', async () => {
    await expect(experts(8)).resolves.toEqual([20, 30]);
    await expect(experts(7, false)).resolves.toEqual([20, 30, 40]);
  });

  const service = new RequestsService(new ServiceBroker({ logger: false }));
  const fields = service.schema.settings.fields;

  it.each([true, false])('strips the flag on generic create (%s)', (flag) => {
    const hook = fields.data.onCreate;
    expect(typeof hook).toBe('function');
    expect(hook({ value: { description: 'Synthetic', autoAssignDisabled: flag } })).toEqual({
      description: 'Synthetic',
    });
  });

  it.each(['onUpdate', 'onReplace'])(
    '%s preserves the stored flag and other edited data',
    (name) => {
      const hook = fields.data[name];
      expect(typeof hook).toBe('function');
      for (const stored of [true, false, undefined]) {
        const result = hook({
          value: { description: 'Edited', autoAssignDisabled: !stored },
          entity: { data: { autoAssignDisabled: stored } },
        });
        expect(result.description).toBe('Edited');
        expect(result.autoAssignDisabled).toBe(stored);
      }
      expect(
        hook({ value: undefined, entity: { data: { autoAssignDisabled: true } } }),
      ).toBeUndefined();
      expect(hook({ value: null, entity: { data: { autoAssignDisabled: true } } })).toEqual({
        autoAssignDisabled: true,
      });
    },
  );

  it('confirms why a generic data-only update cannot be used for the admin toggle', async () => {
    const ctx = { params: { id: 42 }, meta: { user: { id: 99, type: UserType.ADMIN } } };
    await prototype.validateStatusChange.call({}, ctx);
    expect(fields.status.onUpdate({ ctx, value: undefined })).toBe(RequestStatus.SUBMITTED);
  });

  it('enforces the flag through the database field validation used by regular-user writes', async () => {
    const dataService = new ServiceBroker({ logger: false }).createService({
      name: 'requestDataWrites',
      mixins: [DbConnection({ collection: 'requests' })],
      settings: { fields: { data: fields.data } },
    });
    // Initialize field validation without starting a database adapter.
    dataService._processFields();
    const write = (type: string, params: object, data?: object) =>
      dataService._validateObject(
        { meta: { user: { id: 20, type: UserType.USER } } },
        dataService.$fields,
        params,
        { type, entity: { data }, nestedFieldSupport: false },
      );
    const created = await write('create', {
      data: { description: 'Synthetic', autoAssignDisabled: true },
    });
    expect(JSON.parse(created.data)).toEqual({ description: 'Synthetic' });
    for (const type of ['update', 'replace']) {
      const changed = await write(
        type,
        { data: { description: 'Edited', autoAssignDisabled: false } },
        { autoAssignDisabled: true },
      );
      expect(JSON.parse(changed.data)).toEqual({ description: 'Edited', autoAssignDisabled: true });
      await expect(write(type, {}, { autoAssignDisabled: true })).resolves.toEqual({});
    }
  });

  it('restricts the dedicated REST action to administrators', () => {
    expect(service.schema.actions.setAutoAssign).toEqual(
      expect.objectContaining({ rest: 'PATCH /:id/auto-assign', types: [EndpointType.ADMIN] }),
    );
  });

  const runToggle = (request: any, flag = true) => {
    const ctx = { params: { id: 42, autoAssignDisabled: flag } };
    const updated = { ...request, data: { ...request?.data, autoAssignDisabled: flag } };
    const self = {
      resolveEntities: jest.fn().mockResolvedValue(request),
      getAdapter: jest.fn().mockResolvedValue({ updateById: jest.fn().mockResolvedValue(updated) }),
      _entityChanged: jest.fn(),
    };
    return { ctx, self, updated };
  };

  it.each([true, false])(
    'writes only data and invalidates caches when toggling to %s',
    async (flag) => {
      expect(typeof prototype.setAutoAssign).toBe('function');
      const original = {
        id: 42,
        type: RequestType.CHECK,
        status: RequestStatus.APPROVED,
        data: { description: 'Synthetic', autoAssignDisabled: !flag },
      };
      const { ctx, self, updated } = runToggle(original, flag);
      await expect(prototype.setAutoAssign.call(self, ctx)).resolves.toEqual(updated);
      const adapter = await self.getAdapter();
      expect(adapter.updateById).toHaveBeenCalledWith(42, {
        data: { description: 'Synthetic', autoAssignDisabled: flag },
      });
      expect(self._entityChanged).toHaveBeenCalledWith('update', updated, original, ctx, {});
      expect(updated.status).toBe(RequestStatus.APPROVED);
    },
  );

  it('rejects requests that are not expert requests', async () => {
    expect(typeof prototype.setAutoAssign).toBe('function');
    const { ctx, self } = runToggle({ id: 42, type: RequestType.GET });
    await expect(prototype.setAutoAssign.call(self, ctx)).rejects.toThrow();
    expect(self.getAdapter).not.toHaveBeenCalled();
  });

  it('resolves with throwIfNotExist and refuses a missing request', async () => {
    expect(typeof prototype.setAutoAssign).toBe('function');
    const { ctx, self } = runToggle(undefined);
    self.resolveEntities.mockRejectedValue(new Error('Not found'));
    await expect(prototype.setAutoAssign.call(self, ctx)).rejects.toThrow('Not found');
    expect(self.resolveEntities).toHaveBeenCalledWith(ctx, { id: 42, throwIfNotExist: true });
    expect(self.getAdapter).not.toHaveBeenCalled();
  });
});

describe('generateDocumentsIfNeeded', () => {
  it('logs every generation it could not enqueue, instead of leaving the rejection unhandled', async () => {
    const logged: unknown[][] = [];
    const self = {
      broker: { call: jest.fn().mockRejectedValue(new Error('transporter down')) },
      logger: { error: (...args: unknown[]) => logged.push(args) },
    };

    generateDocumentsIfNeeded.call(self, approvedRequest);
    await new Promise((resolve) => setImmediate(resolve));

    expect({ calls: self.broker.call.mock.calls.length, logged: logged.length }).toEqual({
      calls: Object.values(RequestDocumentType).length,
      logged: Object.values(RequestDocumentType).length,
    });
  });
});

describe('saveGeneratedFile', () => {
  const saveWith = async (updated: Partial<Request>) => {
    const notified: unknown[][] = [];
    const self = {
      updateEntity: jest.fn().mockResolvedValue({ id: 42, ...updated }),
      sendNotificationOnFileGenerated: (...args: unknown[]) => {
        notified.push(args);
        return Promise.resolve();
      },
    };

    await saveGeneratedFile.call(
      self,
      { params: { id: 42, url: 'http://x/f.zip' } },
      RequestDocumentType.SHP,
    );

    return { self, notified };
  };

  it('writes the column its document type owns', async () => {
    const { self } = await saveWith({ generatedFileShp: 'http://x/f.zip' });

    expect(self.updateEntity.mock.calls[0][1]).toEqual({
      id: 42,
      generatedFileShp: 'http://x/f.zip',
    });
  });

  it('asks for the mail when this is the only generated file', async () => {
    const { notified } = await saveWith({ generatedFileShp: 'http://x/f.zip' });

    expect(notified[0].slice(2)).toEqual([RequestDocumentType.SHP, true]);
  });

  it('does not ask for the mail when another format already produced one', async () => {
    const { notified } = await saveWith({
      generatedFile: 'http://x/israsas.pdf',
      generatedFileShp: 'http://x/f.zip',
    });

    expect(notified[0].slice(2)).toEqual([RequestDocumentType.SHP, false]);
  });
  it('keeps a saved file when the notification fails, instead of failing the job', async () => {
    const self = {
      updateEntity: jest.fn().mockResolvedValue({ id: 42, generatedFileShp: 'http://x/f.zip' }),
      sendNotificationOnFileGenerated: jest.fn().mockRejectedValue(new Error('postmark down')),
      logger: { error: jest.fn() },
    };

    const request = await saveGeneratedFile.call(
      self,
      { params: { id: 42, url: 'http://x/f.zip' } },
      RequestDocumentType.SHP,
    );

    expect({ url: request.generatedFileShp, logged: self.logger.error.mock.calls.length }).toEqual({
      url: 'http://x/f.zip',
      logged: 1,
    });
  });
});

describe('initiateDocumentGenerate', () => {
  it('does not queue a generation for a file that already exists', async () => {
    const generated = {
      ...approvedRequest,
      generatedFileShp: 'http://x/israsas-shp.zip',
    } as Request;

    const call = jest.fn(async (action: string) => {
      if (action === 'requests.resolve') return generated;
      throw new Error(`unexpected call: ${action}`);
    });

    const result = await initiateDocumentGenerate.call(
      {},
      { params: { id: 42 }, call },
      RequestDocumentType.SHP,
      'shp.requests.initiateShpGenerate',
    );

    expect({ result, calls: call.mock.calls.map(([action]) => action) }).toEqual({
      result: { generating: false },
      calls: ['requests.resolve'],
    });
  });
});

describe('sendNotificationOnFileGenerated', () => {
  type ApprovalHistory = { comment?: string; createdBy?: number };

  const notifyWith = async (
    request: Partial<Request>,
    user: unknown,
    approvals: ApprovalHistory[] = [],
  ) => {
    const histories: unknown[][] = [];
    const self = {
      createRequestHistory: (...args: unknown[]) => {
        histories.push(args);
        return Promise.resolve();
      },
      getApprovalComment,
    };
    const call = jest.fn(async (action: string) => {
      if (action === 'users.resolve') return user;
      if (action === 'requests.isExpertUser') return false;
      if (action === 'requests.histories.find') return approvals;
      throw new Error(`unexpected call: ${action}`);
    });

    await sendNotificationOnFileGenerated.call(
      self,
      { call },
      request,
      RequestDocumentType.SHP,
      true,
    );

    return { histories };
  };

  beforeEach(() => jest.mocked(notifyOnFileGenerated).mockClear());

  it('attempts no mail when neither the request nor its author has an address', async () => {
    const { histories } = await notifyWith(
      { id: 42, notifyEmail: null, createdBy: 1, speciesTypes: ['ENDANGERED'] } as Request,
      { id: 1, email: null },
    );

    expect({
      mails: jest.mocked(notifyOnFileGenerated).mock.calls.length,
      histories: histories.length,
    }).toEqual({ mails: 0, histories: 1 });
  });

  it("sends to the author's address when the request carries none", async () => {
    await notifyWith(
      { id: 42, notifyEmail: null, createdBy: 1, speciesTypes: ['ENDANGERED'] } as Request,
      { id: 1, email: 'author@example.com' },
    );

    expect(jest.mocked(notifyOnFileGenerated).mock.calls[0][0]).toBe('author@example.com');
  });

  const authoredRequest = { id: 42, createdBy: 1, speciesTypes: ['ENDANGERED'] } as Request;
  const author = { id: 1, email: 'author@example.com' };

  it('carries the note the administrator wrote when approving the request', async () => {
    await notifyWith(authoredRequest, author, [
      { comment: 'Automatiškai patvirtintas prašymas.' },
      { comment: 'Patvirtinta su išlyga.', createdBy: 7 },
    ]);

    expect(jest.mocked(notifyOnFileGenerated).mock.calls[0][5]).toBe('Patvirtinta su išlyga.');
  });

  it('carries no note when the approval came with none', async () => {
    await notifyWith(authoredRequest, author, [{ comment: '', createdBy: 7 }]);

    expect(jest.mocked(notifyOnFileGenerated).mock.calls[0][5]).toBeUndefined();
  });
});

describe('getGeojson', () => {
  const feature = () => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [582000, 6061000] } as Record<string, unknown>,
    properties: {},
  });

  type RequestData = Awaited<ReturnType<typeof getRequestData>>;

  const buildGeojson = async (): Promise<Geojson> => {
    const requestData = {
      speciesById: {},
      places: [
        {
          id: 7,
          species: 1,
          placeCode: 'RAD-1',
          geom: { features: [feature()] },
          forms: [{ id: 11, geom: { features: [feature()] } }],
        },
      ],
      informationalForms: {
        1: { forms: [{ id: 12, species: 1, geom: { features: [feature()] } }] },
      },
    };
    jest.mocked(getRequestData).mockResolvedValue(requestData as unknown as RequestData);

    return getGeojson.call(
      {},
      {
        params: { id: 42 },
        meta: {},
        call: jest.fn().mockResolvedValue(approvedRequest),
      },
    );
  };

  it('declares the Lithuanian CRS for the file, so GIS software reads it as LKS-94', async () => {
    const geojson = await buildGeojson();

    expect(geojson.crs).toEqual(LKS_94_CRS);
  });

  it('leaves no CRS on the geometries, where the GeoJSON readers ignore it', async () => {
    const geojson = await buildGeojson();

    expect(geojson.features.map((item) => 'crs' in item.geometry)).toEqual([false, false, false]);
  });
});
