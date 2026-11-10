import path from 'path';

// `@aplinkosministerija/moleculer-accounts` DeepQueryMixin (used in
// `database.mixin.ts`) turns client queries on `object`/`array` fields (e.g.
// `taxonomies.species` `content`, `photos`) into SQL with
// `mongo-query-to-postgres-jsonb` and passes the result to `whereRaw` without
// bindings. Versions before 0.2.18 do not escape values or keys in
// `pathToObjectHelper`, and `utils/requestSanitizer` only checks `$` operators,
// so this checks the version the mixin actually loads.

const accountsDir = path.dirname(
  require.resolve('@aplinkosministerija/moleculer-accounts/package.json'),
);
const resolvedFromMixin = require.resolve('mongo-query-to-postgres-jsonb', {
  paths: [accountsDir],
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const convert = require(resolvedFromMixin);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require(path.join(path.dirname(resolvedFromMixin), 'package.json'));

/** SQL text with every '...' literal (incl. '' escapes) removed. */
function outsideLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

const MARKER = '7777';

describe('mongo-query-to-postgres-jsonb as used by DeepQueryMixin', () => {
  it('is a version that escapes values and keys (>= 0.2.18)', () => {
    const [major, minor, patch] = version.split('.').map(Number);
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(2018);
  });

  it('keeps ordinary queries unchanged', () => {
    expect(convert('content', { status: 'APPROVED' }, [])).toBe(
      `content @> '{ "status": "APPROVED" }'`,
    );
    expect(convert('photos_elem', { name: 'a.jpg' }, [])).toBe(
      `photos_elem @> '{ "name": "a.jpg" }'`,
    );
  });

  const payloads: Record<string, [string, Record<string, unknown>]> = {
    'quote in a value (object field)': [
      'content',
      { status: `x"}'::jsonb OR ${MARKER}=${MARKER} OR 'a'='a` },
    ],
    'quote in a key (object field)': [
      'content',
      { [`a"}'::jsonb OR ${MARKER}=${MARKER} OR '{"b`]: 'v' },
    ],
    'quote in a value (array field)': [
      'photos_elem',
      { name: `x"}'::jsonb) OR ${MARKER}=${MARKER} OR ('a'='a` },
    ],
    'nested value': ['content', { a: { b: `'); select ${MARKER}; --` } }],
  };

  for (const [name, [field, query]] of Object.entries(payloads)) {
    it(`keeps client input inside SQL literals: ${name}`, () => {
      const sql = convert(field, query, []);
      expect(sql).toContain(MARKER);
      expect(outsideLiterals(sql)).not.toContain(MARKER);
    });
  }
});
