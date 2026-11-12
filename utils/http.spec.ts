import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { postJson, readText } from './http';

describe('postJson', () => {
  let server: Server;
  let origin: string;
  let received: { body: string; contentType?: string; method?: string };
  let respond: (res: Parameters<Parameters<typeof createServer>[1]>[1]) => void;

  beforeEach(async () => {
    received = { body: '' };
    respond = (res) => res.end('ok');
    server = createServer((req, res) => {
      received.method = req.method;
      received.contentType = req.headers['content-type'];
      req.on('data', (chunk) => (received.body += chunk));
      req.on('end', () => respond(res));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('posts the body as json and hands back the response as a node stream', async () => {
    respond = (res) => res.end('the-zip-bytes');

    const response = await postJson(`${origin}/shp`, { layers: [{ name: 'Radavietes' }] });

    expect(received.method).toBe('POST');
    expect(received.contentType).toBe('application/json');
    expect(JSON.parse(received.body)).toEqual({ layers: [{ name: 'Radavietes' }] });
    expect(response.statusCode).toBe(200);
    expect(await readText(response)).toBe('the-zip-bytes');
  });

  it('hands back a failing status with its body instead of throwing', async () => {
    respond = (res) => {
      res.writeHead(413);
      res.end('source too large');
    };

    const response = await postJson(`${origin}/gdb`, {});

    expect(response.statusCode).toBe(413);
    expect(await readText(response)).toBe('source too large');
  });

  it('keeps waiting while the server takes its time to answer', async () => {
    respond = (res) => setTimeout(() => res.end('late'), 300);

    const response: IncomingMessage = await postJson(`${origin}/gpkg`, {});

    expect(await readText(response)).toBe('late');
  });

  it('rejects when the host cannot be reached', async () => {
    await new Promise((resolve) => server.close(resolve));

    await expect(postJson(`${origin}/shp`, {})).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});
