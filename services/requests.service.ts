'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
// @ts-ignore
import Cron from '@r2d2bzh/moleculer-cron';

import {
  ALL_FILE_TYPES,
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_DELETED_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  ContextMeta,
  DBPagination,
  EndpointType,
  EntityChangedParams,
  FieldHookCallback,
  TENANT_FIELD,
  throwNotFoundError,
  throwUnauthorizedError,
} from '../types';
import { UserAuthMeta } from './api.service';
import { RequestHistoryTypes } from './requests.histories.service';
import { Tenant } from './tenants.service';
import { User, USERS_DEFAULT_SCOPES, UserType } from './users.service';

import { getFeatureCollection } from 'geojsonjs';
import PostgisMixin, { GeometryType } from 'moleculer-postgis';
import moment from 'moment';
import {
  getInformationalFormsByRequestIds,
  getInformationalFormsByRequestIdsCount,
  getPlacesByRequestIds,
  getPlacesByRequestIdsCount,
} from '../utils/db.queries';
import { parseToObject, toReadableStream } from '../utils/functions';
import { getTemplateHtml } from '../utils/html';
import { emailCanBeSent, notifyOnFileGenerated, notifyOnRequestUpdate } from '../utils/mails';
import { getRequestData } from '../utils/pdf/requests';
import { getRequestSecret } from './jobs.requests.service';
import { Taxonomy } from './taxonomies.service';
import { TaxonomySpeciesType, TaxonomySpeciesTypeTranslate } from './taxonomies.species.service';

export const RequestType = {
  GET: 'GET',
  GET_ONCE: 'GET_ONCE',
  CHECK: 'CHECK',
};

export const RequestStatus = {
  CREATED: 'CREATED',
  RETURNED: 'RETURNED',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED',
  SUBMITTED: 'SUBMITTED',
};

export const RequestDocumentType = {
  PDF: 'PDF',
  GEOJSON: 'GEOJSON',
};

const TaxonomyTypes = {
  CLASS: 'CLASS',
  PHYLUM: 'PHYLUM',
  KINGDOM: 'KINGDOM',
  SPECIES: 'SPECIES',
};

const VISIBLE_TO_USER_SCOPE = 'visibleToUser';

const AUTH_PROTECTED_SCOPES = [...COMMON_DEFAULT_SCOPES, VISIBLE_TO_USER_SCOPE];
const WITHOUT_AUTH_SCOPES = [`-${VISIBLE_TO_USER_SCOPE}`];

type RequestStatusChanged = { statusChanged: boolean };
type RequestAutoApprove = { autoApprove: boolean };

export interface Request extends BaseModelInterface {
  taxonomies: Array<{
    id: number;
    taxonomy: string;
  }>;
  inheritedSpecies?: number[];
  generatedFile?: string;
  generatedFileGeojson?: string;
  speciesTypes: string[];
  status: string;
  tenant: number | Tenant;
  type: string;
  data: any;
  geom: any;
  documentTypes?: string[];
  notifyEmail?: string;
}

const populatePermissions = (field: string) => {
  return function (ctx: Context<{}, UserAuthMeta>, _values: any, requests: any[]) {
    const { user, profile } = ctx?.meta;
    return requests.map((r: any) => {
      const editingPermissions = this.hasPermissionToEdit(r, user, profile);
      return !!editingPermissions[field];
    });
  };
};

