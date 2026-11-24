'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { postJson, readText } from '../utils/http';
import type { VectorExportLayerSource } from '../utils/vector-export/requests';

// The layer travels as a presigned url: a 300k-feature collection is ~130MB, well past the gateway's body limit.
interface VectorExportPayload {
  layers: VectorExportLayerSource[];
  name: string;
  srid: number;
}

// Every tools vector endpoint takes the same body; the format is the URL.
const VECTOR_EXPORT_PARAMS = {
  layers: {
    type: 'array',
    items: {
      type: 'object',
      props: {
        name: 'string',
        url: 'string',
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
    visibility: 'protected',
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
    // Every action here takes a url and fetches it; the gateway whitelists `**`, so without this they are callable by any authenticated request.
    visibility: 'protected',
    timeout: 0,
  })
  async makePdf(
    ctx: Context<{ url: string; header?: string; footer?: string }>,
  ): Promise<NodeJS.ReadableStream> {
    const { url, footer, header } = ctx.params;

    // Not `fetch`: undici abandons a response after 300s of waiting for headers, and tools takes minutes to print a large request.
    return this.postToTools('/pdf', {
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
    });
  }

  @Action({
    params: VECTOR_EXPORT_PARAMS,
    visibility: 'protected',
    timeout: 0,
  })
  async makeShp(ctx: Context<VectorExportPayload>): Promise<NodeJS.ReadableStream> {
    return this.fetchVectorExport('/shp', ctx.params);
  }

  @Action({
    params: VECTOR_EXPORT_PARAMS,
    visibility: 'protected',
    timeout: 0,
  })
  async makeGdb(ctx: Context<VectorExportPayload>): Promise<NodeJS.ReadableStream> {
    return this.fetchVectorExport('/gdb', ctx.params);
  }

  @Action({
    params: VECTOR_EXPORT_PARAMS,
    visibility: 'protected',
    timeout: 0,
  })
  async makeGpkg(ctx: Context<VectorExportPayload>): Promise<NodeJS.ReadableStream> {
    return this.fetchVectorExport('/gpkg', ctx.params);
  }

  @Method
  async fetchVectorExport(
    path: '/gdb' | '/gpkg' | '/shp',
    params: VectorExportPayload,
  ): Promise<NodeJS.ReadableStream> {
    const { layers, name, srid } = params;
    // Not `fetch`: undici abandons a response after 300s of waiting for headers, and tools answers only once ogr2ogr is done.
    return this.postToTools(path, { layers, name, srid });
  }

  @Method
  async postToTools(path: string, body: unknown): Promise<NodeJS.ReadableStream> {
    const response = await postJson(`${this.toolsHost()}${path}`, body);
    const status = response.statusCode || 0;

    if (status < 200 || status > 299) {
      const detail = await readText(response).catch(() => '');
      throw new Error(`tools ${path} returned ${status}: ${detail || '<empty body>'}`);
    }

    return response;
  }

  @Method
  toolsHost() {
    return process.env.TOOLS_HOST || 'https://internalapi.biip.lt/tools';
  }
}
