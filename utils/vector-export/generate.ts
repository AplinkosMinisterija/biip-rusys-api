import { createReadStream, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Errors } from 'moleculer';
import type { Context, LoggerInstance } from 'moleculer';
import type { FileUploadResponse } from '../../services/minio.service';
import type { Request } from '../../services/requests.service';
import type { Tenant } from '../../services/tenants.service';
import type { User } from '../../services/users.service';
import { FILE_TYPES, GPKG_FILE_TYPES, GPKG_MIMETYPE, ZIP_FILE_TYPES } from '../../types';
import type { RequestClassifiers } from '../pdf/classifiers';
import { getInformationalForms, getPlaces, getRequestData } from '../pdf/requests';
import { getRequestFolderName } from '../requests';
import {
  LoadVectorExportBatch,
  VectorExportLayerFile,
  writeVectorExportLayerFiles,
} from './layer-files';
import type { VectorExportLayerSource } from './requests';

// One payload serves every format; only the endpoint and the file differ.
export interface VectorExportFormat {
  label: 'GDB' | 'GPKG' | 'SHP';
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

export const SHP_EXPORT_FORMAT: VectorExportFormat = {
  label: 'SHP',
  toolsAction: 'tools.makeShp',
  saveAction: 'requests.saveGeneratedShp',
  mimetype: 'application/zip',
  uploadTypes: ZIP_FILE_TYPES,
  fileExtension: 'zip',
};

const GEOJSON_MIMETYPE = 'application/geo+json';
// The bucket expires this prefix after 7 days, which is also the presigned url's life: a backstop for an object the cleanup below never reaches.
const HANDOVER_FOLDER = 'temp';
const EXPORT_SRID = 3346;

function getVectorExportRequestData(ctx: Context, id: number) {
  return getRequestData(ctx, id, {
    loadPlaces: false,
    loadLegend: false,
    loadInformationalForms: false,
  });
}

// Both sources are paged by the same offset and an exhausted one keeps answering empty, as the GeoJSON export does.
function batchLoader(ctx: Context, id: number, date: string, translates: RequestClassifiers) {
  const exhausted = { places: false, informationalForms: false };

  const load: LoadVectorExportBatch = async (offset, limit) => {
    const opts = { date, translatesAndFormTypes: translates, limit, offset };

    const places = exhausted.places ? [] : await getPlaces(ctx, id, opts);
    const informationalForms = exhausted.informationalForms
      ? {}
      : await getInformationalForms(ctx, id, opts);

    exhausted.places = !places.length;
    exhausted.informationalForms = !Object.values(informationalForms).some(
      (group) => group?.forms?.length,
    );

    return { places, informationalForms };
  };

  return load;
}

// `paths` is the caller's, so an upload that fails halfway still leaves it holding what went up.
async function uploadLayerFiles(
  ctx: Context,
  files: VectorExportLayerFile[],
  paths: string[],
): Promise<VectorExportLayerSource[]> {
  const layers: VectorExportLayerSource[] = [];

  for (const file of files) {
    // No `name`: minio draws a random one, so two formats of one request cannot collide and the object stays unguessable.
    const object: FileUploadResponse = await ctx.call(
      'minio.uploadFile',
      {
        payload: createReadStream(file.path),
        folder: HANDOVER_FOLDER,
        isPrivate: true,
        types: FILE_TYPES,
        presign: true,
      },
      {
        meta: { mimetype: GEOJSON_MIMETYPE, filename: `${file.name}.geojson` },
        timeout: 0,
      },
    );

    paths.push(object.path);
    layers.push({ name: file.name, fields: file.fields, url: object.presignedUrl });
  }

  return layers;
}

export interface VectorExportGenerationResult {
  generated?: boolean;
  url?: string;
  skipped?: string;
  reason?: string;
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;

  const { code, cause } = error as Error & { code?: string; cause?: { code?: string } };

  return code || cause?.code;
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

    const { requestDate, translates, speciesById } = await getVectorExportRequestData(ctx, id);

    const folder = getRequestFolderName(
      request?.createdBy as unknown as User,
      request?.tenant as Tenant,
    );

    const dir = await fsp.mkdtemp(join(tmpdir(), `vector-export-${label.toLowerCase()}-${id}-`));
    const tempObjectPaths: string[] = [];
    let uploadedFile: FileUploadResponse;

    try {
      const files = await writeVectorExportLayerFiles(
        dir,
        speciesById,
        batchLoader(ctx, id, requestDate, translates),
      );

      if (!files.length) {
        logger.warn(`[${label}] Generation skipped for request ${id}: nothing to export`);
        return { skipped: 'no-data', reason: 'nothing to export' };
      }

      logger.info(
        `[${label}] Exporting ${files.length} layer(s): ${files
          .map((f) => `${f.name}=${f.features}`)
          .join(', ')}`,
      );

      const layers = await uploadLayerFiles(ctx, files, tempObjectPaths);

      // The tools action streams the file back as a Node Readable (no buffering).
      const stream: NodeJS.ReadableStream = await ctx.call(format.toolsAction, {
        layers,
        name: `israsas-${request.id}`,
        srid: EXPORT_SRID,
      });

      uploadedFile = await ctx.call(
        'minio.uploadFile',
        {
          payload: stream,
          folder,
          isPrivate: true,
          types: format.uploadTypes,
          // No `name` on purpose: `minio.getFile` is public and unscoped, so a
          // derivable object name would make protected-species geometry
          // enumerable. The download name comes from meta.filename below.
        },
        {
          meta: {
            mimetype: format.mimetype,
            filename: `israsas-${request.id}.${format.fileExtension}`,
          },
          timeout: 0,
        },
      );
    } finally {
      // The layer files are a handover, not a product; a failed export must not leave them readable.
      for (const path of tempObjectPaths) {
        await ctx.call('minio.removeFile', { path });
      }
      await fsp.rm(dir, { recursive: true, force: true });
    }

    await ctx.call(format.saveAction, { id, url: uploadedFile.url });

    const elapsed = Date.now() - startTime;
    logger.info(
      `[${label}] Generation completed in ${elapsed}ms for request ${id}: ${uploadedFile.url}`,
    );

    return { generated: true, url: uploadedFile.url };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error(`[${label}] Generation failed after ${elapsed}ms for request ${id}`, {
      message: error instanceof Error ? error.message : String(error),
      // A socket or a nested moleculer error says what went wrong only in its code.
      code: errorCode(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Named, because the failed job is read alone; the cause stays in the log, as `data` reaches a response body.
    throw new Errors.MoleculerError(
      `${label} export failed for request ${id}`,
      500,
      'VECTOR_EXPORT_FAILED',
      { requestId: id, format: label },
    );
  }
}
