import { Context, LoggerInstance } from 'moleculer';
import { getRequestFolderName } from '../requests';
import type { FileUploadResponse } from '../../services/minio.service';
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

  try {
    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant,geom',
    });

    if (!request?.id) {
      logger.warn(`[${label}] Generation skipped: no request found with id ${id}`);
      return { skipped: 'no-request' };
    }

    const requestData = await getVectorExportRequestData(ctx, id);

    const validation = validateVectorExportData(requestData);
    if (!validation.valid) {
      logger.warn(`[${label}] Generation skipped for request ${id}: ${validation.message}`);
      return { skipped: 'no-data', reason: validation.message };
    }

    const payload = buildVectorExportPayload(request, requestData);

    const totalFeatures = payload.layers.reduce(
      (sum: number, layer) => sum + layer.geojson.features.length,
      0,
    );
    logger.info(
      `[${label}] Exporting ${
        payload.layers.length
      } layer(s) with ${totalFeatures} feature(s): ${payload.layers
        .map((l) => `${l.name}=${l.geojson.features.length}`)
        .join(', ')}`,
    );

    // The tools action streams the file back as a Node Readable (no buffering).
    const stream: NodeJS.ReadableStream = await ctx.call(format.toolsAction, payload);

    const folder = getRequestFolderName(
      request?.createdBy as any as User,
      request?.tenant as Tenant,
    );

    const uploadedFile: FileUploadResponse = await ctx.call(
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
    );

    await ctx.call(format.saveAction, { id, url: uploadedFile.url });

    const elapsed = Date.now() - startTime;
    logger.info(
      `[${label}] Generation completed in ${elapsed}ms for request ${id}: ${uploadedFile.url}`,
    );

    return { generated: true, url: uploadedFile.url };
  } catch (error: any) {
    // A failure MUST surface — historically the BullMQ retry loop ate the
    // rejection and the request stayed in limbo. Rethrowing marks the job
    // failed so the request stays observably broken instead of silently
    // appearing successful.
    const elapsed = Date.now() - startTime;
    logger.error(`[${label}] Generation failed after ${elapsed}ms for request ${id}`, {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
