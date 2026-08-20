'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { toReadableStream } from '../utils/functions';
import type { VectorExportPayload } from '../utils/vector-export/requests';

// Runtime validation schema for VectorExportPayload. The tools /gdb and /gpkg
// endpoints deliberately accept identical bodies (see biip-tools
// vectorExportParams) — callers switch format by URL only.
const VECTOR_EXPORT_PARAMS = {
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
};

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
        .then((r) => {
          // Without this the error body is uploaded as a .jpeg, MinIO reports it
          // as too small and the job fails with the useless "Screenshot is emtpy".
          if (!r.ok) {
            throw new Error(`Screenshot service responded with ${r.status}`);
          }
          return stream ? r.body?.getReader() : (r.text() as any);
        })
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
        .then((r) => {
          if (!r.ok) {
            throw new Error(`PDF service responded with ${r.status}`);
          }
          return r.body?.getReader();
        })
        .then(resolve)
        .catch((err) => {
          console.error(err);
          reject(err?.message || 'Error while getting pdf');
        });
    });
  }

  @Action({
    params: VECTOR_EXPORT_PARAMS,
    timeout: 0,
  })
  async makeGdb(ctx: Context<VectorExportPayload>): Promise<NodeJS.ReadableStream> {
    return this.fetchVectorExport('/gdb', ctx.params);
  }

  @Action({
    params: VECTOR_EXPORT_PARAMS,
    timeout: 0,
  })
  async makeGpkg(ctx: Context<VectorExportPayload>): Promise<NodeJS.ReadableStream> {
    return this.fetchVectorExport('/gpkg', ctx.params);
  }

  @Method
  async fetchVectorExport(
    path: '/gdb' | '/gpkg',
    params: VectorExportPayload,
  ): Promise<NodeJS.ReadableStream> {
    const { layers, name, srid } = params;
    const response = await fetch(`${this.toolsHost()}${path}`, {
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
      throw new Error(`tools ${path} returned ${response.status}: ${detail || '<empty body>'}`);
    }

    // A body-less 2xx must fail loudly — passing undefined into
    // toReadableStream produces a stream that never ends, and the MinIO
    // upload would hang forever under timeout: 0.
    if (!response.body) {
      throw new Error(`tools ${path} returned ${response.status} with an empty body`);
    }

    // fetch gives back a web ReadableStream, which minio-js cannot consume —
    // convert to a Node Readable so the file streams straight to the MinIO
    // upload without buffering.
    return toReadableStream(response.body.getReader());
  }

  @Method
  toolsHost() {
    return process.env.TOOLS_HOST || 'https://internalapi.biip.lt/tools';
  }
}
