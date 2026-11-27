import { ServiceBroker } from 'moleculer';
import JobsService from './jobs.service';

const createJobsService = (Service: typeof JobsService = JobsService) => {
  const broker = new ServiceBroker({ logger: false });
  // The mixin only reads the connection options here; nothing connects until the broker starts.
  Object.assign(broker, { cacher: { client: { options: {} } } });
  return broker.createService(Service);
};

const workerConcurrencyWith = (value: string | undefined) => {
  const original = process.env.SCREENSHOT_CONCURRENCY;
  if (value === undefined) delete process.env.SCREENSHOT_CONCURRENCY;
  else process.env.SCREENSHOT_CONCURRENCY = value;

  let concurrency: unknown;
  jest.isolateModules(() => {
    const { default: Isolated } =
      jest.requireActual<{ default: typeof JobsService }>('./jobs.service');
    concurrency = createJobsService(Isolated).settings.bullmq.worker.concurrency;
  });

  if (original === undefined) delete process.env.SCREENSHOT_CONCURRENCY;
  else process.env.SCREENSHOT_CONCURRENCY = original;
  return concurrency;
};

describe('jobs service', () => {
  it('reads screenshot concurrency from SCREENSHOT_CONCURRENCY', () => {
    expect(workerConcurrencyWith('8')).toBe(8);
    expect(workerConcurrencyWith(undefined)).toBe(5);
  });

  it('keeps 5 when SCREENSHOT_CONCURRENCY is not a positive number', () => {
    expect(workerConcurrencyWith('-1')).toBe(5);
    expect(workerConcurrencyWith('abc')).toBe(5);
  });
});
