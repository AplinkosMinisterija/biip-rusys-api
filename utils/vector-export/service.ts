import { Context, ServiceSchema } from 'moleculer';
import BullMqMixin from '../../mixins/bullmq.mixin';
import { generateAndSaveVectorExport, VectorExportFormat } from './generate';

// Builds a per-format BullMQ worker service (gdb.requests, gpkg.requests).
// Every format needs the same two actions — a queued generate worker and an
// initiate action that enqueues it — with identical retry settings; only the
// format config and the action names differ. Action names are passed in
// explicitly so callers like `gdb.requests.initiateGdbGenerate` stay greppable.
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
        worker: { concurrency: 5 },
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
        handler(ctx: Context<{ id: number }>) {
          return generateAndSaveVectorExport(ctx, this.logger, ctx.params.id, format);
        },
      },
      [actionNames.initiate]: {
        params: {
          id: 'number',
        },
        timeout: 0,
        // Single queued job — BullMQ retry semantics come from settings.bullmq.job.
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
