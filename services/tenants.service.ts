'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  EndpointType,
  FieldHookCallback,
  throwNotFoundError,
  throwUnauthorizedError,
} from '../types';
import { UserAuthMeta } from './api.service';
import { TenantUser, TenantUserRole } from './tenantUsers.service';
import { User, UserType } from './users.service';

export interface Tenant extends BaseModelInterface {
  name: string;
  role?: TenantUserRole;
  authGroup?: number;
}

@Service({
  name: 'tenants',

  mixins: [
    DbConnection({
      collection: 'tenants',
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

      name: 'string',

      email: 'string',

      phone: 'string',

      code: 'string',

      authGroup: {
        type: 'number',
        columnType: 'integer',
        columnName: 'authGroupId',
        populate: 'auth.groups.get',
        async onRemove({ ctx, entity }: FieldHookCallback) {
          await ctx.call('auth.groups.remove', { id: entity.authGroupId }, { meta: ctx?.meta });
        },
      },

      users: {
        virtual: true,
        items: { type: 'object' },
        type: 'array',
        populate(ctx: any, _values: any, items: any[]) {
          return Promise.all(
            items.map((item: any) => {
              return ctx.call('tenantUsers.findByTenant', { id: item.id });
            }),
          );
        },
      },

      usersCount: {
        virtual: true,
        type: 'number',
        populate(ctx: any, _values: any, items: any[]) {
          return Promise.all(
            items.map((item: any) => {
              return ctx.call('tenantUsers.count', {
                query: {
                  tenant: item.id,
                },
              });
            }),
          );
        },
      },

      role: {
        virtual: true,
        type: TenantUserRole,
        populate(ctx: any, _values: any, tenants: any[]) {
          return Promise.all(
            tenants.map(async (tenant: any) => {
              if (!ctx.meta.user?.id) return;
              const tenantUser: TenantUser = await ctx.call('tenantUsers.findOne', {
                query: {
                  tenant: tenant.id,
                  user: ctx.meta.user.id,
                },
              });
              return tenantUser?.role;
            }),
          );
        },
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
      async user(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        if (ctx?.meta?.user?.type === UserType.USER && !ctx.meta?.user?.isExpert) {
          const tenantsIds: number[] = await ctx.call('tenantUsers.findIdsByUser', {
            id: ctx.meta.user.id,
          });

          if (params?.id) {
            let hasPermissions = false;
            if (Array.isArray(params.id)) {
              hasPermissions = params.id.every((id: number) => tenantsIds.includes(Number(id)));
            } else {
              hasPermissions = tenantsIds.includes(Number(params.id));
            }
            if (!hasPermissions) {
              throwUnauthorizedError(`Cannot access this tenant with ID: ${params.id}`);
            }
          } else {
            query.id = { $in: tenantsIds };
          }
        }
        return query;
      },
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES, 'user'],
  },

  actions: {
    create: {
      rest: null,
    },

    update: {
      types: [EndpointType.ADMIN, EndpointType.TENANT_ADMIN],
    },

    remove: {
      rest: null,
      types: EndpointType.ADMIN,
    },
  },
})
export default class TenantsService extends moleculer.Service {
  @Action({
    params: {
      authGroup: 'any',
      email: {
        type: 'string',
        optional: true,
      },
      phone: {
        type: 'string',
        optional: true,
      },
      name: {
        type: 'string',
        optional: true,
      },
      update: {
        type: 'boolean',
        optional: true,
        default: false,
      },
    },
  })
  async findOrCreate(
    ctx: Context<{
      authGroup: any;
      update?: boolean;
      name?: string;
      phone?: string;
      email?: string;
    }>,
  ) {
    const { authGroup, update, name, phone, email } = ctx.params;
    if (!authGroup || !authGroup.id) return;

    const tenant: Tenant = await ctx.call('tenants.findOne', {
      query: {
        authGroup: authGroup.id,
      },
    });

    if (!update && tenant && tenant.id) return tenant;

    const dataToSave = {
      name: name || authGroup.name,
      email: email || authGroup.companyEmail,
      phone: phone || authGroup.companyPhone,
      code: authGroup.companyCode,
    };

    if (tenant && tenant.id) {
      return ctx.call('tenants.update', {
        id: tenant.id,
        ...dataToSave,
      });
    }

    return ctx.call('tenants.create', {
      authGroup: authGroup.id,
      ...dataToSave,
    });
  }

  @Action({
    rest: 'POST /',
    params: {
      personalCode: 'string|convert|optional',
      firstName: 'string|optional',
      lastName: 'string|optional',
      email: 'string|optional',
      phone: 'string|optional',
      companyName: 'string',
      companyCode: 'string',
      companyPhone: 'string',
      companyEmail: 'string',
    },
    types: EndpointType.ADMIN,
  })
  async invite(
    ctx: Context<
      {
        companyCode: string;
        companyName: string;
        companyEmail: string;
        companyPhone: string;
        personalCode?: string;
        phone?: string;
        email?: string;
        firstName?: string;
        lastName?: string;
      },
      UserAuthMeta
    >,
  ) {
    const {
      companyCode,
      companyName,
      companyEmail,
      companyPhone,

      // owner data
      personalCode,
      email,
      phone,
      firstName,
      lastName,
    } = ctx.params;

    const authGroup: any = await ctx.call('auth.users.invite', {
      companyCode,
      notify: personalCode ? [] : [companyEmail],
    });

    if (!personalCode) {
      return ctx.call('tenants.findOrCreate', {
        authGroup: authGroup,
        email: companyEmail,
        phone: companyPhone,
        name: companyName,
      });
    }

    const authUser: any = await ctx.call('auth.users.invite', {
      companyId: authGroup.id,
      personalCode: personalCode,
      role: TenantUserRole.ADMIN,
      notify: [email],
    });

    const user: User = await ctx.call('users.findOrCreate', {
      authUser,
      firstName,
      lastName,
      email,
      phone,
    });

    const tenantUser: TenantUser = await ctx.call('tenantUsers.createRelationshipsIfNeeded', {
      companyName,
      authGroup: { ...authGroup, role: authUser?.role },
      companyEmail,
      companyPhone,
      userId: user.id,
    });

    return ctx.call('tenants.resolve', { id: tenantUser.tenant });
  }

  @Action({
    rest: 'DELETE /:id',
    params: {
      id: 'any',
    },
    types: EndpointType.ADMIN,
  })
  async removeTenant(
    ctx: Context<
      {
        id: number;
      },
      UserAuthMeta
    >,
  ) {
    const { id } = ctx.params;

    const tenant: Tenant = await ctx.call('tenants.get', { id });
    if (!tenant) {
      return throwNotFoundError('Tenant not found.');
    }

    await ctx.call('tenantUsers.removeUsers', {
      tenantId: tenant.id,
    });

    await ctx.call('tenants.remove', { id: tenant.id });

    return {
      success: true,
    };
  }
}
