'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';

import DbConnection, { MaterializedView } from '../mixins/database.mixin';
import GeometriesMixin, {
  areaFn,
  distanceFn,
} from '../mixins/geometries.mixin';

import moment from 'moment';

import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  TENANT_FIELD,
  FieldHookCallback,
  BaseModelInterface,
  USER_PUBLIC_GET,
  EndpointType,
  ContextMeta,
  EntityChangedParams,
  DBPagination,
  USER_PUBLIC_POPULATE,
  queryBoolean,
} from '../types';
import { UserAuthMeta } from './api.service';

import { FormHistoryTypes } from './forms.histories.service';
import { Place } from './places.service';
import { Tenant } from './tenants.service';
import { User, USERS_DEFAULT_SCOPES, UserType } from './users.service';
import {
  geometryFromText,
  geometryToGeom,
  GeomFeatureCollection,
} from '../modules/geometry';
import {
  emailCanBeSent,
  notifyFormAssignee,
  notifyOnFormUpdate,
} from '../utils/mails';
import { Taxonomy } from './taxonomies.service';
import _ from 'lodash';
import { FormType } from './forms.types.service';

export const FormStatus = {
  CREATED: 'CREATED',
  SUBMITTED: 'SUBMITTED',
  REJECTED: 'REJECTED',
  RETURNED: 'RETURNED',
  APPROVED: 'APPROVED',
};

const VISIBLE_TO_USER_SCOPE = 'visibleToUser';

const AUTH_PROTECTED_SCOPES = [...COMMON_DEFAULT_SCOPES, VISIBLE_TO_USER_SCOPE];
const WITHOUT_AUTH_SCOPES = [`-${VISIBLE_TO_USER_SCOPE}`];

type FormStatusChanged = { statusChanged: boolean };
type FormPlaceChanged = { placeChanged: boolean };
type FormAutoApprove = { autoApprove: boolean };

const nonEditableStatuses = [FormStatus.APPROVED, FormStatus.REJECTED];

const FormStates = {
  RELEVANT: 'RELEVANT',
  IRRELEVANT: 'IRRELEVANT',
  PREARCHIVAL: 'PREARCHIVAL',
  INFORMATIONAL: 'INFORMATIONAL',
  ARCHIVAL: 'ARCHIVAL',
};

const populatePermissions = (field: string) => {
  return function (ctx: Context<{}, UserAuthMeta>, _values: any, forms: any[]) {
    const { user, profile } = ctx?.meta;
    return forms.map((form: any) => {
      const editingPermissions = this.hasPermissionToEdit(form, user, profile);
      return !!editingPermissions[field];
    });
  };
};

async function validateActivity({
  ctx,
  params,
  entity,
  value,
}: FieldHookCallback) {
  const speciesId = entity?.speciesId || params?.species;

  const formType = await this.getFormType(ctx, speciesId);
  const validate = !entity?.id || !!value;

  if (validate) {
    const isValid = await this.broker.call('forms.types.validateActivity', {
      type: formType,
      activity: value,
    });

    if (!isValid) {
      throw new moleculer.Errors.ValidationError('Invalid activity');
    }
  }

  return value;
}

async function validateEvolution({
  ctx,
  params,
  entity,
  value,
}: FieldHookCallback) {
  const speciesId = entity?.speciesId || params?.species;

  const formType = await this.getFormType(ctx, speciesId);
  const validate = !entity?.id || !!value;

  if (validate) {
    const isValid = await this.broker.call('forms.types.validateEvolution', {
      type: formType,
      evolution: value,
      activity: params?.activity || entity?.activity,
    });

    if (!isValid) {
      throw new moleculer.Errors.ValidationError('Invalid evolution');
    }
  }

  return value;
}

async function validateMethod({
  ctx,
  params,
  entity,
  value,
}: FieldHookCallback) {
  const speciesId = entity?.speciesId || params?.species;

  const formType = await this.getFormType(ctx, speciesId);
  const validate = !entity?.id || !!value;

  if (validate) {
    const isValid = await this.broker.call('forms.types.validateMethod', {
      type: formType,
      method: value,
    });

    if (!isValid) {
      throw new moleculer.Errors.ValidationError('Invalid method');
    }
  }

  return value;
}

export interface Form extends BaseModelInterface {
  status: string;
  state: string;
  assignee: number | User;
  place: number | Place;
  quantity: number;
  description: string;
  species: number | Taxonomy;
  tenant: number | Tenant;
  observedAt: Date | string;
  activity?: string;
  evolution?: string;
  method?: string;
  geomBufferSize?: number;
  isInformational: boolean;
  isRelevant: boolean;
  geom: any;
}

