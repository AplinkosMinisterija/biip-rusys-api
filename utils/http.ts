import { IncomingMessage, request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

// No timeout of any kind, where node's global fetch hides a 300s one: tools answers only once ogr2ogr is done, and a conversion of real size is never cut short.
export function postJson(url: string, body: unknown): Promise<IncomingMessage> {
  const payload = Buffer.from(JSON.stringify(body));
  const send = url.startsWith('https:') ? httpsRequest : httpRequest;

  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      resolve,
    );

    request.on('error', reject);
    request.end(payload);
  });
}

export async function readText(stream: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}