@Service({
  name: 'requests',

  mixins: [
    DbConnection({
      collection: 'requests',
      entityChangedOldEntity: true,
    }),
    PostgisMixin({
      srid: 3346,
    }),
    Cron,
  ],

  crons: [
    {
      name: 'removeExpiredRequests',
      cronTime: '0 4 * * *',
      async onTick() {
        const requests: Request[] = await this.call('requests.find', {
          query: {
            type: RequestType.GET,
            status: RequestStatus.APPROVED,
          },
        });

        const expiredRequests: Request[] = requests
          .filter((r) => !!r.data?.accessDate)
          .filter((r) => moment(r.data.accessDate).diff(moment()) < 0);

        for (const request of expiredRequests) {
          await this.call('requests.remove', {
            id: request.id,
            comment: 'Automatiškai panaikintas pasibaigusio galiojimo prieigos prašymas.',
          });
        }
      },
      timeZone: 'Europe/Vilnius',
    },
  ],

  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },

      type: {
        type: 'string',
        enum: Object.values(RequestType),
        default: RequestType.GET,
        immutable: true,
        validate: 'validateType',
      },

      status: {
        type: 'string',
        enum: Object.values(RequestStatus),
        default: RequestStatus.CREATED,
        validate: 'validateStatus',
        onCreate: function ({ ctx }: FieldHookCallback & ContextMeta<RequestAutoApprove>) {
          const { autoApprove } = ctx?.meta;
          return autoApprove ? RequestStatus.APPROVED : RequestStatus.CREATED;
        },
        onUpdate: function ({ ctx, value }: FieldHookCallback & ContextMeta<RequestStatusChanged>) {
          const { user, statusChanged } = ctx?.meta;
          if (!statusChanged) return;
          else if (!user?.id) return value;

          return value || RequestStatus.SUBMITTED;
        },
      },

      taxonomies: {
        type: 'array',
        onCreate: ({ value }: FieldHookCallback) => value || [],
        validate: 'validateTaxonomies',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              required: true,
            },
            taxonomy: {
              type: 'string',
              required: true,
              enum: Object.values(TaxonomyTypes),
            },
          },
        },
        populate(ctx: any, _values: any, requests: any[]) {
          return Promise.all(
            requests.map((request: any) => {
              return this.getTaxonomiesByRequest(request);
            }),
          );
        },
      },

      speciesTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: Object.values(TaxonomySpeciesType),
        },
        default: [TaxonomySpeciesType.ENDANGERED],
        validate: 'validateSpeciesTypes',
      },

      geom: {
        type: 'any',
        geom: {
          multi: true,
          types: [GeometryType.POLYGON, GeometryType.MULTI_POLYGON],
        },
      },

      canEdit: {
        type: 'boolean',
        virtual: true,
        populate: populatePermissions('edit'),
      },

      canValidate: {
        type: 'boolean',
        virtual: true,
        populate: populatePermissions('validate'),
      },

      inheritedSpecies: {
        virtual: true,
        type: 'array',
        populate(ctx: any, _values: any, requests: Request[]) {
          return Promise.all(
            requests.map((request) =>
              this.populateTaxonomies(
                request.taxonomies,
                request.speciesTypes,
                ctx?.params?.showHidden,
              ),
            ),
          );
        },
      },

      respondedAt: {
        type: 'date',
        columnType: 'datetime',
        readonly: true,
        set: ({
          ctx,
        }: FieldHookCallback & ContextMeta<RequestStatusChanged & RequestAutoApprove>) => {
          const { user, statusChanged, autoApprove } = ctx?.meta;
          const adminApprove = user?.type === UserType.ADMIN && statusChanged;
          if (!adminApprove && !autoApprove) return;
          return new Date();
        },
      },

      data: {
        type: 'object',
      },

      files: {
        type: 'array',
        columnType: 'json',
        items: { type: 'object' },
      },

      generatedFile: 'string',

      generatedFileGeojson: 'string',

      notifyEmail: {
        type: 'string',
        onCreate: ({ ctx, value }: FieldHookCallback) => {
          const { user } = ctx?.meta;
          return value || user?.email;
        },
      },

      documentTypes: {
        type: 'array',
        columnType: 'json',
        items: {
          type: 'string',
          enum: Object.values(RequestDocumentType),
        },
        get({ value, entity }: any) {
          if (entity.type !== RequestType.GET_ONCE) return;

          return Array.isArray(value) && value?.length ? value : [RequestDocumentType.PDF];
        },
      },

      ...TENANT_FIELD,
      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
      visibleToUser(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        const { user, profile } = ctx?.meta;
        if (!user?.id) return query;

        const createdByUserQuery = {
          createdBy: user?.id,
          tenant: { $exists: false },
        };

        if (profile?.id) {
          return { ...query, tenant: profile.id };
        } else if (user.type !== UserType.ADMIN) {
          return { ...query, ...createdByUserQuery };
        }

        return query;
      },
      tasks(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        const { user } = ctx?.meta;
        if (!user?.id) return query;

        const tasksQuery = this.getTasksQuery(user, query.status);
        return { ...query, ...tasksQuery };
      },
    },

    defaultScopes: AUTH_PROTECTED_SCOPES,
  },
  hooks: {
    before: {
      create: ['validateStatusChange'],
      update: ['validateStatusChange'],
    },
  },

  actions: {
    update: {
      additionalParams: {
        comment: { type: 'string', optional: true },
      },
    },
    remove: {
      additionalParams: {
        comment: { type: 'string', optional: true },
      },
    },
  },
})
export default class RequestsService extends moleculer.Service {
  @Action({
    rest: 'GET /:id/history',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getHistory(
    ctx: Context<{
      id: number;
      type?: string;
      page?: number;
      pageSize?: number;
    }>,
  ) {
    return ctx.call(`requests.histories.${ctx.params.type || 'list'}`, {
      sort: '-createdAt',
      query: {
        request: ctx.params.id,
      },
      page: ctx.params.page,
      pageSize: ctx.params.pageSize,
      populate: 'createdBy',
    });
  }

  @Action({
    params: {
      userId: {
        type: 'number',
        convert: true,
      },
    },
    cache: {
      keys: ['userId'],
    },
  })
  async getExpertSpecies(ctx: Context<{ userId: number }>) {
    const approvedRequests: Request[] = await ctx.call('requests.find', {
      query: {
        createdBy: ctx.params.userId,
        type: RequestType.CHECK,
        status: RequestStatus.APPROVED,
        tenant: { $exists: false },
      },
      showHidden: true,
      populate: 'inheritedSpecies',
      scope: WITHOUT_AUTH_SCOPES,
    });

    return approvedRequests.reduce((acc, r) => {
      return [...acc, ...r.inheritedSpecies];
    }, []);
  }

  @Action({
    rest: 'GET /tasks',
    types: [EndpointType.ADMIN],
  })
  async getTasks(ctx: Context<{}>) {
    return ctx.call('requests.list', {
      ...ctx.params,
      sort: 'updatedAt,createdAt',
      scope: 'tasks',
    });
  }

  @Action({
    rest: <RestSchema>{
      method: 'POST',
      path: '/upload',
      type: 'multipart',
      busboyConfig: {
        limits: {
          files: 1,
        },
      },
    },
  })
  async upload(ctx: Context<{}, UserAuthMeta>) {
    const folder = this.getFolderName(ctx.meta?.user, ctx.meta?.profile);
    return ctx.call('minio.uploadFile', {
      payload: ctx.params,
      isPrivate: true,
      types: ALL_FILE_TYPES,
      folder,
    });
  }

  @Action({
    params: {
      userId: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getTasksCount(ctx: Context<{ userId: number }>) {
    const user: User = await ctx.call('users.resolve', {
      id: ctx.params.userId,
      scope: USERS_DEFAULT_SCOPES,
    });

    if (user?.type !== UserType.ADMIN) {
      return 0;
    }

    const query = this.getTasksQuery(user);
    return this.countEntities(ctx, {
      query,
      scope: WITHOUT_AUTH_SCOPES,
    });
  }

  @Action({
    rest: 'GET /my',
    types: [EndpointType.ADMIN, EndpointType.TENANT_USER],
  })
  async my(ctx: Context<{ query: any }, UserAuthMeta>) {
    ctx.params.query = parseToObject(ctx.params.query);

    ctx.params.query = ctx.params.query || {};
    ctx.params.query.createdBy = ctx.meta.user.id;

    return ctx.call('requests.list', ctx.params);
  }

  @Action({
    rest: 'GET /deleted',
  })
  getDeleted(ctx: Context<{}>) {
    return ctx.call('requests.list', {
      ...ctx.params,
      scope: COMMON_DELETED_SCOPES,
    });
  }

  @Action({
    params: {
      userId: {
        type: 'number',
        convert: true,
      },
    },
  })
  async isExpertUser(ctx: Context<{ userId: number }>) {
    const userSpecies: number[] = await ctx.call('requests.getExpertSpecies', {
      userId: ctx.params.userId,
    });

    return !!userSpecies.length;
  }

  @Action({
    params: {
      speciesId: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getExpertsIdsBySpecies(ctx: Context<{ speciesId: number }>) {
    const approvedRequests: Request[] = await ctx.call('requests.find', {
      query: {
        type: RequestType.CHECK,
        status: RequestStatus.APPROVED,
        createdBy: { $exists: true },
      },
      showHidden: true,
      populate: 'inheritedSpecies',
      scope: WITHOUT_AUTH_SCOPES,
    });

    return Object.keys(
      approvedRequests.reduce((acc: any, r) => {
        const hasSpecies = r.inheritedSpecies.includes(ctx.params.speciesId);
        if (hasSpecies) {
          acc[r.createdBy] = true;
        }
        return acc;
      }, {}),
    ).map((i: string) => Number(i));
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    rest: 'POST /:id/generate/pdf',
    timeout: 0,
  })
  async generatePdf(ctx: Context<{ id: number }>) {
    const request: Request = await ctx.call('requests.resolve', {
      id: ctx.params.id,
      throwIfNotExist: true,
    });

    if (
      request.status !== RequestStatus.APPROVED ||
      request.type !== RequestType.GET_ONCE ||
      !request.documentTypes?.includes(RequestDocumentType.PDF)
    ) {
      throwUnauthorizedError('Cannot generate PDF');
    }

    const flow: any = await ctx.call('jobs.requests.initiatePdfGenerate', {
      id: ctx.params.id,
    });

    return {
      generating: !!flow?.job?.id,
    };
  }

  @Action({
    params: {
      id: 'number',
      url: 'string',
    },
  })
  saveGeneratedPdf(ctx: Context<{ id: number; url: string }>) {
    const { id, url: generatedFile } = ctx.params;

    return this.updateEntity(ctx, {
      id,
      generatedFile,
    });
  }

  @Action({
    params: {
      id: 'number',
      url: 'string',
    },
  })
  saveGeneratedGeojson(ctx: Context<{ id: number; url: string }>) {
    const { id, url: generatedFileGeojson } = ctx.params;

    return this.updateEntity(ctx, {
      id,
      generatedFileGeojson,
    });
  }

  @Action()
  async getExpertsIds(ctx: Context) {
    const approvedRequests: Request[] = await ctx.call('requests.find', {
      query: {
        type: RequestType.CHECK,
        status: RequestStatus.APPROVED,
        tenant: { $exists: false },
        createdBy: { $exists: true },
      },
      scope: WITHOUT_AUTH_SCOPES,
    });

    return Object.keys(
      approvedRequests.reduce((acc: any, r) => {
        acc[r.createdBy] = true;
        return acc;
      }, {}),
    ).map((i: any) => Number(i));
  }

  @Action({
    params: {
      id: [
        {
          type: 'number',
          convert: true,
        },
        {
          type: 'array',
          items: {
            type: 'number',
            convert: true,
          },
        },
      ],
      date: {
        type: 'string',
        optional: true,
      },
      limit: 'number|convert|optional',
      offset: 'number|convert|optional',
    },
    // cache: {
    //   keys: ['id', 'date'],
    // },
  })
  async getPlacesByRequest(
    ctx: Context<{ id: number | number[]; date: string; offset?: number; limit?: number }>,
  ) {
    const { id, date, limit, offset } = ctx.params;
    const ids = Array.isArray(id) ? id : [id];

    const requests: Request[] = await ctx.call('requests.resolve', {
      id: ids,
      populate: 'inheritedSpecies',
    });

    const result = await Promise.all(
      requests.map((request) =>
        getPlacesByRequestIds([request.id], request.inheritedSpecies, date, { limit, offset }),
      ),
    );

    if (!result || !result?.length) return [];

    const mapByPlace = result
      .reduce((acc, data) => [...acc, ...data], [])
      .reduce((acc: any, item: any) => ({ ...acc, [item.id]: item.geom }), {});

    return Object.keys(mapByPlace).reduce(
      (acc: any[], key: string) => [
        ...acc,
        {
          placeId: Number(key),
          geom: getFeatureCollection(mapByPlace[key]),
        },
      ],
      [],
    );
  }

  @Action({
    params: {
      id: [
        {
          type: 'number',
          convert: true,
        },
        {
          type: 'array',
          items: {
            type: 'number',
            convert: true,
          },
        },
      ],
      date: {
        type: 'string',
        optional: true,
      },
      limit: 'number|convert|optional',
      offset: 'number|convert|optional',
    },
    // cache: {
    //   keys: ['id', 'date'],
    // },
  })
  async getInfomationalFormsByRequest(
    ctx: Context<{ id: number | number[]; date: string; limit?: number; offset?: number }>,
  ) {
    const { id, date, offset, limit } = ctx.params;
    const ids = Array.isArray(id) ? id : [id];

    const requests: Request[] = await ctx.call('requests.resolve', {
      id: ids,
      populate: 'inheritedSpecies',
    });

    const result = await Promise.all(
      requests.map((request) =>
        getInformationalFormsByRequestIds([request.id], request.inheritedSpecies, date, {
          offset,
          limit,
        }),
      ),
    );

    if (!result || !result?.length) return [];

    const mapByForm = result
      .reduce((acc, data) => [...acc, ...data], [])
      .reduce((acc: any, item: any) => ({ ...acc, [item.id]: item.geom }), {});

    return Object.keys(mapByForm).reduce(
      (acc: any[], key: string) => [
        ...acc,
        {
          formId: Number(key),
          geom: getFeatureCollection(mapByForm[key]),
        },
      ],
      [],
    );
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    rest: 'GET /:id/pdf',
    types: [EndpointType.ADMIN],
    timeout: 0,
  })
  async getRequestPdf(ctx: Context<{ id: number }, { $responseType: string }>) {
    const { id } = ctx.params;

    const request: Request = await ctx.call('requests.resolve', {
      id,
      throwIfNotExist: true,
    });

    const requestData = await getRequestData(ctx, id);

    const secret = getRequestSecret(request);

    const footerHtml = getTemplateHtml('footer.ejs', {
      id,
      systemName: requestData.systemNameFooter,
    });

    const pdf = await ctx.call('tools.makePdf', {
      url: `${process.env.SERVER_HOST}/jobs/requests/${id}/html?secret=${secret}&skey=admin_preview`,
      footer: footerHtml,
    });

    ctx.meta.$responseType = 'application/pdf';
    return toReadableStream(pdf);
  }

  @Action({
    types: [EndpointType.ADMIN],
    params: {
      id: 'number|convert',
    },
    rest: '/:id/stats',
    timeout: 0,
  })
  async requestStats(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    const request: Request = await ctx.call('requests.resolve', {
      id,
      throwIfNotExist: true,
      populate: 'inheritedSpecies',
    });

    if (request.type !== RequestType.GET_ONCE) {
      throwUnauthorizedError('Cannot see stats for this request');
    }

    const requestData = await getRequestData(ctx, id, {
      loadPlaces: false,
      loadLegend: false,
      loadInformationalForms: false,
    });

    const { count: placesCount } = await getPlacesByRequestIdsCount(
      [request.id],
      request.inheritedSpecies,
      requestData.requestDate,
    );

    const { count: informationalFormsCount } = await getInformationalFormsByRequestIdsCount(
      [request.id],
      request.inheritedSpecies,
      requestData.requestDate,
    );

    return {
      placesCount: Number(placesCount) || 0,
      informationalFormsCount: Number(informationalFormsCount) || 0,
    };
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    rest: 'POST /:id/generate/geojson',
    timeout: 0,
  })
  async generateGeojson(ctx: Context<{ id: number }>) {
    const request: Request = await ctx.call('requests.resolve', {
      id: ctx.params.id,
      throwIfNotExist: true,
    });

    if (
      request.status !== RequestStatus.APPROVED ||
      request.type !== RequestType.GET_ONCE ||
      !request.documentTypes?.includes(RequestDocumentType.GEOJSON)
    ) {
      throwUnauthorizedError('Cannot generate geojson');
    }

    const job: any = await ctx.call('jobs.requests.initiateGeojsonGenerate', {
      id: ctx.params.id,
    });

    return {
      generating: !!job?.id,
    };
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    rest: 'GET /:id/geojson',
    timeout: 0,
  })
  async getGeojson(ctx: Context<{ id: number }, { $responseType: string; $responseHeaders: any }>) {
    const { id } = ctx.params;

    const request: Request = await ctx.call('requests.resolve', {
      id,
      throwIfNotExist: true,
    });

    if (request.status !== RequestStatus.APPROVED || request.type !== RequestType.GET_ONCE) {
      return throwNotFoundError('Cannot download request');
    }

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
        const { features } = form.geom || [];
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

        geojson.features.push(...featuresToInsert);
      });
    });

    Object.values(requestData.informationalForms)?.forEach((item) => {
      item?.forms?.forEach((form: any) => {
        const { features } = form.geom || [];
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

        geojson.features.push(...featuresToInsert);
      });
    });

    ctx.meta.$responseType = 'application/json';
    ctx.meta.$responseHeaders = {
      'Content-Disposition': `attachment; filename="request-${id}-geojson.json"`,
    };

    return geojson;
  }

