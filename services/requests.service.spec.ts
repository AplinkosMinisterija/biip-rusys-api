import RequestsService, {
  Request,
  RequestDocumentType,
  RequestStatus,
  RequestType,
} from './requests.service';

type GenerateDocumentsIfNeeded = (this: unknown, request: Request) => void;

const generateDocumentsIfNeeded = (
  RequestsService.prototype as unknown as {
    generateDocumentsIfNeeded: GenerateDocumentsIfNeeded;
  }
).generateDocumentsIfNeeded;

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
