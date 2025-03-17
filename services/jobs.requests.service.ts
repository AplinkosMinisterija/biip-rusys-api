'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import moment from 'moment';
import BullMqMixin from '../mixins/bullmq.mixin';
import { FILE_TYPES, throwNotFoundError, throwValidationError } from '../types';
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
import { Tenant } from './tenants.service';
import { User } from './users.service';
import { TaxonomySpeciesType, TaxonomySpeciesTypeTranslate } from './taxonomies.species.service';
import { PassThrough, Readable } from 'stream';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';

export function getRequestSecret(request: Request) {
  return toMD5Hash(`id=${request.id}&date=${moment(request.createdAt).format('YYYYMMDDHHmmss')}`);
}
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

    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant',
    });

    const childrenValues = await job.getChildrenValues();

    const screenshotsByHash: any = Object.values(childrenValues).reduce(
      (acc: any, item: any) => ({
        ...acc,
        [item.hash]: item.url,
      }),
      {},
    );

    const requestData = await getRequestData(ctx, id);

    const emptyScreenshots: any = {};

    const placesCount = requestData?.places?.length || 0;
    const informationalFormsCount = Object.keys(requestData?.informationalForms)?.length || 0;

    // general preview screenshot should be in place when there are places
    if (!!placesCount && !screenshotsByHash[requestData.previewScreenshotHash]) {
      emptyScreenshots.request = id;
    }

    requestData?.places.forEach((p) => {
      if (!screenshotsByHash[p.hash]) {
        emptyScreenshots.places = emptyScreenshots.places || [];
        emptyScreenshots.places.push(p.id);
      }
    });

    Object.values(requestData?.informationalForms).forEach((value) => {
      if (!screenshotsByHash[value.hash]) {
        emptyScreenshots.informationalForms = emptyScreenshots.informationalForms || [];
        emptyScreenshots.informationalForms.push(value.forms?.map((f: any) => f.id));
      }
    });

    if (Object.keys(emptyScreenshots).length) {
      throwValidationError('Empty screenshots', {
        request: id,
        emptyScreenshots,
        screenshotsCount: placesCount + informationalFormsCount + placesCount ? 1 : 0,
      });
    }

    const screenshotsHash = toMD5Hash(`id=${id}&date=${moment().format('YYYYMMDDHHmmsss')}`);

    const redisKey = `screenshots.${screenshotsHash}`;

    await this.broker.cacher.set(redisKey, screenshotsByHash);

    const secret = getRequestSecret(request);

    const footerHtml = getTemplateHtml('footer.ejs', {
      id,
      systemName: requestData.systemNameFooter,
    });

    const pdf = await ctx.call('tools.makePdf', {
      url: `${process.env.SERVER_HOST}/jobs/requests/${id}/html?secret=${secret}&skey=${screenshotsHash}`,
      footer: footerHtml,
    });

    const folder = this.getFolderName(request.createdBy as any as User, request.tenant as Tenant);

    const result: any = await ctx.call(
      'minio.uploadFile',
      {
        payload: toReadableStream(pdf),
        folder,
        isPrivate: true,
        types: FILE_TYPES,
      },
      {
        meta: {
          mimetype: 'application/pdf',
          filename: `israsas-${request.id}.pdf`,
        },
      },
    );

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
    },
    timeout: 0,
  })
  async initiateGeneratePartialPdf(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;

    const stats: any = await ctx.call('requests.requestStats', { id });

    const limit = 100;

    const childrenJobs: any[] = [];
    let index = 0;

    for (let i = 0; i < Math.ceil(stats.placesCount / limit); i++) {
      childrenJobs.push({
        params: { offset: limit * i, limit, id, type: 'places', index },
        name: 'jobs.requests',
        action: 'generatePartialPdf',
      });
      index++;
    }

    for (let i = 0; i < Math.ceil(stats.informationalFormsCount / limit); i++) {
      childrenJobs.push({
        params: { offset: limit * i, limit, id, type: 'forms', index },
        name: 'jobs.requests',
        action: 'generatePartialPdf',
      });
      index++;
    }

    return this.flow(
      ctx,
      'jobs.requests',
      'mergePartialPdfsAndSave',
      {
        id,
      },
      childrenJobs,
      { removeDependencyOnFailure: true },
    );

    return stats;
  }

  @Method
  async uploadPartialHtml(ctx: Context, url: string, folder: string, name: string) {
    const htmlResult = await new Promise(async (resolve, reject) => {
      fetch(url, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      })
        .then((r) => r.body?.getReader())
        .then(resolve)
        .catch((err) => {
          console.error(err);
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
      id: 'number',
    },
    queue: true,
    timeout: 0,
  })
  async mergePartialPdfsAndSave(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    const { job } = ctx.locals;

    const childrenValues = await job.getChildrenValues();
    const items: any[] = Object.values(childrenValues).sort((a: any, b: any) => a.index - b.index);

    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant',
      throwIfNotExist: true,
    });

    const pass = new PassThrough();

    const folder = this.getFolderName(request.createdBy as any as User, request.tenant as Tenant);

    // DO NOT WAIT
    ctx.call(
      'minio.uploadFile',
      {
        payload: pass,
        folder,
        isPrivate: true,
        types: FILE_TYPES,
      },
      {
        meta: {
          mimetype: 'application/pdf',
          filename: `israsas-${id}.pdf`,
        },
      },
    );

    let globalPageNumber = 1;

    const mergedPdf = await PDFLibDocument.create();

    for (const file of items) {
      const pdfBuffer = await fetch(file.url)
        .then((r) => r.arrayBuffer())
        .then((r) => Buffer.from(r));

      const pdf = await PDFLibDocument.load(pdfBuffer);
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach((page) => mergedPdf.addPage(page));

      // Flush to MinIO every 1000 pages to avoid RAM issues
      if (globalPageNumber / 1000 > 0) {
        const partialBuffer = Buffer.from(await mergedPdf.save());
        pass.write(partialBuffer);

        // Remove all pages from the merged PDF to avoid memory buildup
        while (mergedPdf.getPageCount() > 0) {
          mergedPdf.removePage(0);
        }
      }

      globalPageNumber += pdf.getPageCount();
    }

    // Save final batch
    const finalBuffer = Buffer.from(await mergedPdf.save());
    pass.write(finalBuffer);
    pass.end();
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
    },
    timeout: 0,
  })
  async generatePartialPdf(
    ctx: Context<{ id: number; type: string; offset?: number; limit: number; index: number }>,
  ) {
    const { id, type, limit, offset } = ctx.params;

    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant',
      throwIfNotExist: true,
    });

    const secret = getRequestSecret(request);

    const searchParams = new URLSearchParams({
      skey: 'admin_preview',
      secret,
      limit: `${limit}`,
      offset: `${offset}`,
    });

    const partialFolder = `temp/requests/pdf/${request.id}`;
    const partialFileName = type === 'intro' ? type : `${type}-${offset}-${offset + limit}`;

    const partialHtmlUrl = `${
      process.env.SERVER_HOST
    }/jobs/requests/${id}/html/${type}?${searchParams.toString()}`;

    const uploadedHtml: any = await this.uploadPartialHtml(
      ctx,
      partialHtmlUrl,
      partialFolder,
      partialFileName,
    );

    const pdf = await ctx.call('tools.makePdf', {
      url: uploadedHtml.presignedUrl,
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
          filename: `${partialFileName}.pdf`,
        },
      },
    );

    return {
      url: result.presignedUrl,
      index: ctx.params.index,
    };
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
              'Individų skaičius (gausumas)': form.quantity,
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

    function getInformationalFormsFeatures(informationalForms: { [key: string]: any }) {
      const result: any[] = [];

      Object.values(informationalForms)?.forEach((item) => {
        item?.forms?.forEach((form: any) => {
          let { features } = form.geom || [];
          const featuresToInsert = features.map((f: any) => {
            f.geometry.crs = { type: 'name', properties: { name: 'EPSG:3346' } };
            f.properties = {
              'Anketos ID': form.id,
              'Radavietės ID': '-',
              'Radavietės kodas': '-',
              ...getSpeciesData(form.species),
              'Individų skaičius (gausumas)': form.quantity,
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
              translates: requestData.translates,
              limit: batchSize,
              offset,
            });

        const informationalForms = stats.noInformationForms
          ? {}
          : await getInformationalForms(ctx, id, {
              date: requestData.requestDate,
              translates: requestData.translates,
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
    const requestData = await getRequestData(ctx, id);

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
    requestData?.places.forEach((place) => {
      params.set('place', `${place.id}`);
      data.push({
        url: getUrl(params),
        hash: place.hash,
      });
    });

    params.delete('place');

    // add all informational forms by species
    Object.values(requestData?.informationalForms).forEach((item) => {
      const formsIds = item.forms.map((item: any) => item.id).sort();
      params.set(
        'informationalForm',
        JSON.stringify({
          $in: formsIds,
        }),
      );
      data.push({
        url: getUrl(params),
        hash: item.hash,
      });
    });

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
    },
    rest: 'GET /:id/html',
    auth: AuthType.PUBLIC,
    timeout: 0,
  })
  async getRequestHtml(
    ctx: Context<
      { id: number; secret: string; skey: string },
      { $responseType: string; $responseHeaders: any }
    >,
  ) {
    ctx.meta.$responseType = 'text/html';

    const { id, secret, skey: screenshotsRedisKey } = ctx.params;

    const request: Request = await ctx.call('requests.resolve', { id });

    const secretToApprove = getRequestSecret(request);
    if (!request?.id || !secret || secret !== secretToApprove) {
      return throwNotFoundError('Invalid secret!');
    }

    const requestData = await getRequestData(ctx, id);

    let screenshotsByHash: any = {};

    if (screenshotsRedisKey !== 'admin_preview') {
      screenshotsByHash = await this.broker.cacher.get(`screenshots.${screenshotsRedisKey}`);
    }

    // set screenshots for places
    requestData?.places.forEach((p) => {
      p.screenshot = screenshotsByHash[p.hash] || '';
    });

    // set screenshots for informational forms
    Object.entries(requestData?.informationalForms).forEach(([key, value]) => {
      requestData.informationalForms[key].screenshot = screenshotsByHash[value.hash] || '';
    });

    requestData.previewScreenshot = screenshotsByHash[requestData.previewScreenshotHash] || '';

    const html = getTemplateHtml('request-pdf.ejs', requestData);

    return html;
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
    ctx.meta.$responseType = 'text/html';

    const { id, secret, skey: screenshotsRedisKey, offset, limit, type } = ctx.params;

    const request: Request = await ctx.call('requests.resolve', { id });

    const secretToApprove = getRequestSecret(request);
    if (!request?.id || !secret || secret !== secretToApprove) {
      return throwNotFoundError('Invalid secret!');
    }

    const requestData = await getRequestData(ctx, id, {
      loadPlaces: false,
      loadLegend: true,
      loadInformationalForms: false,
    });

    let screenshotsByHash: any = {};

    if (screenshotsRedisKey !== 'admin_preview') {
      screenshotsByHash = await this.broker.cacher.get(`screenshots.${screenshotsRedisKey}`);
    }

    if (type === 'places') {
      requestData.places = await getPlaces(ctx, id, {
        date: requestData.requestDate,
        translates: requestData.translates,
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
        translates: requestData.translates,
        limit: limit || 100,
        offset,
      });

      // set screenshots for informational forms
      Object.entries(requestData?.informationalForms).forEach(([key, value]) => {
        requestData.informationalForms[key].screenshot = screenshotsByHash[value.hash] || '';
      });
    } else if (type === 'intro') {
      // TODO: setup
      requestData.previewScreenshot = screenshotsByHash[requestData.previewScreenshotHash] || '';
    }

    const html = getTemplateHtml(`partials/${type}.ejs`, requestData);

    return html;
  }

  @Method
  getFolderName(user?: User, tenant?: Tenant) {
    const tenantPath = tenant?.id || 'private';
    const userPath = user?.id || 'user';

    return `uploads/requests/${tenantPath}/${userPath}`;
  }
}
