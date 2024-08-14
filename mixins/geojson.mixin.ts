import { Context } from 'moleculer';
import { parseToJsonIfNeeded } from 'moleculer-postgis/src/utils';

export function GeojsonMixin() {
  return {
    methods: {
      async getComputedQuery(ctx: Context<{ query: any }>) {
        let { params } = ctx;
        params = this.sanitizeParams(params);
        params = await this._applyScopes(params, ctx);
        params = this.paramsFieldNameConversion(params);

        return parseToJsonIfNeeded(params.query) || {};
      },
    },
    actions: {
      getGeojson: {
        timeout: 0,
        async handler(
          ctx: Context<{ fields?: string[]; geomField?: string; srid?: string | number }>,
        ) {
          const adapter = await this.getAdapter(ctx);
          const table = adapter.getTable();
          const knex = adapter.client;

          const fields = ctx.params.fields || ['*'];

          const query = await this.getComputedQuery(ctx);

          let { geomField, srid } = ctx.params;

          geomField = geomField || 'geom';
          srid = srid || 3346;

          const itemsQuery = adapter
            .computeQuery(table, query)
            .select(...fields, knex.raw(`ST_Transform(${geomField}, ${srid}) as ${geomField}`))
            .limit(100);

          const res = await knex
            .select(knex.raw(`ST_AsGeoJSON(i)::json as feature`))
            .from(itemsQuery.as('i'));

          return {
            type: 'FeatureCollection',
            features: res.map((i: any) => i.feature),
          };
        },
      },
    },
  };
}