  @Method
  async getAdminEmails() {
    const authUsers: DBPagination<any> = await this.broker.call(
      'auth.permissions.getUsersByAccess',
      {
        access: 'SPECIES_REQUESTS_EMAILS',
      },
    );

    return authUsers?.rows?.map((u) => u.email) || [];
  }

  @Method
  async getTaxonomiesByRequest(request: Request) {
    const taxonomyMap: any = {
      [TaxonomyTypes.KINGDOM]: {
        service: 'taxonomies.kingdoms',
        up: '',
      },
      [TaxonomyTypes.PHYLUM]: {
        service: 'taxonomies.phylums',
        up: 'kingdom',
      },
      [TaxonomyTypes.CLASS]: {
        service: 'taxonomies.classes',
        up: 'phylum',
      },
      [TaxonomyTypes.SPECIES]: {
        service: 'taxonomies.species',
        up: 'class',
      },
    };

    return Promise.all(
      request.taxonomies.map(async (taxonomy: any) => {
        const taxonomyServiceType = taxonomyMap[taxonomy.taxonomy];
        if (taxonomyServiceType?.service) {
          const populate = taxonomyServiceType.up;
          const taxonomyItem: any = await this.broker.call(
            `${taxonomyServiceType.service}.resolve`,
            { id: taxonomy.id, populate },
          );

          return {
            ...taxonomy,
            ...taxonomyItem,
          };
        }

        return taxonomy;
      }),
    );
  }

