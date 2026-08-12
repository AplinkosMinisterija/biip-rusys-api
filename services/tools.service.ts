'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { toReadableStream } from '../utils/functions';

@Service({
  name: 'tools',
})
export default class ToolsService extends moleculer.Service {
  @Action({
    params: {
      url: 'string',
      stream: {
        type: 'boolean',
        default: false,
      },
      encoding: {
        type: 'string',
        enum: ['binary', 'base64'],
        default: 'binary',
      },
      waitFor: {
        type: 'string',
        optional: true,
      },
    },
    timeout: 0,
  })
  async makeScreenshot(
    ctx: Context<{
      url: string;
      stream: boolean;
      encoding: string;
      waitFor: string;
    }>,
  ) {
    const { url, stream, encoding, waitFor } = ctx.params;
    const searchParams = new URLSearchParams({
      quality: '75',
      url: url,
      type: 'jpeg',
      encoding,
    });

    if (waitFor) {
      searchParams.set('waitFor', waitFor);
    }

    const screenshotEndpoint = `${this.toolsHost()}/screenshot`;
    return new Promise(async (resolve, reject) => {
      fetch(`${screenshotEndpoint}?${searchParams.toString()}`, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      })
        .then((r) => (stream ? r.body?.getReader() : (r.text() as any)))
        .then(resolve)
        .catch((err) => {
          console.error(err);
          reject(err?.message || 'Error while getting screenshot');
        });
    });
  }

  @Action({
    params: {
      url: 'string',
      footer: {
        type: 'string',
        optional: true,
      },
      header: {
        type: 'string',
        optional: true,
      },
    },
    timeout: 0,
  })
  async makePdf(ctx: Context<{ url: string; header?: string; footer?: string }>) {
    const { url, footer, header } = ctx.params;

    const pdfEndpoint = `${this.toolsHost()}/pdf`;

    return new Promise(async (resolve, reject) => {
      fetch(pdfEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          url,
          height: 877,
          width: 620,
          footer,
          header,
          margin: {
            top: 50,
            bottom: 50,
            left: 50,
            right: 50,
          },
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      })
        .then((r) => r.body?.getReader())
        .then(resolve)
        .catch((err) => {
          console.error(err);
          reject(err?.message || 'Error while getting pdf');
        });
    });
  }

  @Action({
    params: {
      layers: {
        type: 'array',
        items: {
          type: 'object',
          props: {
            name: 'string',
            geojson: 'object',
            fields: 'array',
          },
        },
      },
      name: 'string',
      srid: 'number',
    },
    timeout: 0,
  })
  async makeGdb(
    ctx: Context<{
      layers: Array<{
        name: string;
        geojson: any;
        fields: any[];
      }>;
      name: string;
      srid: number;
    }>,
  ): Promise<NodeJS.ReadableStream> {
    const { layers, name, srid } = ctx.params;

    const gdbEndpoint = `${this.toolsHost()}/gdb`;

    const response = await fetch(gdbEndpoint, {
      method: 'POST',
      body: JSON.stringify({
        layers,
        name,
        srid,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`tools /gdb returned ${response.status}: ${detail || '<empty body>'}`);
    }

    // fetch gives back a web ReadableStream, which minio-js cannot consume —
    // convert to a Node Readable so the ZIP streams straight to the MinIO
    // upload without buffering.
    return toReadableStream(response.body?.getReader());
  }

  @Method
  toolsHost() {
    return process.env.TOOLS_HOST || 'https://internalapi.biip.lt/tools';
  }
}
