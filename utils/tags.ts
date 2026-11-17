import { Context } from 'moleculer';
import { parseToObject, toPositiveIntegerIds } from './functions';

const ADMIN_USER_TYPE = 'ADMIN';

// Tags are an internal tool for experts and admins, so nobody else sees or filters by them.
export const canUseTags = (user?: { type?: string; isExpert?: boolean }) =>
  user?.type === ADMIN_USER_TYPE || !!user?.isExpert;

export const tagsFieldGet = ({ ctx, value }: { ctx: Context<any, any>; value: unknown }) =>
  canUseTags(ctx?.meta?.user) ? value || [] : undefined;

// Matches rows that carry at least one of the given tags.
export const tagsFilterFn = (table: string) => (value: unknown) => {
  const ids = toPositiveIntegerIds(parseToObject(value as any));

  if (!ids.length) return { $raw: { condition: 'false' } };

  return {
    $raw: {
      condition: `${table}.tags && ?::int[]`,
      bindings: [ids],
    },
  };
};

export const TAGS_FIELD = (table: string) => ({
  type: 'array',
  items: { type: 'number' },
  readonly: true,
  get: tagsFieldGet,
  filterFn: tagsFilterFn(table),
});

export function removeTagsFilter(ctx: Context<any, any>) {
  if (canUseTags(ctx?.meta?.user)) return;

  const filter = parseToObject(ctx.params?.filter);
  if (filter && typeof filter === 'object' && 'tags' in filter) {
    delete (filter as any).tags;
    ctx.params.filter = filter;
  }
}

export async function existingTagIds(ctx: Context, ids: unknown): Promise<number[]> {
  const requested = [...new Set(toPositiveIntegerIds(ids))];
  if (!requested.length) return [];

  const tags: { id: number }[] = await ctx.call('tags.find', {
    query: { id: { $in: requested } },
    fields: ['id'],
  });
  const existing = new Set(tags.map((tag) => Number(tag.id)));

  return requested.filter((id) => existing.has(id));
}
