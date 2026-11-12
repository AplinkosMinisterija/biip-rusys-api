import { createWriteStream, promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { Writable } from 'stream';
import { finished } from 'stream/promises';
import { once } from 'events';
import { SpeciesById } from '../requests';
import {
  buildObservationFeatures,
  buildPlaceFeatures,
  ExportFeature,
  InformationalFormsBySpecies,
  layerSuffixFor,
  OBSERVATION_EXPORT_FIELDS,
  OBSERVATION_LAYER_NAME,
  PLACE_EXPORT_FIELDS,
  PLACE_LAYER_NAME,
  RequestPlace,
  VectorExportField,
} from './requests';

export interface VectorExportBatch {
  places?: RequestPlace[];
  informationalForms?: InformationalFormsBySpecies;
}

export interface VectorExportLayerFile {
  name: string;
  fields: VectorExportField[];
  path: string;
  features: number;
}

export type LoadVectorExportBatch = (offset: number, limit: number) => Promise<VectorExportBatch>;

const DEFAULT_BATCH_SIZE = 100;

interface OpenLayerFile extends VectorExportLayerFile {
  layer: string;
  stream: Writable;
}

export async function writeVectorExportLayerFiles(
  dir: string,
  speciesById: SpeciesById,
  loadBatch: LoadVectorExportBatch,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<VectorExportLayerFile[]> {
  const open = new Map<string, OpenLayerFile>();

  try {
    for (let offset = 0; ; offset += batchSize) {
      const batch = await loadBatch(offset, batchSize);
      const places = batch.places || [];
      const informationalForms = batch.informationalForms || {};

      if (!places.length && !Object.values(informationalForms).some((g) => g.forms?.length)) break;

      for (const feature of buildPlaceFeatures(places, speciesById)) {
        await append(open, dir, PLACE_LAYER_NAME, PLACE_EXPORT_FIELDS, feature);
      }

      for (const feature of buildObservationFeatures(places, informationalForms, speciesById)) {
        await append(open, dir, OBSERVATION_LAYER_NAME, OBSERVATION_EXPORT_FIELDS, feature);
      }
    }
  } catch (error) {
    // A half-written file is discarded with its directory, but its fd is this process's to release.
    open.forEach((file) => file.stream.destroy());
    throw error;
  }

  for (const file of open.values()) {
    file.stream.end(']}');
    await finished(file.stream);
  }

  return dropUnusedSuffixes([...open.values()]);
}

async function append(
  open: Map<string, OpenLayerFile>,
  dir: string,
  layer: string,
  fields: VectorExportField[],
  feature: ExportFeature,
): Promise<void> {
  const name = `${layer}_${layerSuffixFor(feature.geometry.type)}`;
  let file = open.get(name);

  if (!file) {
    const path = join(dir, `${name}.geojson`);
    file = { name, layer, fields, path, features: 0, stream: createWriteStream(path) };
    open.set(name, file);
    await write(file.stream, '{"type":"FeatureCollection","features":[');
  }

  await write(file.stream, `${file.features ? ',' : ''}${JSON.stringify(feature)}`);
  file.features += 1;
}

// A layer that turned out to hold one geometry type keeps the plain name, as the inline payload does.
async function dropUnusedSuffixes(files: OpenLayerFile[]): Promise<VectorExportLayerFile[]> {
  const typesPerLayer = new Map<string, number>();
  files.forEach((file) => typesPerLayer.set(file.layer, (typesPerLayer.get(file.layer) || 0) + 1));

  return Promise.all(
    files.map(async ({ layer, stream, ...file }) => {
      if (typesPerLayer.get(layer) > 1) return file;

      const path = join(dirname(file.path), `${layer}.geojson`);
      await fsp.rename(file.path, path);

      return { ...file, name: layer, path };
    }),
  );
}

// A 300k-feature export outruns the write buffer, and an unawaited write queues the whole thing in memory.
async function write(stream: Writable, chunk: string): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}
