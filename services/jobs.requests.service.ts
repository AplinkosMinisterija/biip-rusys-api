'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import moment from 'moment';
import { PassThrough, Readable } from 'stream';
import BullMqMixin from '../mixins/bullmq.mixin';
import { FILE_TYPES, getPublicFileName, throwNotFoundError } from '../types';
import { toMD5Hash, toReadableStream } from '../utils/functions';
import { getTemplateHtml } from '../utils/html';
import {
  getInformationalForms,
  getMapsSearchParams,
  getPlaces,
  getRequestData,
} from '../utils/pdf/requests';
import { AuthType } from './api.service';
import { Request } from './requests.service';
import { TaxonomySpeciesType, TaxonomySpeciesTypeTranslate } from './taxonomies.species.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';
import muhammara from 'muhammara';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'fs';

export function getRequestSecret(request: Request) {
  return toMD5Hash(`id=${request.id}&date=${moment(request.createdAt).format('YYYYMMDDHHmmss')}`);
}

type PartialPdfResponse = {
  filename: string;
  extention: string;
  url: string;
  index: number;
  pagesCount?: number;
};
@Service({
  name: 'jobs.requests',
  mixins: [BullMqMixin],
  settings: {
    bullmq: {
      worker: { concurrency: 5 },
      job: {
        attempts: 5,
        backoff: 500,
      },
    },
  },
})
export default class JobsRequestsService extends moleculer.Service {
  @Action({
    queue: true,
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async generateAndSavePdf(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    const { job } = ctx.locals;
    const stats: any = await ctx.call('requests.requestStats', { id });

    let screenshotsHash;
    if (job?.id) {
      const childrenValues = await job.getChildrenValues();

      const screenshotsByHash: any = Object.values(childrenValues).reduce(
        (acc: any, item: any) => ({
          ...acc,
          [item.hash]: item.url,
        }),
        {},
      );

      screenshotsHash = toMD5Hash(`id=${id}&date=${moment().format('YYYYMMDDHHmmsss')}`);

      const redisKey = `screenshots.${screenshotsHash}`;

      await this.broker.cacher.set(redisKey, screenshotsByHash, 60 * 60 * 24);
    }

    const limit = 50;

    const childrenJobs: any[] = [];

    childrenJobs.push({
      params: { id, type: 'intro', screenshotsHash, index: 0 },
      name: 'jobs.requests',
      action: 'generatePartialPdf',
    });

    let index = 1;

    for (let i = 0; i < Math.ceil(stats.placesCount / limit); i++) {
      childrenJobs.push({
        params: { offset: limit * i, limit, id, type: 'places', index, screenshotsHash },
        name: 'jobs.requests',
        action: 'generatePartialPdf',
      });
      index++;
    }

    for (let i = 0; i < Math.ceil(stats.informationalFormsCount / limit); i++) {
      childrenJobs.push({
        params: { offset: limit * i, limit, id, type: 'forms', index, screenshotsHash },
        name: 'jobs.requests',
        action: 'generatePartialPdf',
      });
      index++;
    }

    return this.flow(
      ctx,
      'jobs.requests',
      'addFooterToPartialPdfs',
      {
        id,
      },
      childrenJobs,
      { removeDependencyOnFailure: true },
    );
  }

  @Method
  async uploadPartialHtml(ctx: Context, url: string, folder: string, name: string) {
    const htmlResult = await new Promise(async (resolve, reject) => {
      fetch(url, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      })
        .then((r) => {
          if (!r.ok) reject(`Error while getting html for ${url}`);
          return r;
        })
        .then((r) => r.body?.getReader())
        .then(resolve)
        .catch((err) => {
          reject(err?.message || 'Error while getting html');
        });
    });

    return ctx.call(
      'minio.uploadFile',
      {
        payload: toReadableStream(htmlResult),
        folder: folder,
        types: FILE_TYPES,
        name,
        isPrivate: true,
        presign: true,
      },
      {
        meta: {
          mimetype: 'text/html',
          filename: `${name}.html`,
        },
      },
    );
  }

  @Action({
    params: {
      id: 'number|convert',
    },
    queue: true,
  })
  async addFooterToPartialPdfs(ctx: Context<{ id: number }>) {
    const { job } = ctx.locals;
    const { id } = ctx.params;

    const childrenValues: { [key: string]: PartialPdfResponse } = await job?.getChildrenValues();
    const items = Object.values(childrenValues).sort((a: any, b: any) => a.index - b.index);

    const childrenJobs = [];
    let pagesOffset = 0;
    const totalPages = items.reduce((acc, i) => acc + i.pagesCount, 0);
    for (const item of items) {
      childrenJobs.push({
        params: {
          id,
          url: item.url,
          offset: pagesOffset,
          originalFilename: item.filename,
          extention: item.extention,
          totalPages,
          index: item.index,
        },
        name: 'jobs.requests',
        action: 'addFooterToPartialPdf',
      });
      pagesOffset += item.pagesCount;
    }

    return this.flow(ctx, 'jobs.requests', 'mergePartialPdfsAndSave', { id }, childrenJobs, {
      removeDependencyOnFailure: true,
    });
  }

  @Action({
    params: {
      id: 'number|convert',
      url: 'url',
      totalPages: 'number|convert',
      offset: 'number|convert|default:0',
      originalFilename: 'string',
      extention: 'string',
      index: 'number|convert',
    },
    queue: true,
  })
  async addFooterToPartialPdf(
    ctx: Context<{
      id: number;
      url: string;
      offset?: number;
      totalPages: number;
      extension: string;
      originalFilename: string;
      index: number;
    }>,
  ) {
    const { offset, totalPages, extension, originalFilename, url, id, index } = ctx.params;

    const partialFileName = `${originalFilename}-with-footer`;

    const pdfBuffer = await fetch(url)
      .then((r) => r.arrayBuffer())
      .then((arrayBuffer) => Buffer.from(arrayBuffer))
      .catch((err) => {
        console.error(url, err);
      });

    if (!pdfBuffer) return;

    const pdfDoc = await PDFDocument.load(pdfBuffer);
    pdfDoc.registerFontkit(fontkit);

    const leftPadding = 40;
    const rightPadding = 40;
    const fontSize = 5;
    const verticalPosition = 20;
    const color = rgb(0.5, 0.5, 0.5);

    const fontBytes = readFileSync('./templates/fonts/Arial.ttf');
    const font = await pdfDoc.embedFont(fontBytes);
    const totalPagesInDoc = pdfDoc.getPageCount();
    for (let i = 0; i < totalPagesInDoc; i++) {
      const page = pdfDoc.getPage(i);
      const { width } = page.getSize();

      const leftText = `Išrašas iš Saugomų rūšių informacinės sistemos Nr. ${id}`;
      page.drawText(leftText, {
        x: leftPadding,
        y: verticalPosition,
        size: fontSize,
        font,
        color,
      });

      const rightText = `${offset + i + 1} / ${totalPages || totalPagesInDoc}`;
      const textWidth = font.widthOfTextAtSize(rightText, fontSize);

      page.drawText(rightText, {
        x: width - rightPadding - textWidth,
        y: verticalPosition,
        size: fontSize,
        font,
        color,
      });
    }

    const pdfBytes = await pdfDoc.save();

    const stream = new PassThrough();

    stream.end(Buffer.from(pdfBytes));

    const result: any = await ctx.call(
      'minio.uploadFile',
      {
        payload: stream,
        name: partialFileName,
        folder: this.getTempFolder(id),
        isPrivate: true,
        types: FILE_TYPES,
        presign: true,
      },
      {
        meta: {
          mimetype: 'application/pdf',
          filename: `${partialFileName}.${extension}`,
        },
      },
    );

    await this.checkIfFileExists(ctx, result.objectName);

    return {
      index,
      url: result.presignedUrl,
    };
  }

  @Action({
    params: {
      id: 'number',
    },
    queue: true,
    timeout: 0,
  })
  async mergePartialPdfsAndSave(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    const { job } = ctx.locals;

    const childrenValues: { [key: string]: PartialPdfResponse } = await job.getChildrenValues();
    const items = Object.values(childrenValues).sort((a: any, b: any) => a.index - b.index);

    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant',
      throwIfNotExist: true,
    });

