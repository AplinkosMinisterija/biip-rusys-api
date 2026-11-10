import { Context, ServiceSchema } from 'moleculer';
import BullMqMixin from '../../mixins/bullmq.mixin';
import { generateAndSaveVectorExport, VectorExportFormat } from './generate';

// Action names are passed in, not derived, so a call site like
// `gdb.requests.initiateGdbGenerate` stays greppable.
export function createVectorExportRequestsService(
  name: string,
  format: VectorExportFormat,
  actionNames: { generate: string; initiate: string },
): ServiceSchema {
  return {
    name,
    mixins: [BullMqMixin],
    settings: {
      bullmq: {
        // One at a time per format: ogr2ogr runs in the shared 512M tools
        // container, which also serves UETK, and three formats already queue
        // in parallel.
        worker: { concurrency: 1 },
        job: {
          attempts: 5,
          failParentOnFailure: true,
          backoff: 1000,
        },
      },
    },
    actions: {
      [actionNames.generate]: {
        queue: true,
        params: {
          id: 'number',
        },
        timeout: 0,
        visibility: 'protected',
        handler(ctx: Context<{ id: number }>) {
          return generateAndSaveVectorExport(ctx, this.logger, ctx.params.id, format);
        },
      },
      [actionNames.initiate]: {
        params: {
          id: 'number',
        },
        timeout: 0,
        visibility: 'protected',
        async handler(ctx: Context<{ id: number }>) {
          const job = await this.localQueue(ctx, actionNames.generate, { id: ctx.params.id });
          this.logger.info(
            `[${format.label}] Job initiated for request ${ctx.params.id} with job id ${job.id}`,
          );
          return { job: { id: job.id } };
        },
      },
    },
  };
}
