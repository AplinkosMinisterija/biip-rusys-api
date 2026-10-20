import { ServiceBroker } from 'moleculer';
import ApiService from '../services/api.service';
import { sanitizeClientQuery } from './requestSanitizer';

describe('sanitizeClientQuery', () => {
  it('keeps the deleted view and drops any other client scope', () => {
    expect(sanitizeClientQuery({ scope: 'deleted' })).toEqual({ scope: '-notDeleted,deleted' });
    expect(sanitizeClientQuery({ scope: false, page: 2 })).toEqual({ page: 2 });
    expect(sanitizeClientQuery({ scope: '-visibleToExpert' })).toEqual({});
  });

  it('rejects $raw anywhere in a query object', () => {
    expect(() => sanitizeClientQuery({ query: { $raw: '1=1' } })).toThrow();
    expect(() => sanitizeClientQuery({ query: { a: { b: { $raw: 'x' } } } })).toThrow();
    expect(() => sanitizeClientQuery({ query: { $or: [{ id: 1 }, { $raw: '1=1' }] } })).toThrow();
  });

  it('rejects $raw inside a JSON-string query, the shape the gateway delivers', () => {
    expect(() => sanitizeClientQuery({ query: '{"$raw":"1=1"}' })).toThrow();
    expect(() => sanitizeClientQuery('{"query":{"$raw":"1=1"}}')).toThrow();
  });

  it('rejects a unicode-escaped $raw key, single and double encoded', () => {
    expect(() => sanitizeClientQuery({ query: '{"\\u0024raw":"1=1"}' })).toThrow();
    expect(() => sanitizeClientQuery({ query: JSON.stringify('{"\\u0024raw":"1=1"}') })).toThrow();
    expect(() => sanitizeClientQuery({ query: '{"$\\u0072aw":"1=1"}' })).toThrow();
  });

  it('rejects any unknown $-prefixed operator, not just $raw', () => {
    expect(() => sanitizeClientQuery({ query: { name: { $whereRaw: 'x' } } })).toThrow();
    expect(() => sanitizeClientQuery({ query: '{"$somethingNew":"x"}' })).toThrow();
  });

  // `moleculer-knex-filters` copies a non-string filter value verbatim into
  // `query.$and`, so the filter the portals do send is a second way in.
  it('rejects $raw smuggled through filter', () => {
    expect(() => sanitizeClientQuery({ filter: { name: { $raw: '1=1' } } })).toThrow();
    expect(() => sanitizeClientQuery({ filter: '{"name":{"$raw":"1=1"}}' })).toThrow();
  });

  it('leaves the filters and queries the portals really send untouched', () => {
    const input = {
      filter: { species: 5, name: 'ąžuolas' },
      query: {
        $or: [{ status: { $in: ['APPROVED'] } }, { deletedAt: { $exists: false } }],
        createdAt: { $gte: '2026-01-01', $lt: '2026-02-01' },
        name: { $ilike: '%aa%' },
      },
      sort: '-createdAt',
      page: 1,
    };
    expect(sanitizeClientQuery(input)).toEqual(input);
  });

  it('leaves free text containing the word $raw as a value untouched', () => {
    const input = { query: { name: 'kaina $raw 5' } };
    expect(sanitizeClientQuery(input)).toEqual(input);
  });

  it('rejects $raw nested deeper than the depth cap', () => {
    let deep: unknown = { $raw: '1=1' };
    for (let i = 0; i < 15; i++) deep = { a: deep };
    expect(() => sanitizeClientQuery({ query: deep })).toThrow();
  });

  it('passes through non-objects and null', () => {
    expect(sanitizeClientQuery(undefined)).toBeUndefined();
    expect(sanitizeClientQuery(null)).toBeNull();
    expect(sanitizeClientQuery('x')).toBe('x');
  });
});

// Body sanitization only works because moleculer-web composes a route as
// [...bodyParsers, ...settings.use, ...route.use]; moving the middleware into
// `route.use` would silently stop sanitizing every POST/PATCH body.
describe('api.service main route', () => {
  it('registers the body parsers before the query sanitizer', () => {
    type MountedRoute = { opts: { path: string }; middlewares: Array<{ name: string }> };

    const broker = new ServiceBroker({ logger: false });
    const service = broker.createService(ApiService) as unknown as { routes: MountedRoute[] };

    const route = service.routes.find((r) => r.opts.path === '');
    expect(route).toBeDefined();

    const names = route!.middlewares.map((fn) => fn.name);
    const jsonParserIndex = names.indexOf('jsonParser');
    const sanitizerIndex = names.indexOf('clientQuerySanitizerMiddleware');

    expect(jsonParserIndex).toBeGreaterThanOrEqual(0);
    expect(sanitizerIndex).toBeGreaterThan(jsonParserIndex);
  });
});