    const pass = new PassThrough();
    const pdfWriter = muhammara.createWriter(new muhammara.PDFStreamForResponse(pass));
    const folder = this.getFolderName(request.createdBy as any as User, request.tenant as Tenant);
    const date = moment().format('YYYY-MM-DD-HH-mm');
    const filename = `israsas-${id}-${date}`;

    const uploadPromise: any = ctx.call(
      'minio.uploadFile',
      {
        payload: pass,
        name: `${filename}-${getPublicFileName(20)}`,
        folder,
        isPrivate: true,
        types: FILE_TYPES,
      },
      {
        meta: {
          mimetype: 'application/pdf',
          filename: `${filename}.pdf`,
        },
      },
    );

    for (const file of items) {
      const pdfBuffer = await fetch(file.url)
        .then((r) => r.arrayBuffer())
        .then((arrayBuffer) => Buffer.from(arrayBuffer));

      const pdfReader = new muhammara.PDFRStreamForBuffer(pdfBuffer);
      pdfWriter.appendPDFPagesFromPDF(pdfReader);
    }

    pdfWriter.end();
    pass.end();

    const result = await uploadPromise;

    await this.checkIfFileExists(ctx, result.objectName);

    await ctx.call('requests.saveGeneratedPdf', {
      id,
      url: result.url,
    });

