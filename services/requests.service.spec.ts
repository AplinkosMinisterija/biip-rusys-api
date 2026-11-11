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

const { saveGeneratedFile, initiateDocumentGenerate } = RequestsService.prototype as unknown as {
  saveGeneratedFile: SaveGeneratedFile;
  initiateDocumentGenerate: InitiateDocumentGenerate;
};

const approvedRequest = {
  id: 42,
  status: RequestStatus.APPROVED,
  type: RequestType.GET_ONCE,
  documentTypes: Object.values(RequestDocumentType),
} as Request;

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