  @Method
  async validateStatusChange(
    ctx: Context<
      { id: number; type: string; speciesTypes: string[] },
      UserAuthMeta & RequestAutoApprove & RequestStatusChanged
    >,
  ) {
    const { id, type, speciesTypes } = ctx.params;

    const { user } = ctx.meta;
    if (!!id) {
      ctx.meta.statusChanged = true;
    } else if (user?.isExpert || user?.type === UserType.ADMIN) {
      ctx.meta.autoApprove = type === RequestType.GET_ONCE;
    } else if (speciesTypes?.includes(TaxonomySpeciesType.INVASIVE)) {
      ctx.meta.autoApprove = type === RequestType.GET_ONCE;
    }
    return ctx;
  }

  @Method
  getTasksQuery(user: User, status?: string) {
    if (!user?.id) return {};

    const statusFilters = [RequestStatus.CREATED, RequestStatus.SUBMITTED];

    if (user.type === UserType.ADMIN) {
      if (!status || !statusFilters.includes(status)) {
        return { status: { $in: statusFilters } };
      }
    }

    return {};
  }

  @Method
  hasPermissionToEdit(
    request: any,
    user?: User,
    profile?: Tenant,
  ): {
    edit: boolean;
    validate: boolean;
  } {
    const invalid = { edit: false, validate: false };

    const tenant = request.tenant || request.tenantId;

    if (
      !request?.id ||
      [RequestStatus.APPROVED, RequestStatus.REJECTED].includes(request?.status)
    ) {
      return invalid;
    }

    if (!user?.id) {
      return {
        edit: true,
        validate: true,
      };
    }

    const isCreatedByUser = !tenant && user && user.id === request.createdBy;
    const isCreatedByTenant = profile && profile.id === tenant;

    if (isCreatedByTenant || isCreatedByUser) {
      return {
        validate: false,
        edit: [RequestStatus.RETURNED].includes(request.status),
      };
    } else if (user.type === UserType.ADMIN) {
      return {
        edit: false,
        validate: [RequestStatus.CREATED, RequestStatus.SUBMITTED].includes(request.status),
      };
    }

    return invalid;
  }

