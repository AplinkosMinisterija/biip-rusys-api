import { Context, LoggerInstance } from 'moleculer';
import { getRequestFolderName } from '../requests';
import { Request } from '../../services/requests.service';
import { Tenant } from '../../services/tenants.service';
import { User } from '../../services/users.service';
import { GPKG_FILE_TYPES, GPKG_MIMETYPE, ZIP_FILE_TYPES } from '../../types';
import {
  buildVectorExportPayload,
  getVectorExportRequestData,
  validateVectorExportData,
} from './requests';

// One entry per export format the tools service can produce. The payload is
// identical for every format (see biip-tools vectorExportParams) — only the
// endpoint and the resulting file's mimetype/extension differ.
export interface VectorExportFormat {
  label: 'GDB' | 'GPKG';
  toolsAction: string;
  saveAction: string;
  mimetype: string;
  uploadTypes: string[];
  fileExtension: string;
}

export const GDB_EXPORT_FORMAT: VectorExportFormat = {
  label: 'GDB',
  toolsAction: 'tools.makeGdb',
  saveAction: 'requests.saveGeneratedGdb',
  mimetype: 'application/zip',
  uploadTypes: ZIP_FILE_TYPES,
  fileExtension: 'zip',
};

export const GPKG_EXPORT_FORMAT: VectorExportFormat = {
  label: 'GPKG',
  toolsAction: 'tools.makeGpkg',
  saveAction: 'requests.saveGeneratedGpkg',
  mimetype: GPKG_MIMETYPE,
  uploadTypes: GPKG_FILE_TYPES,
  fileExtension: 'gpkg',
};

export interface VectorExportGenerationResult {
  generated?: boolean;
  url?: string;
  skipped?: string;
  reason?: string;
}

export async function generateAndSaveVectorExport(
  ctx: Context,
  logger: LoggerInstance,
  id: number,
  format: VectorExportFormat,
): Promise<VectorExportGenerationResult> {
  const { label } = format;
  const startTime = Date.now();

  logger.info(`[${label}] 🟢 Generation STARTED for request ${id}`);

  try {
    // Step 1: Resolve request
    logger.debug(`[${label}] Step 1/5: Resolving request ${id}`);
    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant,geom',
    });

    if (!request?.id) {
      logger.warn(`[${label}] ⏭️ Step 1 SKIPPED: No request found with id ${id}`);
      return { skipped: 'no-request' };
    }
    logger.debug(`[${label}] ✓ Step 1 OK: Request ${id} resolved (status=${request.status})`);

    // Step 2: Load request data
    logger.debug(`[${label}] Step 2/5: Loading request data for request ${id}`);
    const requestData = await getVectorExportRequestData(ctx, id);

    // Validate data
    const validation = validateVectorExportData(requestData);
    if (!validation.valid) {
      logger.warn(`[${label}] ⏭️ Step 2 SKIPPED: ${validation.message}`);
      return { skipped: 'no-data', reason: validation.message };
    }

    logger.debug(
      `[${label}] ✓ Step 2 OK: Loaded places=${validation.placesCount}, observations=${validation.observationsCount}`,
    );

    // Step 3: Build export payload
    logger.debug(`[${label}] Step 3/5: Building export payload`);
    const payload = buildVectorExportPayload(request, requestData);

    const totalFeatures = payload.layers.reduce(
      (sum: number, layer) => sum + layer.geojson.features.length,
      0,
    );

    logger.info(
      `[${label}] ✓ Step 3 OK: Built ${payload.layers.length} layers with ${totalFeatures} total features`,
    );

    payload.layers.forEach((layer, idx: number) => {
      logger.debug(
        `[${label}]   Layer ${idx + 1}: ${layer.name} (${layer.geojson.features.length} features, ${
          layer.fields.length
        } fields)`,
      );
    });

    // Step 4: Call the tools export action.
    // The tools action streams the file back as a Node Readable (no buffering).
    // A failure here MUST surface — historically the BullMQ retry loop
    // ate the rejection and the request stayed in limbo. We rethrow so
    // BullMQ marks the job failed and the request stays observably broken
    // instead of silently appearing successful.
    logger.debug(`[${label}] Step 4/5: Calling ${format.toolsAction}`);
    const stream: NodeJS.ReadableStream = await ctx
      .call(format.toolsAction, payload)
      .then((s) => s as NodeJS.ReadableStream)
      .catch((err: any) => {
        logger.error(
          `${format.toolsAction} failed for request ${id} ` +
            `(${payload.layers.length} layer(s): ${payload.layers
              .map((l) => `${l.name}=${l.geojson.features.length}`)
              .join(', ')})`,
          err,
        );
        throw err;
      });

    logger.debug(`[${label}] ✓ Step 4 OK: Received stream from ${format.toolsAction}`);

    // Step 5: Upload to MinIO
    const folder = getRequestFolderName(
      request?.createdBy as any as User,
      request?.tenant as Tenant,
    );
    logger.debug(`[${label}] Step 5/5: Uploading ${label} to MinIO (folder=${folder})`);

    const result: any = await ctx
      .call(
        'minio.uploadFile',
        {
          payload: stream,
          folder,
          isPrivate: true,
          types: format.uploadTypes,
          name: `israsas-${request.id}`,
        },
        {
          meta: {
            mimetype: format.mimetype,
            filename: `israsas-${request.id}.${format.fileExtension}`,
          },
        },
      )
      .catch((err: any) => {
        logger.error(`minio.uploadFile failed for request ${id}`, {
          error: err.message,
          folder,
        });
        throw err;
      });

    logger.info(`[${label}] ✓ Step 5 OK: File uploaded to MinIO at ${result.url}`);

    // Save URL to database
    await ctx.call(format.saveAction, { id, url: result.url }).catch((err: any) => {
      logger.error(`${format.saveAction} failed for request ${id}`, {
        error: err.message,
      });
      throw err;
    });

    const elapsed = Date.now() - startTime;
    logger.info(
      `[${label}] ✅ Generation COMPLETED in ${elapsed}ms (${(elapsed / 1000).toFixed(
        2,
      )}s) for request ${id}`,
    );

    return { generated: true, url: result.url };
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error(`[${label}] 🔴 Generation FAILED after ${elapsed}ms for request ${id}`, {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

export interface VectorExportRequestValidation {
  valid: boolean;
  message?: string;
  reason?: string;
  requestId?: number;
}

export async function validateVectorExportRequest(
  ctx: Context,
  logger: LoggerInstance,
  id: number,
  format: VectorExportFormat,
): Promise<VectorExportRequestValidation> {
  logger.debug(`[${format.label}-VALIDATE] Validating request ${id}`);

  const request: Request = await ctx.call('requests.resolve', {
    id,
    populate: 'createdBy,tenant',
  });

  if (!request?.id) {
    return { valid: false, reason: 'Request not found' };
  }

  const requestData = await getVectorExportRequestData(ctx, id);

  const validation = validateVectorExportData(requestData);

  return {
    valid: validation.valid,
    message: validation.message,
    requestId: id,
  };
}