    return { job: job.id, url: result.url };
  }

  @Action({
    queue: true,
    params: {
      id: 'number',
      limit: 'number|convert|optional|default:100',
      offset: 'number|convert|optional|default:0',
      type: {
        type: 'string',
        enum: ['intro', 'forms', 'places'],
      },
      index: 'number|convert|default:0',
      screenshotsHash: 'string|optional|default:admin_preview',
    },
    timeout: 0,
  })
  async generatePartialPdf(
    ctx: Context<{
      id: number;
      type: string;
      offset?: number;
      limit: number;
      index: number;
      screenshotsHash: string;
    }>,
  ): Promise<PartialPdfResponse> {
    const { id, type, limit, offset, screenshotsHash } = ctx.params;

    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant',
      throwIfNotExist: true,
    });

    const secret = getRequestSecret(request);

    const searchParams = new URLSearchParams({
      skey: screenshotsHash,
      secret,
      limit: `${limit}`,
      offset: `${offset}`,
    });

    const partialFolder = this.getTempFolder(request.id);
    const partialFileNamePrefix = type === 'intro' ? type : `${type}-${offset}-${offset + limit}`;
    const partialFileName = `${partialFileNamePrefix}-${getPublicFileName(20)}`;
    const extention = `pdf`;

    const partialHtmlUrl = `${
      process.env.SERVER_HOST
    }/jobs/requests/${id}/html/${type}?${searchParams.toString()}`;

    const uploadedHtml: any = await this.uploadPartialHtml(
      ctx,
      partialHtmlUrl,
      partialFolder,
      partialFileName,
    );

    // CDN though cloudflare doesn't return size for HTML documents..
    if (!isNaN(uploadedHtml.size)) {
      await this.checkIfFileExists(ctx, uploadedHtml.objectName);
    }

    const pdf = await ctx.call('tools.makePdf', {
      url: uploadedHtml.presignedUrl,
      // TODO: remove
      // url: uploadedHtml.url.replace('localhost', 'host.docker.internal'),
    });

    const result: any = await ctx.call(
      'minio.uploadFile',
      {
        payload: toReadableStream(pdf),
        folder: partialFolder,
        name: partialFileName,
        isPrivate: true,
        presign: true,
        types: FILE_TYPES,
      },
      {
        meta: {
          mimetype: 'application/pdf',
          filename: `${partialFileName}.${extention}`,
        },
      },
    );

    await this.checkIfFileExists(ctx, result.objectName);

    // Lastly - count pages
    const response: PartialPdfResponse = {
      url: result.presignedUrl,
      index: ctx.params.index,
      filename: partialFileName,
      extention,
    };

    const pdfBuffer = await fetch(response.url)
      .then((r) => r.arrayBuffer())
      .then((arrayBuffer) => Buffer.from(arrayBuffer))
      .catch((err) => {
        console.error(response.url, err);
      });

    if (!pdfBuffer) return;

    const pdfReaderStream = new muhammara.PDFRStreamForBuffer(pdfBuffer);
    const pdfReader = muhammara.createReader(pdfReaderStream);
    const count = pdfReader.getPagesCount();

    response.pagesCount = count;

    return response;
  }

  @Action({
    queue: true,
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async generateAndSaveGeojson(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    const { job } = ctx.locals;

    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant',
      throwIfNotExist: true,
    });

    const requestData = await getRequestData(ctx, id, {
      loadPlaces: false,
      loadLegend: false,
      loadInformationalForms: false,
    });

    function getSpeciesData(id: number) {
      const species = requestData.speciesById[`${id}`];

      if (!species?.speciesId) return {};

      return {
        'Rūšies tipas': TaxonomySpeciesTypeTranslate[species.speciesType],
        'Rūšies pavadinimas': species.speciesName,
        'Rūšies lotyniškas pavadinimas': species.speciesNameLatin,
        'Rūšies sinonimai': species.speciesSynonyms?.join(', ') || '',
        'Klasės pavadinimas': species.className,
        'Klasės lotyniškas pavadinimas': species.classNameLatin,
        'Tipo pavadinimas': species.phylumName,
        'Tipo lotyniškas pavadinimas': species.phylumNameLatin,
        'Karalystės pavadinimas': species.kingdomName,
        'Karalystės lotyniškas pavadinimas': species.kingdomNameLatin,
      };
    }

    function getTitle(speciesId: number) {
      const species = requestData.speciesById[`${speciesId}`];
      const isInvasive = [TaxonomySpeciesType.INTRODUCED, TaxonomySpeciesType.INVASIVE].includes(
        species?.speciesType,
      );

      return isInvasive ? 'Įvedimo į INVA data' : 'Įvedimo į SRIS data';
    }

    function getPlacesFeatures(places: any[]) {
      const result: any[] = [];
      places?.forEach((place) => {
        const speciesInfo = getSpeciesData(place.species);
        place.forms?.forEach((form: any) => {
          let { features } = form.geom || [];
          const featuresToInsert = features.map((f: any) => {
            f.geometry.crs = { type: 'name', properties: { name: 'EPSG:3346' } };
            f.properties = {
              'Anketos ID': form.id,
              'Radavietės ID': place.id,
              'Radavietės kodas': place.placeCode,
              ...speciesInfo,
              'Individų skaičius (gausumas)': form.quantityTranslate || '0',
              'Buveinė, elgsena, ūkinė veikla ir kita informacija': form.description,
              [getTitle(place.species)]: form.createdAt,
              'Stebėjimo data': form.observedAt,
              Šaltinis: form.source,
              'Veiklos požymiai': form.activityTranslate,
              'Vystymosi stadija': form.evolutionTranslate,
            };
            return f;
          });

          result.push(...featuresToInsert);
        });
      });

      return result;
    }

    function getInformationalFormsFeatures(informationalForms: any[]) {
      const result: any[] = [];

      informationalForms?.forEach((form: any) => {
        let { features } = form.geom || [];
        const featuresToInsert = features.map((f: any) => {
          f.geometry.crs = { type: 'name', properties: { name: 'EPSG:3346' } };
          f.properties = {
            'Anketos ID': form.id,
            'Radavietės ID': '-',
            'Radavietės kodas': '-',
            ...getSpeciesData(form.species),
            'Individų skaičius (gausumas)': form.quantityTranslate || '0',
            'Buveinė, elgsena, ūkinė veikla ir kita informacija': form.description,
            [getTitle(form.species)]: form.createdAt,
            'Stebėjimo data': form.observedAt,
            Šaltinis: form.source,
            'Veiklos požymiai': form.activityTranslate,
            'Vystymosi stadija': form.evolutionTranslate,
          };
          return f;
        });

        result.push(...featuresToInsert);
      });
      return result;
    }

    async function* fetchGeoJSONChunks(batchSize: number = 100) {
      let offset = 0;
      let isFirstChunk = true;
      const stats = {
        noPlaces: false,
        noInformationForms: false,
      };

      yield `{"type":"FeatureCollection","features":[`; // Open GeoJSON structure

      while (true) {
        const places = stats.noPlaces
          ? []
          : await getPlaces(ctx, id, {
              date: requestData.requestDate,
              translatesAndFormTypes: requestData.translates,
              limit: batchSize,
              offset,
            });

        const informationalForms = stats.noInformationForms
          ? []
          : await getInformationalForms(ctx, id, {
              date: requestData.requestDate,
              translatesAndFormTypes: requestData.translates,
              limit: batchSize,
              offset,
            });

        const placesFeatures = getPlacesFeatures(places);
        const informationalFormsFeatures = getInformationalFormsFeatures(informationalForms);
        stats.noInformationForms = !informationalFormsFeatures.length;
        stats.noPlaces = !placesFeatures.length;

        if (stats.noInformationForms && stats.noPlaces) break; // Stop when no more data

        // Yield features as JSON (prepend a comma if it's not the first chunk)
        yield (isFirstChunk ? '' : ',') +
          JSON.stringify([...placesFeatures, ...informationalFormsFeatures]).slice(1, -1);

        isFirstChunk = false;
        offset += batchSize;
      }

      yield `]}`; // Close GeoJSON structure
    }

    const folder = this.getFolderName(request.createdBy as any as User, request.tenant as Tenant);

    const stream = Readable.from(fetchGeoJSONChunks(100));
    const pass = new PassThrough();
    stream.pipe(pass);

    const result: any = await ctx.call(
      'minio.uploadFile',
      {
        payload: pass,
        folder,
        isPrivate: true,
        types: FILE_TYPES,
      },
      {
        meta: {
          mimetype: 'application/geo+json',
          filename: `israsas-${request.id}.geojson`,
        },
      },
    );

    await ctx.call('requests.saveGeneratedGeojson', {
      id,
      url: result.url,
    });

    return { job: job?.id, url: result?.url };
  }

  @Action({
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async initiatePdfGenerate(ctx: Context<{ id: number }>) {
    const data: any[] = [];

    const { id } = ctx.params;

    const folder = this.getTempFolder(id);

    await ctx.call('minio.cleanFolder', { prefix: folder, recursive: true });

    const requestData = await getRequestData(ctx, id, {
      loadLegend: false,
      loadPlaces: true,
      loadInformationalForms: true,
    });

    const params = await getMapsSearchParams(ctx);

    function getUrl(params: URLSearchParams) {
      const mapHost = process.env.MAPS_HOST || 'https://maps.biip.lt';
      return `${mapHost}/rusys?${params.toString()}`;
    }

    // add preview screenshot
    params.set('request', requestData?.id?.toString());

    data.push({
      url: getUrl(params),
      hash: requestData.previewScreenshotHash,
    });
    params.delete('request');

    // add all places
    requestData.places?.forEach((place) => {
      params.set('place', `${place.id}`);
      data.push({
        url: getUrl(params),
        hash: place.hash,
      });
    });

    params.delete('place');

    // add all forms
    requestData.informationalForms?.forEach((form) => {
      params.set('informationalForm', `${form.id}`);
      data.push({
        url: getUrl(params),
        hash: form.hash,
      });
    });

    params.delete('informationalForm');

    const childrenJobs = data.map((item) => ({
      params: { ...item, waitFor: '#image-canvas-0' },
      name: 'jobs',
      action: 'saveScreenshot',
    }));

    return this.flow(
      ctx,
      'jobs.requests',
      'generateAndSavePdf',
      {
        id,
      },
      childrenJobs,
      { removeDependencyOnFailure: true },
    );
  }

  @Action({
    params: {
      id: 'number',
    },
    timeout: 0,
  })
  async initiateGeojsonGenerate(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    return this.queue(ctx, 'jobs.requests', 'generateAndSaveGeojson', { id });
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
      secret: 'string',
      skey: 'string',
      offset: 'number|convert|optional',
      limit: 'number|convert|optional',
      type: {
        type: 'string',
        enum: ['places', 'forms', 'intro'],
      },
    },
    rest: 'GET /:id/html/:type',
    auth: AuthType.PUBLIC,
    timeout: 0,
  })
  async getRequestHtmlPartial(
    ctx: Context<
      { id: number; secret: string; skey: string; offset?: number; limit?: number; type: string },
      { $responseType: string; $responseHeaders: any }
    >,
  ) {
    const { id, secret, skey: screenshotsRedisKey, offset, limit, type } = ctx.params;

    const request: Request = await ctx.call('requests.resolve', { id });

    const secretToApprove = getRequestSecret(request);
    if (!request?.id || !secret || secret !== secretToApprove) {
      return throwNotFoundError('Invalid secret!');
    }

    const requestData = await getRequestData(ctx, id, {
      loadPlaces: false,
      loadLegend: type === 'intro',
      loadInformationalForms: false,
    });

    let screenshotsByHash: any = {};

    if (screenshotsRedisKey !== 'admin_preview') {
      screenshotsByHash = await this.broker.cacher.get(`screenshots.${screenshotsRedisKey}`);
    }

    if (type === 'places') {
      requestData.places = await getPlaces(ctx, id, {
        date: requestData.requestDate,
        translatesAndFormTypes: requestData.translates,
        limit: limit || 100,
        offset,
      });

      // set screenshots for places
      requestData?.places.forEach((p) => {
        p.screenshot = screenshotsByHash[p.hash] || '';
      });
    } else if (type === 'forms') {
      requestData.informationalForms = await getInformationalForms(ctx, id, {
        date: requestData.requestDate,
        translatesAndFormTypes: requestData.translates,
        limit: limit || 100,
        offset,
      });

      // set screenshots for places
      requestData?.informationalForms.forEach((f) => {
        f.screenshot = screenshotsByHash[f.hash] || '';
      });
    } else if (type === 'intro') {
      requestData.places = await getPlaces(ctx, id, {
        date: requestData.requestDate,
        translatesAndFormTypes: requestData.translates,
        justInfo: true,
      });

      requestData.informationalForms = await getInformationalForms(ctx, id, {
        date: requestData.requestDate,
        translatesAndFormTypes: requestData.translates,
      });

      requestData.previewScreenshot = screenshotsByHash[requestData.previewScreenshotHash] || '';
    }

    const html = getTemplateHtml(`partials/${type}.ejs`, { ...requestData, offset });

    ctx.meta.$responseType = 'text/html';

    return html;
  }

  @Method
  getFolderName(user?: User, tenant?: Tenant) {
    const tenantPath = tenant?.id || 'private';
    const userPath = user?.id || 'user';

    return `uploads/requests/${tenantPath}/${userPath}`;
  }

  @Method
  getTempFolder(requestId: Request['id']) {
    return `temp/requests/pdf/${requestId}`;
  }

  @Method
  async checkIfFileExists(ctx: Context, objectName: string) {
    const fileData: any = await ctx.call('minio.fileStat', {
      objectName,
    });

    if (fileData?.exists) return true;

    console.error(`File ${objectName} doesn't exist!`, fileData);
    throw new Error(`File ${objectName} doesn't exist!`);
  }
}
