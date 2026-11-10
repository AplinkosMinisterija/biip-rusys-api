import mime from 'mime-types';
import Moleculer, { Errors } from 'moleculer';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

export const FILE_TYPES = ['application/pdf', 'application/geo+json'];

// The GDB extract ships as a zipped .gdb directory; upload sources present
// either zip mimetype depending on the OS mime table, so accept both.
export const ZIP_FILE_TYPES = ['application/zip', 'application/x-zip-compressed'];

// The GPKG extract is a single SQLite file served with the official OGC
// mimetype (see biip-tools GPKG_FORMAT).
export const GPKG_MIMETYPE = 'application/geopackage+sqlite3';
export const GPKG_FILE_TYPES = [GPKG_MIMETYPE];

export const ALL_FILE_TYPES = [...IMAGE_TYPES, ...FILE_TYPES];

// The mime-types table has no entry for GeoPackage — without this fallback
// mime.extension() returns false and uploaded objects get named "<name>.false".
const EXTENSION_BY_UNLISTED_MIMETYPE: Record<string, string> = {
  [GPKG_MIMETYPE]: 'gpkg',
};

export function getExtention(mimetype: string) {
  return EXTENSION_BY_UNLISTED_MIMETYPE[mimetype] || mime.extension(mimetype);
}

export function getMimetype(filename: string) {
  return mime.lookup(filename);
}

export function throwUnsupportedMimetypeError(): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(
    'Unsupported MIME type.',
    400,
    'UNSUPPORTED_MIMETYPE',
  );
}

export function throwUnableToUploadError(): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(
    'Unable to upload file.',
    400,
    'UNABLE_TO_UPLOAD',
  );
}

export function getPublicFileName(length: number = 30) {
  function makeid(length: number) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  return makeid(length);
}
