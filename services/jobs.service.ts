'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import moment from 'moment';
import BullMqMixin from '../mixins/bullmq.mixin';
import { toReadableStream } from '../utils/functions';

@Service({
  name: 'jobs',
  mixins: [BullMqMixin],
  settings: {
    bullmq: {
      worker: { concurrency: 5 },
      job: {
        attempts: 10,
        backoff: 1000,
      },
    },
  },
})
export default class JobsService extends moleculer.Service {
  @Action({
    queue: true,
    params: {
      url: 'string',
      hash: 'string',
      data: {
        type: 'object',
        optional: true,
      },
      waitFor: {
        type: 'string',
        optional: true,
      },
    },
    timeout: 0,
  })
  async saveScreenshot(
    ctx: Context<{
      url: string;
      hash: string;
      waitFor: string;
      data: { [key: string]: any };
    }>,
  ) {
    const { url, hash, data, waitFor } = ctx.params;
    const { job } = ctx.locals;

    const folder = 'temp/screenshots';

    async function getHashedFileUrl() {
      if (!hash) return;

      const objectName = `${folder}/${hash}.jpeg`;
      const fileData: any = await ctx.call('minio.fileStat', {
        objectName,
      });

      if (!fileData?.exists) return;

      const uploadedBeforeDays = moment().diff(moment(fileData.lastModified), 'days');

      if (uploadedBeforeDays > 5) return;

      return fileData.presignedUrl;
      // TODO: remove
      // return fileData.privateUrl?.replace('127.0.0.1', 'host.docker.internal');
    }

    let screenshotUrl = await getHashedFileUrl();

    if (!screenshotUrl) {
      const screenshot = await ctx.call('tools.makeScreenshot', {
        url,
        waitFor,
        stream: true,
      });

      await ctx.call(
        'minio.uploadFile',
        {
          payload: toReadableStream(screenshot),
          folder,
          name: hash,
          isPrivate: true,
        },
        {
          meta: {
            mimetype: 'image/jpeg',
            filename: 'screenshot.jpeg',
          },
        },
      );

      screenshotUrl = await getHashedFileUrl();
      if (!screenshotUrl) {
        throw new Error(`Screenshot for url ${url} is empty`);
      }
    }

    return {
      job: job.id,
      url: screenshotUrl || '',
      hash,
      data: data || {},
    };
  }
}