  @Method
  async generatePdfIfNeeded(request: Request) {
    if (
      !request?.id ||
      request?.generatedFile ||
      request?.status !== RequestStatus.APPROVED ||
      request?.type !== RequestType.GET_ONCE ||
      !request?.documentTypes?.includes(RequestDocumentType.PDF)
    ) {
      return;
    }

    this.broker.call('requests.generatePdf', { id: request.id });
    return request;
  }

  @Method
  async generateGeojsonIfNeeded(request: Request) {
    if (
      !request?.id ||
      request?.generatedFileGeojson ||
      request?.status !== RequestStatus.APPROVED ||
      request?.type !== RequestType.GET_ONCE ||
      !request?.documentTypes?.includes(RequestDocumentType.GEOJSON)
    ) {
      return;
    }

    this.broker.call('requests.generateGeojson', { id: request.id });
    return request;
  }

  @Method
  createRequestHistory(request: number | string, meta: any, type: string, comment: string = '') {
    return this.broker.call(
      'requests.histories.create',
      {
        request,
        comment,
        type,
      },
      { meta },
    );
  }

  @Method
  async populateTaxonomies(
    taxonomies: Request['taxonomies'],
    speciesTypes?: string[],
    showHidden?: boolean,
  ) {
    const taxonomyMap: any = {
      [TaxonomyTypes.KINGDOM]: 'kingdomId',
      [TaxonomyTypes.PHYLUM]: 'phylumId',
      [TaxonomyTypes.CLASS]: 'classId',
      [TaxonomyTypes.SPECIES]: 'speciesId',
    };

    const speciesMap = new Map<number, boolean>();
    for (const taxonomyItem of taxonomies) {
      const { id, taxonomy } = taxonomyItem as any;
      const query: any = {
        [taxonomyMap[taxonomy]]: id,
      };

      if (speciesTypes?.length) {
        query.speciesType = { $in: speciesTypes };
      }

      if (showHidden) {
        query.showHidden = showHidden;
      }

      const result: Taxonomy[] = await this.broker.call('taxonomies.find', {
        query,
      });

      result?.forEach((t) => speciesMap.set(t.speciesId, true));
    }

    return [...speciesMap.keys()];
  }