@Service({
  name: 'forms',

  mixins: [
    DbConnection({
      collection: 'forms',
      entityChangedOldEntity: true,
    }),
    GeometriesMixin,
  ],

  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },

      quantity: {
        type: 'number',
        validate: 'validateQuantity',
        integer: true,
      },

      activity: {
        type: 'string',
        onCreate: validateActivity,
        onUpdate: validateActivity,
        onReplace: validateActivity,
      },

      evolution: {
        type: 'string',
        onCreate: validateEvolution,
        onUpdate: validateEvolution,
        onReplace: validateEvolution,
      },

      method: {
        type: 'string',
        onCreate: validateMethod,
        onUpdate: validateMethod,
        onReplace: validateMethod,
      },

      methodValue: {
        type: 'string',
      },

      description: 'string',

      notes: 'string',

      status: {
        type: 'string',
        enum: Object.values(FormStatus),
        validate: 'validateStatus',
        onCreate: function ({
          ctx,
        }: FieldHookCallback & ContextMeta<FormAutoApprove>) {
          const { autoApprove } = ctx?.meta;
          return autoApprove ? FormStatus.APPROVED : FormStatus.CREATED;
        },
        onUpdate: function ({
          ctx,
          value,
        }: FieldHookCallback & ContextMeta<FormStatusChanged>) {
          const { user } = ctx?.meta;
          if (!ctx?.meta?.statusChanged) return;
          else if (!user?.id) return value;

          return value || FormStatus.SUBMITTED;
        },
      },

      geom: {
        type: 'any',
        raw: true,
        async populate(ctx: any, _values: any, forms: Form[]) {
          const result = await ctx.call('forms.getGeometryJson', {
            id: forms.map((f) => f.id),
            propertiesById: forms.reduce((acc: any, form) => {
              if (!form.geomBufferSize) return acc;

              acc[`${form.id}`] = {
                bufferSize: form.geomBufferSize,
              };

              return acc;
            }, {}),
          });

          return forms.map((form) => result[`${form.id}`] || {});
        },
      },

      geomBufferSize: {
        type: 'number',
        hidden: 'byDefault',
      },

      state: {
        type: 'string',
        virtual: true,
        get: async function ({ entity }: FieldHookCallback) {
          if (entity.status !== FormStatus.APPROVED) return;

          if (entity.isInformational) return FormStates.INFORMATIONAL;

          const diffYears = moment().diff(moment(entity.observedAt), 'years');
          if (diffYears >= 10) return FormStates.ARCHIVAL;
          else if (diffYears >= 9) return FormStates.PREARCHIVAL;
          else if (!entity.isRelevant) return FormStates.IRRELEVANT;
          return FormStates.RELEVANT;
        },
      },

      assignee: {
        type: 'number',
        columnType: 'integer',
        columnName: 'assigneeId',
        populate: USER_PUBLIC_POPULATE,
        validate: 'validateAssignee',
        get: USER_PUBLIC_GET,
        async onCreate({
          ctx,
          params,
        }: FieldHookCallback & ContextMeta<FormAutoApprove>) {
          if (ctx?.meta?.autoApprove) return;

          return ctx.call('forms.getAssigneeForForm', {
            species: params.species,
            createdBy: ctx.meta?.user?.id,
          });
        },
      },

      place: {
        type: 'number',
        columnType: 'integer',
        columnName: 'placeId',
        populate: 'places.resolve',
        set: async function ({
          ctx,
          entity,
          value,
          params,
        }: FieldHookCallback &
          ContextMeta<FormStatusChanged> &
          ContextMeta<FormPlaceChanged> &
          ContextMeta<FormAutoApprove>) {
          const { statusChanged, autoApprove, placeChanged } = ctx?.meta;
          const isInformational =
            params?.isInformational || entity?.isInformational;

          const assignPlace =
            (statusChanged && params?.status === FormStatus.APPROVED) ||
            placeChanged;

          if (isInformational || !assignPlace || autoApprove) return;

          const speciesId = params?.species || entity?.speciesId;
          if (value) return value;
          else if (!value && entity?.placeId) return entity.placeId;
          else if (speciesId) {
            const place: Place = await ctx.call('places.create', {
              species: speciesId,
            });

            return place.id;
          }
        },
      },

      species: {
        type: 'number',
        columnType: 'integer',
        columnName: 'speciesId',
        required: true,
        immutable: true,
        populate(ctx: any, _values: any, forms: any[]) {
          return Promise.all(
            forms.map((form) => {
              return ctx.call('taxonomies.findBySpeciesId', {
                id: form.speciesId,
                showHidden: true,
              });
            })
          );
        },
      },

      source: {
        type: 'number',
        columnName: 'sourceId',
        populate: 'forms.settings.sources.resolve',
      },

      eunis: {
        type: 'number',
        columnName: 'eunisId',
        populate: 'forms.settings.eunis.resolve',
        validate: function ({ ctx, value }: FieldHookCallback) {
          const { user } = ctx.meta;
          if (!value || !user?.id) return true;
          return user?.isExpert || 'Eunis can be set by expert only';
        },
      },

      transect: {
        type: 'object',
        properties: {
          width: {
            type: 'number',
            required: true,
            integer: true,
            min: 1,
          },
          height: {
            type: 'number',
            required: true,
            integer: true,
            min: 1,
          },
          unit: {
            type: 'string',
            required: true,
            enum: ['METER', 'CENTIMETER'],
          },
        },
      },

      observedBy: {
        type: 'string',
        onCreate({ ctx, value }: FieldHookCallback) {
          if (!ctx?.meta?.user?.id || value) return value;

          return `${ctx.meta?.user?.firstName} ${ctx.meta?.user?.lastName}`;
        },
        get: async ({ entity, ctx, value }: FieldHookCallback) => {
          if (value) return value;

          if (!entity.createdBy) return;

          const user: User = await ctx.call('users.resolve', {
            id: entity.createdBy,
            fields: ['firstName', 'lastName'],
          });

          return `${user.firstName} ${user.lastName}`;
        },
      },

      observedAt: {
        type: 'date',
        columnType: 'datetime',
        onCreate: ({ value }: FieldHookCallback) => value || new Date(),
      },

      isRelevant: {
        type: 'boolean',
        default: true,
        validate: 'validateIsRelevant',
        onCreate: function ({ value, params }: FieldHookCallback) {
          if (params?.isInformational) return true;
          return !!value;
        },
      },

      isInformational: {
        type: 'boolean',
        default: false,
        immutable: true,
      },

      respondedAt: {
        type: 'date',
        columnType: 'datetime',
        readonly: true,
        set: ({ ctx }: FieldHookCallback & ContextMeta<FormStatusChanged>) => {
          const { user, statusChanged } = ctx?.meta;
          if (!user?.isExpert || !statusChanged) return;
          return new Date();
        },
      },

      deadlineAt: {
        type: 'date',
        columnType: 'datetime',
        readonly: true,
        set: function ({
          ctx,
          entity,
        }: FieldHookCallback &
          ContextMeta<FormAutoApprove> &
          ContextMeta<FormStatusChanged>) {
          const { user, profile, autoApprove, statusChanged } = ctx?.meta;
          if (autoApprove || (!!entity?.id && !statusChanged)) return;
          else if (entity?.id) {
            const permissions = this.hasPermissionToEdit(entity, user, profile);
            if (!permissions.edit) return;
          }

          return moment().add(1, 'week').format();
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

      photos: {
        type: 'array',
        columnType: 'json',
        items: { type: 'object' },
      },

      ...TENANT_FIELD,

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
      visibleToUser(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        const { user, profile } = ctx?.meta;
        if (!user?.id || user?.type === UserType.ADMIN) return query;

        const createdByUserQuery = {
          createdBy: user?.id,
          tenant: { $exists: false },
        };

        if (profile?.id) {
          return { ...query, tenant: profile.id };
        } else if (user.type === UserType.USER && !user.isExpert) {
          return { ...query, ...createdByUserQuery };
        }

        if (query.createdBy === user.id) {
          return { ...query, ...createdByUserQuery };
        }

        if (query.place || query.createdBy) {
          return query;
        }

        if (user.isExpert && !params.id) {
          const expertSpeciesQuery = { species: { $in: user.expertSpecies } };
          return { ...query, ...expertSpeciesQuery };
        }

        return query;
      },
      tasks(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        const { user } = ctx?.meta;
        if (!user?.id) return query;

        const tasksQuery = this.getTasksQuery(user);
        if (query.status) {
          delete tasksQuery.status;
        }

        return _.merge(query, tasksQuery);
      },
    },

    defaultScopes: AUTH_PROTECTED_SCOPES,
  },

  hooks: {
    before: {
      create: [
        'parseGeomField',
        'validateIsInformational',
        'validateStatusChange',
      ],
      update: ['parseGeomField', 'validateStatusChange'],
    },
  },
  actions: {
    remove: {
      rest: null,
    },
    update: {
      additionalParams: {
        comment: { type: 'string', optional: true },
      },
    },
  },
})
export default class FormsService extends moleculer.Service {
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
    return ctx.call(`forms.histories.${ctx.params.type || 'list'}`, {
      sort: '-createdAt',
      query: {
        form: ctx.params.id,
      },
      page: ctx.params.page,
      pageSize: ctx.params.pageSize,
      populate: 'createdBy',
    });
  }

  @Action({
    params: {
      ids: {
        type: 'array',
        items: {
          type: 'number',
          convert: true,
        },
      },
      changes: 'object',
    },
  })
  async updateBatch(
    ctx: Context<{
      ids: number[];
      changes: object;
    }>
  ) {
    const { changes, ids } = ctx.params;

    const updatedForms: Form[] = await this.updateEntities(ctx, {
      query: { id: { $in: ids } },
      changes,
    });

    return updatedForms;
  }

  @Action({
    rest: 'GET /:id/assignees',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    types: [EndpointType.ADMIN, EndpointType.EXPERT],
  })
  async listAssignees(ctx: Context<{ id: number }, UserAuthMeta>) {
    const { id } = ctx.params;
    const { user } = ctx.meta;
    const form: Form = await ctx.call('forms.resolve', { id });
    let userIds: number[] = [];
    if (user?.isExpert) {
      if (user.expertSpecies.includes(Number(form.species))) {
        userIds = [user.id];
      }
    } else {
      userIds = await ctx.call('requests.getExpertsIdsBySpecies', {
        speciesId: form.species,
      });
      userIds = (userIds || []).filter((i) => i !== form.createdBy);
    }

    const users: User[] = await ctx.call('users.resolve', {
      id: userIds,
    });

    return {
      rows: users,
      total: users.length,
    } as DBPagination<User>;
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
  async upload(ctx: Context<{}>) {
    return ctx.call('minio.uploadFile', {
      payload: ctx.params,
      folder: 'uploads/forms',
    });
  }

  @Action({
    params: {
      species: {
        type: 'number',
        convert: true,
      },
      createdBy: {
        type: 'number',
        convert: true,
        optional: true,
      },
    },
  })
  async getAssigneeForForm(
    ctx: Context<{ species: number; createdBy?: number }>
  ) {
    const userIdsAll: number[] = await ctx.call(
      'requests.getExpertsIdsBySpecies',
      {
        speciesId: ctx.params.species,
      }
    );

    const userIds = (userIdsAll || []).filter(
      (i) => i !== ctx.params.createdBy
    );

    if (!userIds.length) return;

    const tasksCountByUser = await Promise.all(
      userIds.map(async (id) => {
        const tasksCount = await ctx.call('forms.getTasksCount', {
          userId: id,
        });

        return {
          userId: id,
          tasksCount,
        };
      })
    );

    const minTasksCount = Math.min(
      ...tasksCountByUser.map((item) => Number(item.tasksCount))
    );

    const selectFromUserIds = tasksCountByUser
      .filter((item: any) => item.tasksCount <= minTasksCount)
      .map((item) => item.userId);

    if (!selectFromUserIds.length) return;

    const index = Math.floor(Math.random() * selectFromUserIds.length);

    return selectFromUserIds[index];
  }

  @Action({
    rest: 'POST /:id/assignee/:assignee?',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
      assignee: {
        optional: true,
        type: 'number',
        convert: true,
      },
    },
    types: [EndpointType.ADMIN, EndpointType.EXPERT],
  })
  async setAssignee(
    ctx: Context<{ id: number; assignee: number }, UserAuthMeta>
  ) {
    await this.updateEntity(ctx, {
      id: ctx.params.id,
      assignee: ctx.params.assignee || null,
    });

    return { success: true };
  }

  @Action({
    rest: 'POST /:id/places/:place?',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
      place: {
        optional: true,
        type: 'number',
        convert: true,
      },
    },
    types: [EndpointType.EXPERT],
  })
  async setPlace(
    ctx: Context<
      { id: number; place?: number },
      UserAuthMeta & FormPlaceChanged
    >
  ) {
    ctx.meta.placeChanged = true;

    await this.updateEntity(ctx, {
      id: ctx.params.id,
      place: ctx.params.place || null,
    });

    return { success: true };
  }

  @Action({
    rest: 'GET /tasks',
    types: [EndpointType.ADMIN, EndpointType.EXPERT],
  })
  async getTasks(ctx: Context<{}>) {
    return ctx.call('forms.list', {
      ...ctx.params,
      sort: 'deadlineAt,createdAt',
      scope: 'tasks',
    });
  }

  @Action({
    rest: 'POST /check',
    types: [EndpointType.ADMIN, EndpointType.EXPERT],
    params: {
      species: {
        type: 'number',
        convert: true,
      },
    },
    hooks: {
      before: ['validateIsInformational', 'validateStatusChange'],
    },
  })
  async checkFormData(
    ctx: Context<
      {
        activity?: string;
        evolution?: string;
        species: number;
        isInformational: boolean;
      },
      FormAutoApprove
    >
  ) {
    const { evolution, activity, species, isInformational } = ctx.params;

    const formType = await this.getFormType(ctx, species);

    const valid = {
      activity: true,
      evolution: true,
      isInformational: !!isInformational,
      autoApprove: !!ctx.meta.autoApprove,
    };

    if (formType) {
      valid.activity = await this.broker.call('forms.types.validateActivity', {
        type: formType,
        activity,
      });

      valid.evolution = await this.broker.call(
        'forms.types.validateEvolution',
        {
          type: formType,
          evolution,
          activity,
        }
      );
    }

    return valid;
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

    const query = this.getTasksQuery(user);
    return this.countEntities(ctx, { query, scope: WITHOUT_AUTH_SCOPES });
  }

  @Action({
    rest: 'GET /my',
    types: [EndpointType.ADMIN, EndpointType.EXPERT, EndpointType.TENANT_USER],
  })
  async my(ctx: Context<{ query: any }, UserAuthMeta>) {
    if (typeof ctx.params.query === 'string') {
      ctx.params.query = JSON.parse(ctx.params.query);
    }

    ctx.params.query = ctx.params.query || {};
    ctx.params.query.createdBy = ctx.meta?.user?.id;

    return ctx.call('forms.list', ctx.params);
  }

  @Action({
    rest: 'GET /:id/places',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getPlaces(ctx: Context<{ id: number }, UserAuthMeta>) {
    const adapter = await this.getAdapter(ctx);
    const table = adapter.getTable();
    const formsTable = 'forms';
    const placesTable = 'places';

    const allPlacesBySpecies = table
      .select(
        `${placesTable}.id`,
        `${placesTable}.code`,
        adapter.client.raw(
          `${distanceFn(
            `${formsTable}.geom`,
            `${placesTable}.geom`
          )} as distance`
        ),
        adapter.client.raw(`${areaFn(`${placesTable}.geom`)} as area`)
      )
      .leftJoin(
        placesTable,
        `${placesTable}.speciesId`,
        `${formsTable}.speciesId`
      )
      .where(`${formsTable}.id`, ctx.params.id)
      .whereNotNull(`${placesTable}.id`)
      .whereNull(`${placesTable}.deletedAt`);

    return adapter.client
      .select('*')
      .from(allPlacesBySpecies.as('allPlaces'))
      .where('distance', '<=', 1000)
      .orderBy('distance')
      .limit(10);
  }

  @Action({
    params: {
      userId: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getStatsByUser(ctx: Context<{ userId: number }>) {
    const { userId } = ctx.params;

    const createdBy = userId;

    const approvedCount: number = await this.countEntities(ctx, {
      query: { createdBy, status: FormStatus.APPROVED },
      scope: WITHOUT_AUTH_SCOPES,
    });

    const rejectedCount: number = await this.countEntities(ctx, {
      query: { createdBy, status: FormStatus.REJECTED },
      scope: WITHOUT_AUTH_SCOPES,
    });

    return {
      approvedForms: approvedCount,
      rejectedForms: rejectedCount,
    };
  }

  @Action({
    params: {
      id: [
        { type: 'number', convert: true, optional: true },
        {
          type: 'array',
          items: {
            type: 'number',
            convert: true,
          },
          optional: true,
        },
      ],
      place: {
        type: 'number',
        convert: true,
        optional: true,
      },
    },
  })
  async relevantFormsCount(
    ctx: Context<{ id?: number | number[]; place?: number }>
  ) {
    const { place, id } = ctx.params;
    let ids = id || [];
    if (!Array.isArray(ids)) {
      ids = [ids];
    }

    const query: any = {
      isRelevant: queryBoolean('isRelevant', true),
    };

    if (ids?.length) {
      query.id = {
        $nin: ids,
      };
    }

    if (place) {
      query.place = place;
    }

    if (ctx.params.place)
      return await this.broker.call('forms.count', { query });
  }

  @Action({
    params: {
      userId: 'number',
    },
  })
  async checkAssignmentsForUser(ctx: Context<{ userId: number }>) {
    const { userId } = ctx.params;
    const species: number[] = await ctx.call('requests.getExpertSpecies', {
      userId,
    });

    return await this.updateEntities(
      ctx,
      {
        query: {
          species: {
            $nin: species,
          },
          status: {
            $nin: nonEditableStatuses,
          },
          assignee: userId,
        },
        changes: {
          $set: {
            assigneeId: null,
          },
        },
        scope: WITHOUT_AUTH_SCOPES,
      },
      {
        raw: true,
      }
    );
  }

  @Method
  hasPermissionToEdit(
    form: any,
    user?: User,
    profile?: Tenant
  ): {
    edit: boolean;
    validate: boolean;
  } {
    const invalid = { edit: false, validate: false };

    const assignee = form.assignee || form.assigneeId;
    const tenant = form.tenant || form.tenantId;

    if (!form?.id || nonEditableStatuses.includes(form?.status)) {
      return invalid;
    }

    if (!user?.id) {
      return {
        edit: true,
        validate: true,
      };
    }

    const isCreatedByUser = !tenant && user?.id === form.createdBy;
    const isCreatedByTenant = profile?.id === tenant;

    if (isCreatedByTenant || isCreatedByUser) {
      return {
        edit: [FormStatus.RETURNED].includes(form.status),
        validate: false,
      };
    } else if (user.isExpert) {
      const isValid =
        Number(assignee) === Number(user.id) &&
        [FormStatus.CREATED, FormStatus.SUBMITTED].includes(form.status);

      return {
        validate: isValid,
        edit: false,
      };
    }

    return invalid;
  }

  @Method
  async getFormType(ctx: Context, speciesId: number) {
    if (!speciesId) {
      throw new moleculer.Errors.ValidationError('No species');
    }

    const taxonomy: Taxonomy = await ctx.call('taxonomies.findBySpeciesId', {
      id: speciesId,
    });

    return taxonomy?.formType;
  }

  @Method
  async validateIsInformational(
    ctx: Context<
      {
        species: number;
        activity?: string;
        isInformational: boolean;
      },
      UserAuthMeta
    >
  ) {
    const { species, activity } = ctx.params;
    ctx.params.isInformational = false;

    const taxonomy: Taxonomy = await this.broker.call(
      'taxonomies.findBySpeciesId',
      { id: species }
    );

    if (activity) {
      const isInformational: boolean = await this.broker.call(
        'forms.types.isInformational',
        {
          type: taxonomy.formType,
          activity,
        }
      );

      if (isInformational) {
        ctx.params.isInformational = isInformational;
      }
    }

    return ctx;
  }

  @Method
  async validateStatusChange(
    ctx: Context<
      { id: number; species: number; isInformational?: boolean },
      UserAuthMeta & FormAutoApprove & FormStatusChanged
    >
  ) {
    const { id, species, isInformational } = ctx.params;

    if (!!id) {
      const doNotChangeStatus = Object.keys(ctx.params).every((key) =>
        ['id', 'isRelevant', 'assignee'].includes(key)
      );

      ctx.meta.statusChanged = !doNotChangeStatus;
    } else if (isInformational) {
      ctx.meta.autoApprove = true;
    } else if (!id && ctx?.meta?.user?.isExpert) {
      ctx.meta.autoApprove = ctx.meta.user.expertSpecies.includes(
        Number(species)
      );
    }

    return ctx;
  }

  @Method
  createFormHistory(
    form: number,
    meta: any,
    type: string,
    comment: string = ''
  ) {
    return this.broker.call(
      'forms.histories.create',
      {
        form,
        comment,
        type,
      },
      { meta, parentCtx: null }
    );
  }

  @Method
  async parseGeomField(
    ctx: Context<{
      id?: number;
      geom?: GeomFeatureCollection;
      geomBufferSize?: number;
    }>
  ) {
    const { geom, id } = ctx.params;

    if (geom?.features?.length) {
      const adapter = await this.getAdapter(ctx);
      const table = adapter.getTable();

      try {
        const geomItem = geom.features[0];
        const value = geometryToGeom(geomItem.geometry);
        ctx.params.geom = table.client.raw(geometryFromText(value));
        ctx.params.geomBufferSize = geomItem.properties?.bufferSize || null;
      } catch (err) {
        throw new moleculer.Errors.ValidationError(err.message);
      }
    } else if (id) {
      const form: Form = await ctx.call('forms.resolve', { id });
      if (!form.geom) {
        throw new moleculer.Errors.ValidationError('No geometry');
      }
    } else {
      throw new moleculer.Errors.ValidationError('Invalid geometry');
    }

    return ctx;
  }

  @Method
  async assignPlaceIfNeeded(ctx: Context, form: Form) {
    if (!form || form.status !== FormStatus.APPROVED || form.isInformational) {
      return form;
    }

    ctx.emit('places.changed', { id: form.place });

    return form;
  }

  @Method
  async getNotificationData(
    userId?: number,
    species?: number
  ): Promise<{ user?: User; taxonomy?: Taxonomy }> {
    if (!userId) return {};

    const user: User = await this.broker.call('users.resolve', {
      id: userId,
      scope: USERS_DEFAULT_SCOPES,
    });

    if (!user?.email) return {};

    const taxonomy: Taxonomy = await this.broker.call(
      'taxonomies.findBySpeciesId',
      { id: species }
    );

    if (!taxonomy?.speciesId) return {};

    return {
      user,
      taxonomy,
    };
  }

  @Method
  async sendNotificationOnStatusChange(form: Form) {
    if (!emailCanBeSent()) return;

    const notifyExpert = [FormStatus.SUBMITTED].includes(form.status);

    const { user, taxonomy } = await this.getNotificationData(
      notifyExpert ? (form.assignee as number) : form.createdBy,
      form.species as number
    );

    if (!user?.id) return;

    notifyOnFormUpdate(
      user.email,
      form.status,
      form.id,
      taxonomy,
      notifyExpert,
      user.type === UserType.ADMIN
    );
  }

  @Method
  async sendNotificationsOnAssigneeChange(form: Form) {
    if (!emailCanBeSent()) return;

    const { user, taxonomy } = await this.getNotificationData(
      form.assignee as number,
      form.species as number
    );

    if (!user?.id) return;

    notifyFormAssignee(user.email, form.id, taxonomy);
  }

  @Method
  validateStatus({ ctx, value, entity }: FieldHookCallback) {
    const { user, profile } = ctx.meta;
    if (!value || !user?.id) return true;

    const expertStatuses = [
      FormStatus.REJECTED,
      FormStatus.RETURNED,
      FormStatus.APPROVED,
    ];

    const newStatuses = [FormStatus.CREATED, FormStatus.APPROVED];

    const error = `Cannot set status with value ${value}`;
    if (!entity?.id) {
      return newStatuses.includes(value) || error;
    }

    const editingPermissions = this.hasPermissionToEdit(entity, user, profile);

    if (editingPermissions.edit) {
      return value === FormStatus.SUBMITTED || error;
    } else if (editingPermissions.validate) {
      return expertStatuses.includes(value) || error;
    }

    return error;
  }

  @Method
  async validateQuantity({ ctx, params, entity, value }: FieldHookCallback) {
    const speciesId = entity?.speciesId || params?.species;

    const formType = await this.getFormType(ctx, speciesId);

    const error = 'Invalid quantity';

    if (formType === FormType.INVASIVE_PLANT) {
      const hasQuantity = !!value || !!entity?.quantity;
      const hasMethod = !!params.method || !!entity?.method;

      if (!hasQuantity && !hasMethod) return error;
      else if (hasMethod) return true;
    }

    const validate = !entity?.id || !!value;

    if (validate) {
      if (entity?.quantity && !value) return true;

      return value >= 1 || error;
    }

    return true;
  }

  @Method
  async validateIsRelevant({ ctx, value, entity }: FieldHookCallback) {
    const placeId = entity?.place || entity?.placeId;

    if (!entity?.id || !placeId || !!value) return true;

    const relevantFormsCount: number = await this.broker.call(
      'forms.relevantFormsCount',
      {
        place: placeId,
        id: entity.id,
      }
    );

    return !!relevantFormsCount || 'Cannot make all forms irrelevant';
  }

  @Method
  getTasksQuery(user: User) {
    if (!user?.id) return {};

    const statusFilters = [FormStatus.CREATED, FormStatus.SUBMITTED];

    const query: any = {
      status: {
        $in: statusFilters,
      },
    };

    if (user.type === UserType.ADMIN) {
      return _.merge(query, {
        assignee: { $exists: false },
        isInformational: queryBoolean('isInformational', false),
      });
    }

    return _.merge(query, {
      assignee: user.id,
    });
  }

  @Method
  async validateAssignee({ ctx, value, entity }: FieldHookCallback) {
    const { user } = ctx?.meta;
    if (!entity?.id || !user?.id) return true;

    const newAssignee = Number(value);
    const prevAssignee = Number(entity.assigneeId);
    const userIsCreator = Number(entity.createdBy) === newAssignee;
    const species = Number(entity.speciesId);

    const error = 'Assignee cannot be set.';
    if (user.isExpert) {
      const assigningToHimself = Number(user.id) === Number(newAssignee);
      const assignedToHimself = Number(user.id) === Number(prevAssignee);

      if (!!newAssignee && !assigningToHimself) {
        return 'Cannot assign to somebody else.';
      } else if (!!newAssignee && !!prevAssignee) {
        return 'Assignee already exists.';
      } else if (!newAssignee && !assignedToHimself) {
        return 'Cannot unassign others.';
      } else if (!newAssignee && !prevAssignee) {
        return 'Already unassigned.';
      }
    } else if (user.type === UserType.USER) {
      return error;
    } else if (newAssignee && user.type === UserType.ADMIN) {
      const expertSpecies: number[] = await this.broker.call(
        'requests.getExpertSpecies',
        { userId: newAssignee }
      );
      if (!expertSpecies.includes(Number(species))) {
        return error;
      }
    }

    if (!!newAssignee && userIsCreator) {
      return 'Cannot assign to creator.';
    }

    return true;
  }

  @Method
  async refreshApprovedFormsViewIfNeeded(
    ctx: Context,
    form: Form,
    prevForm?: Form
  ) {
    if (!form.id || form.status !== FormStatus.APPROVED) return;

    const notInformationalStatusChanged =
      !form.isInformational && form.status !== prevForm?.status;

    const relevancyChanged = prevForm?.isRelevant !== form?.isRelevant;

    const placeChanged = form.place !== prevForm?.place;

    /* 
    refresh materialized view if:
      1. not informational form status changed to approved
      2. form relevancy changed
      3. form place changed
    */
    if (notInformationalStatusChanged || relevancyChanged || placeChanged) {
      await this.refreshMaterializedView(ctx, MaterializedView.APPROVED_FORMS);
    }
  }

  @Event()
  async 'forms.updated'(ctx: Context<EntityChangedParams<Form>, UserAuthMeta>) {
    const { oldData: prevForm, data: form } = ctx.params;

    if (prevForm?.status !== form.status) {
      const { comment } = ctx.options?.parentCtx?.params as any;
      const typesByStatus = {
        [FormStatus.SUBMITTED]: FormHistoryTypes.UPDATED,
        [FormStatus.REJECTED]: FormHistoryTypes.REJECTED,
        [FormStatus.RETURNED]: FormHistoryTypes.RETURNED,
        [FormStatus.APPROVED]: FormHistoryTypes.APPROVED,
      };

      await this.createFormHistory(
        form.id,
        ctx.meta,
        typesByStatus[form.status],
        comment
      );

      await this.sendNotificationOnStatusChange(form);
    }

    if (prevForm?.place !== form.place) {
      await this.assignPlaceIfNeeded(ctx, form);
      if (prevForm?.place) {
        await this.assignPlaceIfNeeded(ctx, prevForm);
      }
    }

    const assigneeChanged = prevForm?.assignee !== form.assignee;
    const assignedToHimself = ctx?.meta?.user?.id === form.assignee;

    if (form.assignee && assigneeChanged && !assignedToHimself) {
      this.sendNotificationsOnAssigneeChange(form);
    }

    await this.refreshApprovedFormsViewIfNeeded(ctx, form, prevForm);
  }

  @Event()
  async 'forms.created'(ctx: Context<EntityChangedParams<Form>>) {
    const { data: form } = ctx.params;

    await this.createFormHistory(form.id, ctx.meta, FormHistoryTypes.CREATED);
    if (form.status === FormStatus.APPROVED) {
      await this.createFormHistory(
        form.id,
        null,
        FormHistoryTypes.APPROVED,
        'Automatiškai patvirtinta stebėjimo anketa.'
      );

      this.assignPlaceIfNeeded(ctx, form);
    }

    if (form.assignee) {
      this.sendNotificationsOnAssigneeChange(form);
    }

    await this.refreshApprovedFormsViewIfNeeded(ctx, form);
  }
}
