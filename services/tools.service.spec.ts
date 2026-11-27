import { createServer, ServerResponse, Server } from 'http';
import { ServiceBroker } from 'moleculer';
import { AddressInfo } from 'net';
import ToolsService from './tools.service';

const readAll = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
};

describe('tools service', () => {
  const originalToolsHost = process.env.TOOLS_HOST;
  const pdfBytes = Buffer.from('%PDF-1.7 synthetic \x00\x01\xff bytes');

  let server: Server;
  let broker: ServiceBroker;
  let received: { body: string; path?: string; method?: string };
  let respond: (res: ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => {
      received.method = req.method;
      received.path = req.url;
      req.on('data', (chunk) => (received.body += chunk));
      req.on('end', () => respond(res));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.TOOLS_HOST = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    broker = new ServiceBroker({ logger: false });
    broker.createService(ToolsService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    await new Promise((resolve) => server.close(resolve));
    if (originalToolsHost === undefined) {
      delete process.env.TOOLS_HOST;
    } else {
      process.env.TOOLS_HOST = originalToolsHost;
    }
  });

  beforeEach(() => {
    received = { body: '' };
    respond = (res) => res.end(pdfBytes);
  });

  // The actions are protected, so they are called the way a sibling service does.
  const call = (action: string, params: unknown) =>
    broker.call(action, params, { timeout: 0 }) as Promise<NodeJS.ReadableStream>;

  describe('makeScreenshot', () => {
    // makeScreenshot uses the global fetch, which jest's node environment does not provide.
    afterAll(() => {
      delete (global as { fetch?: typeof fetch }).fetch;
    });

    it('rejects a refused browserless session so the job retries', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;

      await expect(
        call('tools.makeScreenshot', { url: 'http://example.test/map' }),
      ).rejects.toThrow('Screenshot service responded with 429');
    });
  });

  describe('makePdf', () => {
    it('posts the page to /pdf and hands back the pdf bytes as a node stream', async () => {
      const pdf = await call('tools.makePdf', {
        url: 'http://example.test/page',
        footer: '<b>1</b>',
      });

      expect(received.method).toBe('POST');
      expect(received.path).toBe('/pdf');
      expect(JSON.parse(received.body)).toEqual({
        url: 'http://example.test/page',
        footer: '<b>1</b>',
        height: 877,
        width: 620,
        margin: { top: 50, bottom: 50, left: 50, right: 50 },
      });
      expect(typeof pdf.pipe).toBe('function');
      expect((await readAll(pdf)).equals(pdfBytes)).toBe(true);
    });

    it('waits for a slow answer instead of giving up', async () => {
      respond = (res) => setTimeout(() => res.end(pdfBytes), 300);

      const pdf = await call('tools.makePdf', { url: 'http://example.test/large' });

      expect((await readAll(pdf)).equals(pdfBytes)).toBe(true);
    });

    it('rejects with an Error carrying the status and body of a failing answer', async () => {
      respond = (res) => {
        res.writeHead(500);
        res.end('chromium crashed');
      };

      const error = await call('tools.makePdf', { url: 'http://example.test/page' }).catch(
        (e) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('/pdf');
      expect(error.message).toContain('500');
      expect(error.message).toContain('chromium crashed');
    });
  });

  describe('vector exports', () => {
    it('still reject with the status and body of a failing answer', async () => {
      respond = (res) => {
        res.writeHead(413);
        res.end('source too large');
      };

      const error = await call('tools.makeShp', { layers: [], name: 'test', srid: 3346 }).catch(
        (e) => e,
      );

      expect(received.path).toBe('/shp');
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('tools /shp returned 413: source too large');
    });
  });
});
