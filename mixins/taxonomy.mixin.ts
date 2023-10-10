'use strict';

import { parseToObject } from "../utils/functions";

export default function (opts: { taxonomies: string[] }) {
  const taxonomiesToFilter: any = {
    KINGDOM: {
      filter: opts.taxonomies.includes('kingdom'),
      queryKey: 'kingdom',
    },
    PHYLUM: {
      filter: opts.taxonomies.includes('phylum'),
      queryKey: 'phylum',
    },
    CLASS: {
      filter: opts.taxonomies.includes('class'),
      queryKey: 'class',
    },
  };

  const schema = {
    hooks: {
      before: {
        list: 'assignTaxonomyFilter',
      },
    },

    methods: {
      async assignTaxonomyFilter(ctx: any) {
        ctx.params.query = parseToObject(ctx.params.query);

        ctx.params.query = ctx.params.query || {};
        const queryKeys = Object.keys(taxonomiesToFilter).filter(
          (i: string) => taxonomiesToFilter[i].filter
        );

        const hasAnyQuery = queryKeys.some(
          (key) => !!ctx.params.query[taxonomiesToFilter[key].queryKey]
        );
        if (!hasAnyQuery) return ctx;

        let items = await ctx.call('taxonomies.kingdoms.find', {
          populate: 'phylums',
        });

        const reduceItems = (items: any[], key: string) => {
          return items.reduce((acc: any[], i) => {
            return [...acc, ...i[key]];
          }, []);
        };

        const filterItems = (items: any[], id?: number) => {
          if (!id) return items;
          return items.filter((i) => i.id == id);
        };

        if (taxonomiesToFilter.KINGDOM.filter) {
          items = filterItems(items, ctx.params.query.kingdom);
          items = reduceItems(items, 'phylums');
        }

        if (taxonomiesToFilter.PHYLUM.filter) {
          items = filterItems(items, ctx.params.query.phylum);
          items = reduceItems(items, 'classes');
        }

        if (taxonomiesToFilter.CLASS.filter) {
          items = filterItems(items, ctx.params.query.class);
          items = reduceItems(items, 'species');
        }

        queryKeys.map((key) => {
          delete ctx.params.query[taxonomiesToFilter[key].queryKey];
        });

        ctx.params.query.id = {
          $in: items.map((i: any) => i.id),
        };

        return ctx;
      },
    },
  };

  return schema;
}
