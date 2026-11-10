'use strict';

import { COMMON_DELETED_SCOPES, throwValidationError } from '../types';

/** What the Knex adapter implements, minus `$raw`, which it hands to `whereRaw`
 * unparameterised — an allow-list so a new adapter operator cannot slip in. */
const ALLOWED_QUERY_OPERATORS = new Set([
  '$and',
  '$eq',
  '$exists',
  '$gt',
  '$gte',
  '$ilike',
  '$in',
  '$lt',
  '$lte',
  '$ne',
  '$nin',
  '$nor',
  '$not',
  '$or',
]);

/** Deeper than any filter the portals build; reaching it is treated as hostile. */
const MAX_QUERY_DEPTH = 12;

const INVALID_OPERATOR_MESSAGE = 'Invalid query operator';

/** Parses what `sanitizeParams` would parse; a leading `"` is the middle layer
 * of a double-encoded `query`, which the library decodes on its second pass. */
function parseLikeTheLibrary(value: string): unknown {
  const trimmed = value.trim();
  const first = trimmed[0];
  if (first !== '{' && first !== '[' && first !== '"') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Validates the DECODED structure, not the text: JSON escaping (`$raw`)
 * leaves no literal for a text match, and `sanitizeParams` parses it straight
 * back into a real key. */
function assertSafeQueryOperators(value: unknown, depth = 0): void {
  if (depth > MAX_QUERY_DEPTH) throwValidationError(INVALID_OPERATOR_MESSAGE);

  if (typeof value === 'string') {
    const parsed = parseLikeTheLibrary(value);
    if (parsed !== undefined) assertSafeQueryOperators(parsed, depth + 1);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) assertSafeQueryOperators(item, depth + 1);
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (key.startsWith('$') && !ALLOWED_QUERY_OPERATORS.has(key)) {
        throwValidationError(INVALID_OPERATOR_MESSAGE, { operator: key });
      }
      assertSafeQueryOperators(nested, depth + 1);
    }
  }
}

export function sanitizeClientQuery(value: unknown): unknown {
  if (typeof value === 'string') {
    const parsed = parseLikeTheLibrary(value);
    if (parsed !== undefined) value = parsed;
  }

  if (!value || typeof value !== 'object') return value;

  const container = value as Record<string, unknown>;

  if (container.scope === 'deleted') {
    container.scope = COMMON_DELETED_SCOPES.join(',');
  } else {
    delete container.scope;
  }

  assertSafeQueryOperators(container.query);
  // `moleculer-knex-filters` copies a non-string filter value verbatim into
  // `query.$and` inside the service, after this middleware has run.
  assertSafeQueryOperators(container.filter);

  return container;
}
