import mime from 'mime-types';
import Moleculer, { Errors } from 'moleculer';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

// Browsers and operating systems name the same audio formats differently, so all spellings are kept.
export const AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
];

export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

export const MEDIA_TYPES = [...AUDIO_TYPES, ...VIDEO_TYPES];

export const MEDIA_MAX_SIZE = 100 * 1024 * 1024;

export const FILE_TYPES = ['application/pdf', 'application/geo+json'];

// Either zip mimetype can arrive, depending on the OS mime table.
export const ZIP_FILE_TYPES = ['application/zip', 'application/x-zip-compressed'];

// The official OGC mimetype for a GeoPackage, which is a single SQLite file.
export const GPKG_MIMETYPE = 'application/geopackage+sqlite3';
export const GPKG_FILE_TYPES = [GPKG_MIMETYPE];

export const ALL_FILE_TYPES = [...IMAGE_TYPES, ...FILE_TYPES];

// The mime-types table has no entry for GeoPackage — without this fallback
// mime.extension() returns false and uploaded objects get named "<name>.false".
const EXTENSION_BY_UNLISTED_MIMETYPE: Record<string, string> = {
  [GPKG_MIMETYPE]: 'gpkg',
  'audio/mpeg': 'mp3',
  'audio/m4a': 'm4a',
  'video/quicktime': 'mov',
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

export function throwFileTooLargeError(): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError('File is too large.', 400, 'FILE_TOO_LARGE');
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