  @Method
  async sendNotificationOnStatusChange(request: Request) {
    if (!emailCanBeSent()) return;

    if ([RequestStatus.SUBMITTED, RequestStatus.CREATED].includes(request.status)) {
      const emails = await this.getAdminEmails();
      if (!emails?.length) return;

      return emails.map((email) => {
        notifyOnRequestUpdate(email, request.status, request.id, request.type, false, true);
      });
    }

    const user: User = await this.broker.call('users.resolve', {
      id: request.createdBy,
      scope: USERS_DEFAULT_SCOPES,
    });

    const expertSpecies: any[] = await this.broker.call('requests.getExpertSpecies', {
      userId: user.id,
    });

    const approvedGetOnceRequest =
      request.status === RequestStatus.APPROVED && request.type === RequestType.GET_ONCE;

    const email = request.notifyEmail || user?.email;
    if (!email || approvedGetOnceRequest) return;

    notifyOnRequestUpdate(
      email,
      request.status,
      request.id,
      request.type,
      !!expertSpecies?.length,
      user.type === UserType.ADMIN,
    );
  }

  @Method
  getFolderName(user?: User, tenant?: Tenant) {
    const tenantPath = tenant?.id || 'private';
    const userPath = user?.id || 'user';

    return `uploads/requests/${tenantPath}/${userPath}`;
  }

