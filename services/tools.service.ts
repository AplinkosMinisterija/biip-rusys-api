'use strict';

import { createHash } from 'crypto';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

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
    }>
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
        .catch((err) =>
          reject(err?.message || 'Error while getting screenshot')
        );
    });
  }

  @Method
  toolsHost() {
    return process.env.TOOLS_HOST || 'https://internalapi.biip.lt/tools';
  }
}
