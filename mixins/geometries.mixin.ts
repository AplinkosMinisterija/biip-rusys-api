'use strict';

import { Context } from 'moleculer';
import {
  GeomFeatureCollection,
  GeometryType,
  geometryFilterFn,
  geometryFromText,
  geometryToGeom,
  parseToJsonIfNeeded,
} from '../modules/geometry';

function geomTransformFn(field: string) {
  return `ST_Transform(${field || 'geom'}, 3346)`;
}

export function geomAsGeoJsonFn(
  field: string = '',
  asField: string = 'geom',
  digits: number = 0,
  options: number = 0
) {
  field = geomTransformFn(field);
  asField = asField ? ` as ${asField}` : '';
  return `ST_AsGeoJSON(${field}, ${digits}, ${options})::json${asField}`;
}

export function distanceFn(field1: string, field2: string) {
  const geom1 = geomTransformFn(field1);
  const geom2 = geomTransformFn(field2);
  return `ROUND(ST_Distance(${geom1}, ${geom2}))`;
}

export function areaFn(field: string) {
  return `ROUND(ST_Area(${geomTransformFn(field)}))`;
}

export function featuresToFeatureCollection(features: any[]) {
  return {
    type: 'FeatureCollection',
    features,
  };
}

export function geomToFeatureCollection(geom: any, properties?: any) {
  if (!geom) return;

  const getFeature = (geom: any) => {
    return {
      type: 'Feature',
      geometry: geom,
      properties: properties || null,
    };
  };

  let geometries = [geom];
  if (geom.geometries?.length) {
    geometries = geom.geometries;
  }

  return featuresToFeatureCollection(geometries.map((g: any) => getFeature(g)));
}

function validateGeometryTypes(
  types: string[] = Object.values(GeometryType),
  geom: GeomFeatureCollection,
  multi: boolean
) {
  if (!geom?.features?.length) return 'Empty geometry';

  if (!types?.length) return true;

  const typesToCreate: string[] = geom.features.map(
    (f: any) => f.geometry.type
  );

  if (!multi && typesToCreate?.length > 1) {
    return 'Multi geometries are not supported';
  }

  const everyTypeMatches = typesToCreate.every((t) => types.includes(t));

  return everyTypeMatches || 'Not supported geometry types';
}

function validateCoordinates(geom: GeomFeatureCollection) {
  if (!geom?.features?.length) return true;


}

export function validateGeom(types?: string[]) {
  return function ({ entity, root, field }: any) {
    // since value is changed (in set method) use root instead
    const value = root[field.name];
    if (entity?.geom && !value) return true;

    return validateGeometryTypes(types, value, !!field.geom?.multi);
  };
}

export default {
  hooks: {
    before: {
      list: 'applyGeomFilterFunction',
      find: 'applyGeomFilterFunction',
    },
  },
  methods: {
    async applyGeomFilterFunction(
      ctx: Context<{ query: { [key: string]: any } }>
    ) {
      ctx.params.query = parseToJsonIfNeeded(ctx.params.query);

      if (!ctx.params?.query) {
        return ctx;
      }

      for (const key of Object.keys(ctx.params.query)) {
        if (this.settings?.fields?.[key]?.geomFilterFn) {
          if (
            typeof this.settings?.fields?.[key]?.geomFilterFn === 'function'
          ) {
            ctx.params.query[key] = await this.settings?.fields?.[
              key
            ]?.geomFilterFn({
              value: ctx.params.query[key],
              query: ctx.params.query,
            });
          }
        }
      }

      return ctx;
    },

    getPropertiesFromFeatureCollection(
      geom: GeomFeatureCollection,
      property?: string
    ) {
      const properties = geom?.features?.[0]?.properties;
      if (!properties) return;

      if (!property) return properties;
      return properties[property];
    },
  },
  actions: {
    async getFeatureCollectionFromGeom(
      ctx: Context<{
        id: number | number[];
        field?: string;
        properties?: { [key: string]: any };
      }>
    ): Promise<GeomFeatureCollection> {
      const adapter = await this.getAdapter(ctx);
      const table = adapter.getTable();

      const { id, field, properties } = ctx.params;
      const multi = Array.isArray(id);
      const query = table.select(
        'id',
        table.client.raw(geomAsGeoJsonFn(field))
      );

      if (properties) {
        Object.keys(properties).forEach((key) => {
          table.select(`${properties[key]} as ${key}`);
        });
      }

      query[multi ? 'whereIn' : 'where']('id', id);

      const res: any[] = await query;

      const result = res.reduce((acc: { [key: string]: any }, item) => {
        let itemProperties: any = null;
        if (properties && Object.keys(properties).length) {
          itemProperties = Object.keys(properties).reduce(
            (acc: any, key) => ({
              ...acc,
              [key]: item[key],
            }),
            {}
          );
        }
        acc[`${item.id}`] = geomToFeatureCollection(item.geom, itemProperties);
        return acc;
      }, {});

      if (!multi) return result[`${id}`];
      return result;
    },
    async getGeometryArea(
      ctx: Context<{
        id: number | number[];
        field?: string;
        asField?: string;
      }>
    ) {
      const adapter = await this.getAdapter(ctx);
      const table = adapter.getTable();

      const { id, field, asField } = ctx.params;
      const multi = Array.isArray(id);

      const query = table.select(
        'id',
        table.client.raw(`${areaFn(field)} as ${asField || 'area'}`)
      );

      query[multi ? 'whereIn' : 'where']('id', id);

      const res: any[] = await query;

      const result = res.reduce((acc: { [key: string]: any }, item) => {
        acc[`${item.id}`] = Number(Number(item.area).toFixed(2));
        return acc;
      }, {});

      if (!multi) return result[`${id}`];
      return result;
    },
  },

  started() {
    const keys = Object.keys(this.settings.fields).filter(
      (key) => this.settings.fields[key]?.geom
    );
    if (keys?.length) {
      keys.forEach((key) => {
        const field = this.settings.fields[key];

        if (typeof field.geom !== 'object') {
          field.geom = {
            type: 'geom',
            multi: false,
          };
        }

        if (field.geom.type === 'geom') {
          field.populate = {
            keyField: 'id',
            action: `${this.name}.getFeatureCollectionFromGeom`,
            params: {
              properties: field.featureProperties,
              field: field.columnName || key,
            },
          };
          field.set = async function ({ ctx, value }: any) {
            const result = validateGeometryTypes(
              undefined,
              value,
              !!field.geom?.multi
            );
            if (!result || typeof result === 'string') return;

            const adapter = await this.getAdapter(ctx);
            const geomItem = value.features[0];
            value = geometryToGeom(geomItem.geometry);

            const data = await adapter.client
              .select(adapter.client.raw(`${geometryFromText(value)} as geom`))
              .first();

            return data?.geom;
          };
          field.geomFilterFn = ({ value }: any) => geometryFilterFn(value);
          this.settings.defaultPopulates = this.settings.defaultPopulates || [];
          this.settings.defaultPopulates.push(key);
        } else if (field.geom.type === 'area') {
          field.populate = {
            keyField: 'id',
            action: `${this.name}.getGeometryArea`,
            params: {
              field: field.geom.field || key,
              asField: key,
            },
          };
        }
      });
    }
  },
};
