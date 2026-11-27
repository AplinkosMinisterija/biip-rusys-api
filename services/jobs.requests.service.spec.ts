jest.mock('../utils/pdf/requests', () => ({
  getRequestData: jest.fn().mockResolvedValue({
    id: 7,
    previewScreenshotHash: 'preview',
    places: [{ id: 1, hash: 'place-1' }],
    informationalForms: { 3: { hash: 'forms-3', forms: [{ id: 30 }] } },
  }),
  getMapsSearchParams: jest.fn().mockResolvedValue(new URLSearchParams()),
}));

const addedFlows: Array<{ children: Array<{ opts: object }> }> = [];
jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  FlowProducer: jest.fn().mockImplementation(() => ({
    add: (tree: { children: Array<{ opts: object }> }) => addedFlows.push(tree),
  })),
}));

import { Context, ServiceBroker } from 'moleculer';
import JobsRequestsService from './jobs.requests.service';

type InitiatePdfGenerate = (this: unknown, ctx: Context<{ id: number }>) => Promise<unknown>;

const { initiatePdfGenerate } = JobsRequestsService.prototype as unknown as {
  initiatePdfGenerate: InitiatePdfGenerate;
};

describe('initiatePdfGenerate', () => {
  it('gives every screenshot three attempts with a growing pause', async () => {
    const broker = new ServiceBroker({ logger: false });
    // The mixin only reads the connection options here; nothing connects until the broker starts.
    Object.assign(broker, { cacher: { client: { options: {} } } });
    const service = broker.createService(JobsRequestsService);
    const ctx = Context.create(broker, null, { id: 7 });

    await initiatePdfGenerate.call(service, ctx as Context<{ id: number }>);

    const childOptions = addedFlows[0].children.map(({ opts }) => opts);
    expect(childOptions).toHaveLength(3);
    childOptions.forEach((opts) =>
      expect(opts).toEqual({
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeDependencyOnFailure: true,
      }),
    );
  });
});
