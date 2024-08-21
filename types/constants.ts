import _ from 'lodash';
import Moleculer, { Context, Errors } from 'moleculer';
import { UserAuthMeta } from '../services/api.service';
import { UserType } from '../services/users.service';
import { FieldHookCallback } from './';

export type GenericObject<T> = { [key: string]: T };

export enum EndpointType {
  ADMIN = 'ADMIN',
  USER = 'USER',
  EXPERT = 'EXPERT', // this one & following - for endpoints security only (see validateType)
  TENANT_ADMIN = 'TENANT_ADMIN',
  TENANT_USER = 'TENANT_USER',
  SELF = 'SELF',
}

export const ADDITIONAL_CACHE_KEYS = () => ['#user.type', '#user.isExpert'];

export function throwUnauthorizedError(message?: string, data?: any): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(
    message || `Unauthorized.`,
    401,
    'UNAUTHORIZED',
    data,
  );
}

export function throwValidationError(message?: string, data?: any): Errors.MoleculerError {
  throw new Moleculer.Errors.ValidationError(message || `Not valid.`, 'VALIDATION_ERROR', data);
}

export function throwNotFoundError(message?: string, data?: any): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(message || `Not found.`, 404, 'NOT_FOUND', data);
}

export function queryBooleanPlain(field: string, value: boolean = false) {
  let fieldValue = `${_.snakeCase(field)} IS`;
  if (!value) {
    fieldValue += ' NOT';
  }

  return `${fieldValue} TRUE`;
}

export function queryBoolean(field: string, value: boolean = false) {
  return { $raw: queryBooleanPlain(field, value) };
}

async function validateUserId(ctx: Context<{}, UserAuthMeta>, id: number) {
  if (!id) return false;

  const { user, profile } = ctx?.meta;

  if (!user?.id) return false;

  const valid = await ctx.call('auth.validateType', {
    types: [EndpointType.ADMIN, EndpointType.EXPERT],
  });

  // users are accessable for admins and experts
  if (valid) return true;

  if (profile?.id) {
    const userIds: number[] = await ctx.call('tenantUsers.findIdsByTenant', {
      id: profile?.id,
    });

    return userIds.includes(id);
  }

  return id === user.id;
}

export const USER_PUBLIC_FIELDS = ['id', 'firstName', 'lastName', 'email', 'phone'];

export const USER_PUBLIC_GET = async ({ value, ctx }: any) => {
  if (!ctx.meta.user?.id || !value || !value?.id) return value;

  const valid = await validateUserId(ctx, value.id);

  if (valid) return value;

  return {
    id: value.id,
    firstName: 'Ekspertas',
    lastName: '',
  };
};

export function USER_PUBLIC_POPULATE(ctx: any, _values: any, items: any[], field: any) {
  return Promise.all(
    items.map(async (item) => {
      const value = item[field.columnName || field.name];
      if (!value) return;
      const valid = await validateUserId(ctx, value);

      if (!valid) return { id: value };

      const validFindAll = await ctx.call('auth.validateType', {
        types: [EndpointType.ADMIN, EndpointType.EXPERT],
      });

      let scope: string | boolean = '';
      if (validFindAll) {
        scope = false;
      }

      return ctx.call('users.resolve', {
        id: value,
        fields: USER_PUBLIC_FIELDS,
        scope,
      });
    }),
  );
}

export const COMMON_FIELDS = {
  createdBy: {
    type: 'string',
    readonly: true,
    populate: USER_PUBLIC_POPULATE,
    get: USER_PUBLIC_GET,
    onCreate: ({ ctx }: FieldHookCallback) => ctx.meta.user?.id,
  },

  createdAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    onCreate: () => new Date(),
  },

  updatedBy: {
    type: 'string',
    readonly: true,
    populate: USER_PUBLIC_POPULATE,
    get: USER_PUBLIC_GET,
    onUpdate: ({ ctx }: FieldHookCallback) => ctx.meta.user?.id,
  },

  updatedAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    onUpdate: () => new Date(),
  },

  deletedBy: {
    type: 'string',
    readonly: true,
    hidden: 'byDefault',
    populate: USER_PUBLIC_POPULATE,
    onRemove: ({ ctx }: FieldHookCallback) => ctx.meta.user?.id,
  },

  deletedAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    get: fieldValueForDeletedScope,
    onRemove: () => new Date(),
  },
};

export const UPDATED_DELETED_FIELDS_NAMES = ['updatedAt', 'updatedBy', 'deletedAt', 'deletedBy'];

export const ALL_COMMON_FIELDS_NAMES = [
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'deletedBy',
];

export function COMMON_FIELDS_WITH_PERMISSIONS(permissions: string | string[], fields?: string[]) {
  fields = fields || UPDATED_DELETED_FIELDS_NAMES;
  return _.merge(
    {},
    COMMON_FIELDS,
    fields.reduce((acc: any, field: string) => {
      acc[field] = {
        permission: permissions,
      };
      return acc;
    }, {}),
  );
}

export function COMMON_FIELDS_WITH_HIDDEN(fields: string[] = UPDATED_DELETED_FIELDS_NAMES) {
  return _.merge(
    {},
    COMMON_FIELDS,
    fields.reduce((acc: any, field: string) => {
      acc[field] = {
        hidden: 'byDefault',
      };
      return acc;
    }, {}),
  );
}

function fieldValueForDeletedScope({ ctx, value }: any) {
  if (!ctx?.params?.scope) return;
  let scope = ctx.params.scope;
  if (!Array.isArray(scope)) {
    scope = scope.split(',');
  }

  const scopesExists = scope.includes('deleted');

  if (!scopesExists) return;
  return value;
}

export const TENANT_FIELD = {
  tenant: {
    type: 'number',
    columnType: 'integer',
    columnName: 'tenantId',
    readonly: true,
    populate: 'tenants.resolve',
    onCreate: ({ ctx }: FieldHookCallback) => ctx.meta.profile?.id,
  },
};

export const COMMON_SCOPES = {
  notDeleted: {
    deletedAt: { $exists: false },
  },
  deleted: {
    deletedAt: { $exists: true },
  },
};

export interface BaseModelInterface {
  id?: number;
  createdAt?: Date;
  createdBy?: number;
  updatedAt?: Date;
  updatedBy?: number;
  deletedAt?: Date;
  deletedBy?: number;
}

export const COMMON_DEFAULT_SCOPES = ['notDeleted'];
export const COMMON_DELETED_SCOPES = ['-notDeleted', 'deleted'];

export const AUTH_FREELANCERS_GROUP_ID = process.env.AUTH_FREELANCERS_GROUP_ID;