  @Method
  validateStatus({ ctx, value, entity }: FieldHookCallback) {
    const { user, profile } = ctx.meta;
    if (!value || !user?.id) return true;

    const error = `Cannot set status with value ${value}`;
    if (!entity?.id) {
      return [RequestStatus.CREATED, RequestStatus.APPROVED].includes(value) || error;
    }

    const editingPermissions = this.hasPermissionToEdit(entity, user, profile);

    if (editingPermissions.edit) {
      return value === RequestStatus.SUBMITTED || error;
    } else if (editingPermissions.validate) {
      return (
        [RequestStatus.REJECTED, RequestStatus.RETURNED, RequestStatus.APPROVED].includes(value) ||
        error
      );
    }

    return error;
  }

  @Method
  validateType({ ctx, value }: FieldHookCallback) {
    const { user, profile } = ctx.meta;
    if (!user?.id) return true;

    const error = `Request type with value '${value}' cannot be set.`;
    if (profile?.id) {
      return [RequestType.GET, RequestType.GET_ONCE].includes(value) || error;
    } else if (user.isExpert) {
      return [RequestType.CHECK, RequestType.GET_ONCE].includes(value) || error;
    } else if (user.type === UserType.ADMIN) {
      return [RequestType.GET_ONCE].includes(value) || error;
    }

    return true;
  }

  @Method
  async validateTaxonomies({ ctx, value, entity, params }: FieldHookCallback) {
    const error = 'Invalid taxonomies';

    const valueHasItems = !!value?.length;
    const hadItems = !!entity?.taxonomies?.length;

    if (!valueHasItems && !hadItems) {
      return error;
    }

    if (valueHasItems) {
      const hasErrors = value.some((i: any) => !i.id || !i.taxonomy);
      if (hasErrors) return error;

      const speciesTypes = params.speciesTypes ||
        entity?.speciesTypes || [TaxonomySpeciesType.ENDANGERED];

      const items = await this.populateTaxonomies(value, speciesTypes);
      if (!items?.length) return error;
    }

    return true;
  }

