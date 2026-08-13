'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import BullMqMixin from '../mixins/bullmq.mixin';
import {
  GDB_EXPORT_FORMAT,
  generateAndSaveVectorExport,
  validateVectorExportRequest,
} from '../utils/vector-export/generate';

@Service({
  name: 'gdb.requests',
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
export default class GdbRequestsService extends moleculer.Service {
  @Action({
    queue: true,
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async generateAndSaveGdb(ctx: Context<{ id: number }>) {
    return generateAndSaveVectorExport(ctx, this.logger, ctx.params.id, GDB_EXPORT_FORMAT);
  }

  @Action({
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async initiateGdbGenerate(ctx: Context<{ id: number }>) {
    // No preprocessing needed for GDB — single queued job with
    // BullMQ retry semantics inherited from the mixin (5 attempts, 1s
    // backoff). Same as initiateGeoJsonGenerate in biip-uetk-api.
    const job = await this.localQueue(ctx, 'generateAndSaveGdb', {
      id: ctx.params.id,
    });
    this.logger.info(`[GDB] Job initiated for request ${ctx.params.id} with job id ${job.id}`);
    return { job: { id: job.id } };
  }

  @Action({
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async validateGdbRequest(ctx: Context<{ id: number }>) {
    return validateVectorExportRequest(ctx, this.logger, ctx.params.id, GDB_EXPORT_FORMAT);
  }
}
