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
    let index = 0;

    childrenJobs.push({
      params: { id, type: 'intro', screenshotsHash },
      name: 'jobs.requests',
      action: 'generatePartialPdf',
    });

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
      'mergePartialPdfsAndSave',
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

  @Action()
  async countPagesForEachPdf(ctx: Context) {
    const { job } = ctx.locals;

    // const childrenValues = await job?.getChildrenValues();
    // const items: any[] = Object.values(childrenValues).sort((a: any, b: any) => a.index - b.index);

    const items = [
      {
        url: 'http://127.0.0.1:3000/rusys/minio/rusys/temp/requests/pdf/182/forms-0-50-IL0BYLVO0xYXTXogcY5v.pdf',
        index: '',
      },
      {
        url: 'http://127.0.0.1:3000/rusys/minio/rusys/temp/requests/pdf/182/intro-IUcs6V4J7wDnB1XxmXMD.pdf',
        index: '',
      },
    ];

    for (const item of items) {
      const pdfBuffer = await fetch(item.url)
        .then((r) => r.arrayBuffer())
        .then((arrayBuffer) => Buffer.from(arrayBuffer))
        .catch((err) => {
          console.log(item.url, err);
        });

      if (!pdfBuffer) return;

      const pdfReaderStream = new muhammara.PDFRStreamForBuffer(pdfBuffer);
      const pdfReader = muhammara.createReader(pdfReaderStream);
      const count = pdfReader.getPagesCount();

      // muhammara.createWriter()

      console.log(item.url, count);
    }
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
    const pdfWriter = muhammara.createWriter(new muhammara.PDFStreamForResponse(pass));
    const folder = this.getFolderName(request.createdBy as any as User, request.tenant as Tenant);

    const uploadPromise: any = ctx.call(
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

    for (const file of items) {
      const pdfBuffer = await fetch(file.url)
        .then((r) => r.arrayBuffer())
        .then((arrayBuffer) => Buffer.from(arrayBuffer));

      const pdfReader = new muhammara.PDFRStreamForBuffer(pdfBuffer);
      pdfWriter.appendPDFPagesFromPDF(pdfReader);
    }

    pdfWriter.end();
    pass.end();

    await uploadPromise;

    // await ctx.call('requests.saveGeneratedPdf', {
    //   id,
    //   url: uploadPromise.url,
    // });

    return { job: job.id, url: uploadPromise.url };
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
  ) {
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

    const partialFolder = `temp/requests/pdf/${request.id}`;
    const partialFileNamePrefix = type === 'intro' ? type : `${type}-${offset}-${offset + limit}`;
    const partialFileName = `${partialFileNamePrefix}-${getPublicFileName(20)}`;

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
      // url: uploadedHtml.presignedUrl,
      // TODO: remove
      url: uploadedHtml.url.replace('localhost', 'host.docker.internal'),
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
}
