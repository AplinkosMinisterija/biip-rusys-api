'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { buildGdbPayload, validateGdbData } from '../utils/gdb/requests';
import { getRequestData } from '../utils/pdf/requests';
import { Request } from './requests.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';
import { FILE_TYPES } from '../types';

@Service({
  name: 'gdb.requests',
  settings: {},
})
export default class GdbRequestsService extends moleculer.Service {
  public logger: any;

  created() {
    this.logger = this.broker.getLocalService('gdb.requests')?.logger || console;
  }

  private getFolderName(user: User, tenant?: Tenant): string {
    if (tenant?.id) {
      return `rusys/uploads/requests/private/${tenant.id}`;
    }
    if (user?.id) {
      return `rusys/uploads/requests/private/${user.id}`;
    }
    return 'rusys/uploads/requests/private';
  }

  @Action({
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
      this.logger.debug(`[GDB] Step 1/6: Resolving request ${id}`);
      const request: Request = await ctx.call('requests.resolve', {
        id,
        populate: 'createdBy,tenant,geom',
      });

      if (!request?.id) {
        this.logger.warn(`[GDB] ❌ Step 1 FAILED: No request found with id ${id}`);
        return { skipped: 'no-request' };
      }
      this.logger.debug(`[GDB] ✓ Step 1 OK: Request ${id} resolved (status=${request.status})`);

      console.log({ ctx });
      // Step 2: Load request data
      this.logger.debug(`[GDB] Step 2/6: Loading request data for request ${id}`);
      const requestData = await getRequestData(ctx, id, {
        loadPlaces: true,
        loadLegend: false,
        loadInformationalForms: true,
      });

      console.log({ requestData });
      // Validate data
      const validation = await validateGdbData(requestData);
      if (!validation.valid) {
        this.logger.warn(`[GDB] ❌ Step 2 FAILED: ${validation.message}`);
        return { skipped: 'no-data', reason: validation.message };
      }

      const placesCount = requestData?.places?.length || 0;
      const observationsCount = Object.values(requestData?.informationalForms || {}).reduce(
        (sum: number, group: any) => sum + (group.forms?.length || 0),
        0,
      );

      this.logger.debug(
        `[GDB] ✓ Step 2 OK: Loaded places=${placesCount}, observations=${observationsCount}`,
      );

      // Step 3: Build GDB payload
      this.logger.debug(`[GDB] Step 3/6: Building GDB payload`);
      const gdbPayload = await buildGdbPayload(ctx, request, requestData);

      const totalFeatures = gdbPayload.layers.reduce(
        (sum: number, layer: any) => sum + layer.geojson.features.length,
        0,
      );

      this.logger.debug(
        `[GDB] ✓ Step 3 OK: Built ${gdbPayload.layers.length} layers with ${totalFeatures} total features`,
      );

      gdbPayload.layers.forEach((layer: any, idx: number) => {
        this.logger.debug(
          `[GDB]   Layer ${idx + 1}: ${layer.name} (${layer.geojson.features.length} features)`,
        );
      });

      // Step 4: Call tools.makeGdb
      this.logger.debug(`[GDB] Step 4/6: Calling tools.makeGdb`);
      const stream = (await ctx.call('tools.makeGdb', gdbPayload).catch((err: any) => {
        this.logger.error(`[GDB] ❌ Step 4 FAILED: tools.makeGdb error for request ${id}`, {
          error: err.message,
          code: err.code,
          status: err.status,
        });
        throw err;
      })) as NodeJS.ReadableStream;

      this.logger.debug(`[GDB] ✓ Step 4 OK: Received stream from tools.makeGdb`);

      // Step 5: Upload to MinIO
      const folder = this.getFolderName(
        request?.createdBy as any as User,
        request?.tenant as Tenant,
      );
      this.logger.debug(`[GDB] Step 5/6: Uploading GDB to MinIO (folder=${folder})`);

      const result: any = await ctx
        .call(
          'minio.uploadFile',
          {
            payload: stream,
            folder,
            isPrivate: true,
            types: FILE_TYPES,
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
          this.logger.error(`[GDB] ❌ Step 5 FAILED: MinIO upload error for request ${id}`, {
            error: err.message,
            folder,
          });
          throw err;
        });

      this.logger.debug(`[GDB] ✓ Step 5 OK: File uploaded to MinIO`);
      this.logger.info(`[GDB] File URL: ${result.url}`);

      // Step 6: Save URL to database
      this.logger.debug(`[GDB] Step 6/6: Saving GDB URL to database`);
      await ctx.call('requests.saveGeneratedGdb', { id, url: result.url }).catch((err: any) => {
        this.logger.error(`[GDB] ❌ Step 6 FAILED: Database save error for request ${id}`, {
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
        error: error.message,
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

    const requestData = await getRequestData(ctx, id, {
      loadPlaces: true,
      loadLegend: false,
      loadInformationalForms: true,
    });

    const validation = await validateGdbData(requestData);

    return {
      valid: validation.valid,
      message: validation.message,
      requestId: id,
    };
  }
}
