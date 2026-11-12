jest.mock('../utils/mails', () => ({
  emailCanBeSent: () => true,
  notifyOnFileGenerated: jest.fn(),
  notifyOnRequestUpdate: jest.fn(),
}));

import { notifyOnFileGenerated } from '../utils/mails';
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

const {
  saveGeneratedFile,
  initiateDocumentGenerate,
  sendNotificationOnFileGenerated,
  getApprovalComment,
} = RequestsService.prototype as unknown as {
  saveGeneratedFile: SaveGeneratedFile;
  initiateDocumentGenerate: InitiateDocumentGenerate;
  sendNotificationOnFileGenerated: SendNotificationOnFileGenerated;
  getApprovalComment: unknown;
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
