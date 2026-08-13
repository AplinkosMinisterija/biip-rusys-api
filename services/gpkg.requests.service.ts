'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import BullMqMixin from '../mixins/bullmq.mixin';
import {
  GPKG_EXPORT_FORMAT,
  generateAndSaveVectorExport,
  validateVectorExportRequest,
} from '../utils/vector-export/generate';

@Service({
  name: 'gpkg.requests',
  mixins: [BullMqMixin],
  settings: {
    bullmq: {
      worker: { concurrency: 5 },
      job: {
        attempts: 5,
        failParentOnFailure: true,
        backoff: 1000,
      },
    },
  },
})
export default class GpkgRequestsService extends moleculer.Service {
  @Action({
    queue: true,
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async generateAndSaveGpkg(ctx: Context<{ id: number }>) {
    return generateAndSaveVectorExport(ctx, this.logger, ctx.params.id, GPKG_EXPORT_FORMAT);
  }

  @Action({
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async initiateGpkgGenerate(ctx: Context<{ id: number }>) {
    // Single queued job — BullMQ retry semantics inherited from the mixin
    // (5 attempts, 1s backoff), same as the GDB flow.
    const job = await this.localQueue(ctx, 'generateAndSaveGpkg', {
      id: ctx.params.id,
    });
    this.logger.info(`[GPKG] Job initiated for request ${ctx.params.id} with job id ${job.id}`);
    return { job: { id: job.id } };
  }

  @Action({
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async validateGpkgRequest(ctx: Context<{ id: number }>) {
    return validateVectorExportRequest(ctx, this.logger, ctx.params.id, GPKG_EXPORT_FORMAT);
  }
}
