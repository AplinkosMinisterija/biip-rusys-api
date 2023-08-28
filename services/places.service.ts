'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';

import DbConnection, { MaterializedView } from '../mixins/database.mixin';

import { FeatureCollection, Geometry } from 'geojsonjs';
import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  BaseModelInterface,
  EndpointType,
  EntityChangedParams,
  FieldHookCallback,
  throwUnauthorizedError,
  queryBoolean,
  COMMON_DELETED_SCOPES,
} from '../types';
import { UserAuthMeta } from './api.service';
import { Form } from './forms.service';
import { PlaceHistory } from './places.histories.service';
import { TaxonomySpecies } from './taxonomies.species.service';
import { User, UserType } from './users.service';

import { PostgisMixin, GeometryType, asGeoJsonQuery } from '@moleculer/postgis';

const PlaceStatus = {
  INITIAL: 'INITIAL',
  STABLE: 'STABLE',
  INCREASED: 'INCREASED',
  DECREASED: 'DECREASED',
  DISAPPEARED: 'DISAPPEARED',
  DESTROYED: 'DESTROYED',
};

export interface Place extends BaseModelInterface {
  code: string;
  status: string;
  history: PlaceHistory[];
  species: number | TaxonomySpecies;
  forms?: Form[];
  geom?: FeatureCollection;
  canEdit?: boolean;
}

@Service({
  name: 'places',

  mixins: [
    DbConnection({
      collection: 'places',
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

      code: 'string',

      status: {
        type: 'enum',
        values: Object.values(PlaceStatus),
        onRemove: ({ value }: FieldHookCallback) => value,
      },

      species: {
        type: 'number',
        columnType: 'integer',
        columnName: 'speciesId',
        populate: 'taxonomies.species.resolve',
      },

      geom: {
        type: 'any',
        geom: {
          multi: true,
          types: [GeometryType.POLYGON, GeometryType.MULTI_POLYGON],
        },
      },

      area: {
        type: 'number',
        virtual: true,
        geom: {
          type: 'area',
          field: 'geom',
        },
      },

      forms: {
        type: 'array',
        items: { type: 'number' },
        virtual: true,
        populate: {
          keyField: 'id',
          action: 'forms.populateByProp',
          params: {
            queryKey: 'place',
            mappingMulti: true,
            sort: '-observedAt',
          },
        },
      },

      canEdit: {
        type: 'boolean',
        virtual: true,
        populate(ctx: Context<{}, UserAuthMeta>, _values: any, places: any[]) {
          const { user } = ctx?.meta;
          return places.map((place) => {
            const editingPermissions = this.hasPermissionToEdit(place, user);
            return !!editingPermissions.edit;
          });
        },
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['geom', 'area'],
  },

  actions: {
    create: {
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },

    update: {
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },

    remove: {
      additionalParams: {
        comment: { type: 'string', optional: true },
      },
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },
  },
})
export default class PlacesService extends moleculer.Service {
  @Action({
    rest: 'GET /:id/history',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getHistory(ctx: Context<{ id: number }>) {
    return ctx.call(`places.histories.list`, {
      ...ctx.params,
      sort: '-createdAt',
      query: {
        place: ctx.params.id,
      },
    });
  }

  @Action({
    rest: 'PATCH /:id/forms',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
      isRelevant: {
        type: 'boolean',
        default: false,
        optional: true,
      },
      forms: {
        type: 'array',
        items: {
          type: 'number',
          convert: true,
        },
      },
      comment: {
        type: 'string',
        optional: true,
      },
    },
  })
  async updateForms(
    ctx: Context<{
      id: number;
      forms?: number[];
      isRelevant: boolean;
      comment: string;
    }>
  ) {
    const { id, isRelevant, forms: formsIds, comment } = ctx.params;

    const place: Place = await ctx.call('places.resolve', {
      id,
      populate: 'canEdit',
    });

    if (!place.canEdit) {
      return throwUnauthorizedError('Cannot change place data');
    }

    if (!isRelevant) {
      const relevantFormsCount: number = await this.broker.call(
        'forms.relevantFormsCount',
        {
          place: place.id,
          id: formsIds,
        }
      );

      if (!relevantFormsCount) {
        throwUnauthorizedError('Cannot make all forms irrelevant');
      }
    }

    const query: any = {
      place: id,
      id: {
        $in: formsIds,
      },
    };

    const forms: Form[] = await ctx.call('forms.find', { query });

    if (!forms?.length) return { success: false };

    await ctx.call('forms.updateBatch', {
      ids: forms.map((f) => f.id),
      changes: {
        isRelevant,
      },
    });

    ctx.emit('places.changed', { id, comment });

    return { success: true };
  }

  @Action({
    rest: 'GET /deleted',
  })
  listDeleted(ctx: Context<{}>) {
    return ctx.call('places.list', {
      ...ctx.params,
      scope: COMMON_DELETED_SCOPES,
    });
  }

  @Method
  hasPermissionToEdit(
    place: any,
    user?: User
  ): {
    edit: boolean;
  } {
    const invalid = { edit: false };
    const valid = { edit: true };

    if (!user?.id) return valid;

    const species = place.species || place.speciesId;
    const userIsAdmin = user.type === UserType.ADMIN;
    const expertWithSpecies =
      user.isExpert && user.expertSpecies.includes(species);

    if (userIsAdmin || expertWithSpecies) {
      return valid;
    }

    return invalid;
  }

  @Method
  async refreshPlacesMaterializedView(ctx: Context) {
    await this.refreshMaterializedView(
      ctx,
      MaterializedView.PLACES_WITH_TAXONOMIES
    );
  }

  @Event()
  async 'places.changed'(ctx: Context<{ id: number; comment: string }>) {
    const adapter = await this.getAdapter(ctx);

    const { id, comment } = ctx.params;
    if (!id) return;

    const data: {
      status: string;
      formIds: number[];
      quantity: number;
      geom: Geometry;
    } = await adapter.client
      .select(
        '*',
        adapter.client.raw(
          asGeoJsonQuery('geom', 'geom', 3346, {
            options: 0,
            digits: 0,
          })
        )
      )
      .from(adapter.client.raw(`rusys_get_place_change_data(${id})`))
      .first();

    const geometry = this.parseGeom(ctx, data.geom);

    const saveData = {
      status: data.status,
      quantity: data.quantity,
      geom: geometry,
    };

    await ctx.call('places.histories.create', {
      ...saveData,
      relevantForms: data.formIds || [],
      place: id,
      comment,
    });

    await this.updateEntity(ctx, {
      id,
      ...saveData,
    });

    await this.refreshPlacesMaterializedView(ctx);

    return true;
  }

  @Event()
  async 'places.removed'(ctx: Context<EntityChangedParams<Place>>) {
    const { data: place } = ctx.params;
    const { comment } = ctx.options?.parentCtx?.params as any;

    this.broker.call(
      'places.histories.create',
      {
        place: place.id,
        comment: comment || '',
        status: place.status,
      },
      { meta: ctx.meta }
    );

    await this.refreshPlacesMaterializedView(ctx);
  }
}
