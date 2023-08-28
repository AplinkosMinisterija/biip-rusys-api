'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';

import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  BaseModelInterface,
  TENANT_FIELD,
  COMMON_DELETED_SCOPES,
  EndpointType,
  FieldHookCallback,
  ContextMeta,
  EntityChangedParams,
  FILE_TYPES,
  ALL_FILE_TYPES,
  throwNotFoundError,
} from '../types';
import { AuthType, UserAuthMeta } from './api.service';
import { RequestHistoryTypes } from './requests.histories.service';
import { Tenant } from './tenants.service';
import { User, USERS_DEFAULT_SCOPES, UserType } from './users.service';

import { TaxonomySpeciesType } from './taxonomies.species.service';
import {
  emailCanBeSent,
  notifyOnRequestUpdate,
  notifyOnFileGenerated,
} from '../utils/mails';
import { Taxonomy } from './taxonomies.service';
import _ from 'lodash';
import {
  getInformationalFormsByRequestIds,
  getPlacesByRequestIds,
} from '../utils/db.queries';
import PostgisMixin, { GeometryType } from 'moleculer-postgis';
import { getFeatureCollection } from 'geojsonjs';

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
  speciesTypes: string[];
  status: string;
  tenant: number | Tenant;
  type: string;
  data: any;
  geom: any;
}