  @Method
  async validateSpeciesTypes({ ctx, value }: FieldHookCallback) {
    const error = 'Invalid species types';
    const { user, profile } = ctx.meta;

    if (!Array.isArray(value)) return error;

    if (value.includes(TaxonomySpeciesType.ENDANGERED) && value.length > 1) {
      return error;
    } else if (value.includes(TaxonomySpeciesType.INTRODUCED)) {
      return user?.isExpert || user?.type === UserType.ADMIN || error;
    }

    return true;
  }

  @Event()
  async 'requests.**'() {
    this.broker.emit(`cache.clean.${this.fullName}`);
  }

  @Event()
  async 'cache.clean.requests'() {
    await this.broker.cacher?.clean(`${this.fullName}.**`);
  }

  @Method
  async sendNotificationOnFileGenerated(ctx: Context, request: Request, documentType: string) {
    const documentTypeTranslates = {
      [RequestDocumentType.PDF]: 'PDF',
      [RequestDocumentType.GEOJSON]: 'GeoJSON',
    };
    const translate = documentTypeTranslates[documentType];
    const text = translate ? `Paruoštas išrašas ${translate} formatu` : '';
    await this.createRequestHistory(request.id, null, RequestHistoryTypes.FILE_GENERATED, text);

    if (!emailCanBeSent()) return;

    const user: User = await ctx.call('users.resolve', {
      id: request.createdBy,
      scope: USERS_DEFAULT_SCOPES,
    });

    const isExpert = await ctx.call('requests.isExpertUser', {
      userId: user.id,
    });

    notifyOnFileGenerated(
      request.notifyEmail || user.email,
      request.id,
      !!(!request.tenant && isExpert),
      user.type === UserType.ADMIN,
    );
  }

  @Event()
  async 'requests.updated'(ctx: Context<EntityChangedParams<Request>>) {
    const { oldData: prevRequest, data: request } = ctx.params;

    if (prevRequest?.status !== request.status) {
      const { comment } = ctx.options?.parentCtx?.params as any;
      const typesByStatus = {
        [RequestStatus.SUBMITTED]: RequestHistoryTypes.UPDATED,
        [RequestStatus.REJECTED]: RequestHistoryTypes.REJECTED,
        [RequestStatus.RETURNED]: RequestHistoryTypes.RETURNED,
        [RequestStatus.APPROVED]: RequestHistoryTypes.APPROVED,
      };

      await this.createRequestHistory(request.id, ctx.meta, typesByStatus[request.status], comment);

      await this.generatePdfIfNeeded(request);
      await this.generateGeojsonIfNeeded(request);
      this.sendNotificationOnStatusChange(request);
    }

    // Send notification that PDF is prepared
    if (prevRequest?.generatedFile !== request.generatedFile && !!request.generatedFile) {
      await this.sendNotificationOnFileGenerated(ctx, request, RequestDocumentType.PDF);
    }

    // Send notification that GeoJSON is prepared
    if (
      prevRequest?.generatedFileGeojson !== request.generatedFileGeojson &&
      !!request.generatedFileGeojson
    ) {
      await this.sendNotificationOnFileGenerated(ctx, request, RequestDocumentType.GEOJSON);
    }
  }

  @Event()
  async 'requests.created'(ctx: Context<EntityChangedParams<Request>>) {
    const { data: request } = ctx.params;

    await this.createRequestHistory(request.id, ctx.meta, RequestHistoryTypes.CREATED);
    if (request.status === RequestStatus.APPROVED) {
      await this.createRequestHistory(
        request.id,
        null,
        RequestHistoryTypes.APPROVED,
        'Automatiškai patvirtintas prašymas.',
      );
      await this.generatePdfIfNeeded(request);
      await this.generateGeojsonIfNeeded(request);
    } else {
      this.sendNotificationOnStatusChange(request);
    }
  }

  @Event()
  async 'requests.removed'(ctx: Context<EntityChangedParams<Request>>) {
    const { data: request } = ctx.params;
    const { comment } = ctx.options?.parentCtx?.params as any;

    if (request?.type === RequestType.CHECK && request?.createdBy) {
      await this.broker.cacher?.clean(`${this.fullName}.**`);
      // remove expert from forms where he/she is assignee and form is still active
      await ctx.call('forms.checkAssignmentsForUser', {
        userId: request.createdBy,
      });
    }

    await this.createRequestHistory(
      request.id,
      ctx.meta,
      RequestHistoryTypes.DELETED,
      comment || '',
    );
  }
}
