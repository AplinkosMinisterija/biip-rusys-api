'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import moment from 'moment';
import BullMqMixin from '../mixins/bullmq.mixin';
import { FILE_TYPES, throwNotFoundError, throwValidationError } from '../types';
import { toMD5Hash, toReadableStream } from '../utils/functions';
import { getTemplateHtml } from '../utils/html';
import { getMapsSearchParams, getRequestData } from '../utils/pdf/requests';
import { AuthType } from './api.service';
import { Request } from './requests.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';
import { TaxonomySpeciesType, TaxonomySpeciesTypeTranslate } from './taxonomies.species.service';

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
  async generateAndSaveGeojson(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    const { job } = ctx.locals;

    const request: Request = await ctx.call('requests.resolve', {
      id,
      populate: 'createdBy,tenant',
      throwIfNotExist: true,
    });

    const requestData = await getRequestData(ctx, id);

    const geojson: any = {
      type: 'FeatureCollection',
      features: [],
    };

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

    requestData.places?.forEach((place) => {
      const speciesInfo = getSpeciesData(place.species);
      place.forms?.forEach((form) => {
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

        geojson.features.push(...featuresToInsert);
      });
    });

    Object.values(requestData.informationalForms)?.forEach((item) => {
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

        geojson.features.push(...featuresToInsert);
      });
    });

    const folder = this.getFolderName(request.createdBy as any as User, request.tenant as Tenant);

    const result: any = await ctx.call(
      'minio.uploadFile',
      {
        payload: JSON.stringify(geojson),
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

    return { job: job.id, url: result.url };
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

  @Method
  getFolderName(user?: User, tenant?: Tenant) {
    const tenantPath = tenant?.id || 'private';
    const userPath = user?.id || 'user';

    return `uploads/requests/${tenantPath}/${userPath}`;
  }
}
