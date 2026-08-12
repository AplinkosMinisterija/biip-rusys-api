'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import BullMqMixin from '../mixins/bullmq.mixin';
import { buildGdbPayload, getGdbRequestData, validateGdbData } from '../utils/gdb/requests';
import { getRequestFolderName } from '../utils/requests';
import { Request } from './requests.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';
import { ZIP_FILE_TYPES } from '../types';

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
    const { id } = ctx.params;
    const startTime = Date.now();

    this.logger.info(`[GDB] 🟢 Generation STARTED for request ${id}`);

    try {
      // Step 1: Resolve request
      this.logger.debug(`[GDB] Step 1/5: Resolving request ${id}`);
      const request: Request = await ctx.call('requests.resolve', {
        id,
        populate: 'createdBy,tenant,geom',
      });

      if (!request?.id) {
        this.logger.warn(`[GDB] ⏭️ Step 1 SKIPPED: No request found with id ${id}`);
        return { skipped: 'no-request' };
      }
      this.logger.debug(`[GDB] ✓ Step 1 OK: Request ${id} resolved (status=${request.status})`);

      // Step 2: Load request data
      this.logger.debug(`[GDB] Step 2/5: Loading request data for request ${id}`);
      const requestData = await getGdbRequestData(ctx, id);

      // Validate data
      const validation = validateGdbData(requestData);
      if (!validation.valid) {
        this.logger.warn(`[GDB] ⏭️ Step 2 SKIPPED: ${validation.message}`);
        return { skipped: 'no-data', reason: validation.message };
      }

      this.logger.debug(
        `[GDB] ✓ Step 2 OK: Loaded places=${validation.placesCount}, observations=${validation.observationsCount}`,
      );

      // Step 3: Build GDB payload
      this.logger.debug(`[GDB] Step 3/5: Building GDB payload`);
      const gdbPayload = buildGdbPayload(request, requestData);

      const totalFeatures = gdbPayload.layers.reduce(
        (sum: number, layer: any) => sum + layer.geojson.features.length,
        0,
      );

      this.logger.info(
        `[GDB] ✓ Step 3 OK: Built ${gdbPayload.layers.length} layers with ${totalFeatures} total features`,
      );

      gdbPayload.layers.forEach((layer: any, idx: number) => {
        this.logger.debug(
          `[GDB]   Layer ${idx + 1}: ${layer.name} (${layer.geojson.features.length} features, ${
            layer.fields.length
          } fields)`,
        );
      });

      // Step 4: Call tools.makeGdb
      // tools.makeGdb streams the ZIP back as a Node Readable (no buffering).
      // A failure here MUST surface — historically the BullMQ retry loop
      // ate the rejection and the request stayed in limbo. We rethrow so
      // BullMQ marks the job failed and the request stays observably broken
      // instead of silently appearing successful.
      this.logger.debug(`[GDB] Step 4/5: Calling tools.makeGdb`);
      const stream: NodeJS.ReadableStream = await ctx
        .call('tools.makeGdb', gdbPayload)
        .then((s) => s as NodeJS.ReadableStream)
        .catch((err: any) => {
          this.logger.error(
            `tools.makeGdb failed for request ${id} ` +
              `(${gdbPayload.layers.length} layer(s): ${gdbPayload.layers
                .map((l) => `${l.name}=${l.geojson.features.length}`)
                .join(', ')})`,
            err,
          );
          throw err;
        });

      this.logger.debug(`[GDB] ✓ Step 4 OK: Received stream from tools.makeGdb`);

      // Step 5: Upload to MinIO
      const folder = getRequestFolderName(
        request?.createdBy as any as User,
        request?.tenant as Tenant,
      );
      this.logger.debug(`[GDB] Step 5/5: Uploading GDB to MinIO (folder=${folder})`);

      const result: any = await ctx
        .call(
          'minio.uploadFile',
          {
            payload: stream,
            folder,
            isPrivate: true,
            types: ZIP_FILE_TYPES,
            name: `israsas-${request.id}`,
          },
          {
            meta: {
              mimetype: 'application/zip',
              filename: `israsas-${request.id}.zip`,
            },
          },
        )
        .catch((err: any) => {
          this.logger.error(`minio.uploadFile failed for request ${id}`, {
            error: err.message,
            folder,
          });
          throw err;
        });

      this.logger.info(`[GDB] ✓ Step 5 OK: File uploaded to MinIO at ${result.url}`);

      // Save URL to database
      await ctx.call('requests.saveGeneratedGdb', { id, url: result.url }).catch((err: any) => {
        this.logger.error(`requests.saveGeneratedGdb failed for request ${id}`, {
          error: err.message,
        });
        throw err;
      });

      const elapsed = Date.now() - startTime;
      this.logger.info(
        `[GDB] ✅ Generation COMPLETED in ${elapsed}ms (${(elapsed / 1000).toFixed(
          2,
        )}s) for request ${id}`,
      );

      return { generated: true, url: result.url };
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      this.logger.error(`[GDB] 🔴 Generation FAILED after ${elapsed}ms for request ${id}`, {
        message: error.message,
        stack: error.stack,
      });
      throw error;
    }
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
    const { id } = ctx.params;

    this.logger.debug(`[GDB-VALIDATE] Validating request ${id}`);

    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant',
    });

    if (!request?.id) {
      return { valid: false, reason: 'Request not found' };
    }

    const requestData = await getGdbRequestData(ctx, id);

    const validation = validateGdbData(requestData);

    return {
      valid: validation.valid,
      message: validation.message,
      requestId: id,
    };
  }
}