const populatePermissions = (field: string) => {
  return function (
    ctx: Context<{}, UserAuthMeta>,
    _values: any,
    requests: any[]
  ) {
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
        onCreate: function ({
          ctx,
        }: FieldHookCallback & ContextMeta<RequestAutoApprove>) {
          const { autoApprove } = ctx?.meta;
          return autoApprove ? RequestStatus.APPROVED : RequestStatus.CREATED;
        },
        onUpdate: function ({
          ctx,
          value,
        }: FieldHookCallback & ContextMeta<RequestStatusChanged>) {
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
            })
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
              this.populateTaxonomies(request.taxonomies, request.speciesTypes)
            )
          );
        },
      },

      respondedAt: {
        type: 'date',
        columnType: 'datetime',
        readonly: true,
        set: ({
          ctx,
        }: FieldHookCallback & ContextMeta<RequestStatusChanged>) => {
          const { user, statusChanged } = ctx?.meta;
          if (user?.type !== UserType.ADMIN || !statusChanged) return;
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

      notifyEmail: {
        type: 'string',
        onCreate: ({ ctx, value }: FieldHookCallback) => {
          const { user } = ctx?.meta;
          return value || user?.email;
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
    }>
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
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    auth: AuthType.PUBLIC,
    rest: 'GET /:id/geom',
  })
  async getRequestGeom(ctx: Context<{ id: number }>) {
    const request: Request = await ctx.call('requests.resolve', {
      id: ctx.params.id,
      populate: 'geom',
      throwIfNotExist: true,
    });

    return {
      geom: request?.geom,
    };
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
    if (typeof ctx.params.query === 'string') {
      ctx.params.query = JSON.parse(ctx.params.query);
    }

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
      }, {})
    ).map((i: string) => Number(i));
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    rest: 'POST /:id/generate',
    timeout: 0,
  })
  async generatePdf(ctx: Context<{ id: number }>) {
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
      }, {})
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
    },
    // cache: {
    //   keys: ['id', 'date'],
    // },
  })
  async getPlacesByRequest(
    ctx: Context<{ id: number | number[]; date: string }>
  ) {
    const { id, date } = ctx.params;
    const ids = Array.isArray(id) ? id : [id];

    const requests: Request[] = await ctx.call('requests.resolve', {
      id: ids,
      populate: 'inheritedSpecies',
    });

    const result = await Promise.all(
      requests.map((request) =>
        getPlacesByRequestIds([request.id], request.inheritedSpecies, date)
      )
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
      []
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
    },
    // cache: {
    //   keys: ['id', 'date'],
    // },
  })
  async getInfomationalFormsByRequest(
    ctx: Context<{ id: number | number[]; date: string }>
  ) {
    const { id, date } = ctx.params;
    const ids = Array.isArray(id) ? id : [id];

    const requests: Request[] = await ctx.call('requests.resolve', {
      id: ids,
      populate: 'inheritedSpecies',
    });

    const result = await Promise.all(
      requests.map((request) =>
        getInformationalFormsByRequestIds(
          [request.id],
          request.inheritedSpecies,
          date
        )
      )
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
      []
    );
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
            { id: taxonomy.id, populate }
          );

          return {
            ...taxonomy,
            ...taxonomyItem,
          };
        }

        return taxonomy;
      })
    );
  }

  @Method
  async validateStatusChange(
    ctx: Context<
      { id: number; type: string },
      UserAuthMeta & RequestAutoApprove & RequestStatusChanged
    >
  ) {
    const { id, type } = ctx.params;

    const { user } = ctx.meta;
    if (!!id) {
      ctx.meta.statusChanged = true;
    } else if (user?.isExpert || user?.type === UserType.ADMIN) {
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
    profile?: Tenant
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
        validate: [RequestStatus.CREATED, RequestStatus.SUBMITTED].includes(
          request.status
        ),
      };
    }

    return invalid;
  }

  @Method
  async generatePdfIfNeeded(request: Request) {
    if (!request || !request.id) return;

    if (
      request.status !== RequestStatus.APPROVED ||
      request.type !== RequestType.GET_ONCE
    ) {
      return;
    }

    if (request.generatedFile) return;

    this.broker.call('requests.generatePdf', { id: request.id });
    return request;
  }

  @Method
  createRequestHistory(
    request: number | string,
    meta: any,
    type: string,
    comment: string = ''
  ) {
    return this.broker.call(
      'requests.histories.create',
      {
        request,
        comment,
        type,
      },
      { meta }
    );
  }

  @Method
  async populateTaxonomies(
    taxonomies: Request['taxonomies'],
    speciesTypes?: string[]
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

    const notifyAdmin = request.status === RequestStatus.SUBMITTED;

    if (notifyAdmin) return;

    const user: User = await this.broker.call('users.resolve', {
      id: request.createdBy,
      scope: USERS_DEFAULT_SCOPES,
    });

    const approvedGetOnceRequest =
      request.status === RequestStatus.APPROVED &&
      request.type === RequestType.GET_ONCE;

    if (!user?.email || approvedGetOnceRequest) return;

    notifyOnRequestUpdate(
      user.email,
      request.status,
      request.id,
      request.type,
      notifyAdmin,
      user.type === UserType.ADMIN
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
      return (
        [RequestStatus.CREATED, RequestStatus.APPROVED].includes(value) || error
      );
    }

    const editingPermissions = this.hasPermissionToEdit(entity, user, profile);

    if (editingPermissions.edit) {
      return value === RequestStatus.SUBMITTED || error;
    } else if (editingPermissions.validate) {
      return (
        [
          RequestStatus.REJECTED,
          RequestStatus.RETURNED,
          RequestStatus.APPROVED,
        ].includes(value) || error
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

      await this.createRequestHistory(
        request.id,
        ctx.meta,
        typesByStatus[request.status],
        comment
      );

      await this.generatePdfIfNeeded(request);
      await this.sendNotificationOnStatusChange(request);
    }

    if (
      prevRequest?.generatedFile !== request.generatedFile &&
      !!request.generatedFile
    ) {
      await this.createRequestHistory(
        request.id,
        null,
        RequestHistoryTypes.FILE_GENERATED
      );

      if (emailCanBeSent()) {
        const user: User = await ctx.call('users.resolve', {
          id: request.createdBy,
          scope: USERS_DEFAULT_SCOPES,
        });

        const isExpert = await ctx.call('requests.isExpertUser', {
          userId: user.id,
        });

        notifyOnFileGenerated(
          user.email,
          request.id,
          !!(!request.tenant && isExpert),
          user.type === UserType.ADMIN
        );
      }
    }
  }

  @Event()
  async 'requests.created'(ctx: Context<EntityChangedParams<Request>>) {
    const { data: request } = ctx.params;

    await this.createRequestHistory(
      request.id,
      ctx.meta,
      RequestHistoryTypes.CREATED
    );
    if (request.status === RequestStatus.APPROVED) {
      await this.createRequestHistory(
        request.id,
        null,
        RequestHistoryTypes.APPROVED,
        'Automatiškai patvirtintas prašymas.'
      );
      await this.generatePdfIfNeeded(request);
    }
  }

  @Event()
  async 'requests.removed'(ctx: Context<EntityChangedParams<Request>>) {
    const { data: request } = ctx.params;
    const { comment } = ctx.options?.parentCtx?.params as any;

    if (request?.type === RequestType.CHECK && request?.createdBy) {
      // remove expert from forms where he/she is assignee and form is still active
      await ctx.call('forms.checkAssignmentsForUser', {
        userId: request.createdBy,
      });
    }

    await this.createRequestHistory(
      request.id,
      ctx.meta,
      RequestHistoryTypes.DELETED,
      comment || ''
    );
  }
}
