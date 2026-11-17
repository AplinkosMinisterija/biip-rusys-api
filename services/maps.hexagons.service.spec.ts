// maps.service reaches requests.service through a cycle; loading it first unwinds the same way
// forms.service.spec.ts does.
import './requests.service';

import { FormNoQuantityReason } from './forms.service';
import MapsHexagonsService from './maps.hexagons.service';
import {
  mapsInvaInformationalIntroducedFormsLayerId,
  mapsInvaInformationalInvasiveFormsLayerId,
  mapsInvaNoQuantityInvasiveFormsLayerId,
  mapsSrisInformationalFormsLayerId,
} from './maps.service';

type Layers = { [key: string]: string[] };
type QueryStub = { calls: unknown[][] };
type LayerQuery = { key: string; query: QueryStub };

type GetLayersQueries = (
  this: unknown,
  adapter: unknown,
  layers: Layers,
  options: unknown,
  buildQuery: (table: string, options: unknown) => QueryStub,
) => LayerQuery[];

const { getLayersQueries } = MapsHexagonsService.prototype as unknown as {
  getLayersQueries: GetLayersQueries;
};

const makeQueryStub = () => {
  const calls: unknown[][] = [];
  const query: any = { calls };
  for (const method of ['where', 'whereNull', 'whereRaw']) {
    query[method] = (...args: unknown[]) => {
      calls.push(args);
      return query;
    };
  }
  return query as QueryStub;
};

const adapter = {
  client: { raw: (sql: string, bindings?: unknown[]) => ({ sql, bindings }) },
};

const build = (layers: Layers): LayerQuery[] =>
  getLayersQueries.call({}, adapter, layers, {}, () => makeQueryStub());

const conditionsOf = (entry: LayerQuery) =>
  entry.query.calls
    .flat()
    .map((arg: any) => (arg && typeof arg === 'object' && 'sql' in arg ? arg.sql : String(arg)))
    .join(' ');

const bindingsOf = (entry: LayerQuery) =>
  entry.query.calls
    .flat()
    .flatMap((arg: any) => (arg && typeof arg === 'object' ? arg.bindings || [] : []));

describe('getLayersQueries — which observations the hexagon grid counts', () => {
  it('counts invasive single observations when that layer is on', () => {
    const queries = build({ inva: [mapsInvaInformationalInvasiveFormsLayerId] });

    expect(queries.map((q) => q.key)).toEqual(['invaInformationalForms']);
    expect(conditionsOf(queries[0])).toContain('is_informational');
    expect(conditionsOf(queries[0])).toContain('no_quantity_reason is distinct from');
    expect(bindingsOf(queries[0])).toContain(FormNoQuantityReason.RESEARCH);
  });

  it('counts introduced single observations on their own key', () => {
    const queries = build({ inva: [mapsInvaInformationalIntroducedFormsLayerId] });

    expect(queries.map((q) => q.key)).toEqual(['invaIntroducedInformationalForms']);
    expect(conditionsOf(queries[0])).toContain('is_informational');
  });

  it('keeps a single observation out of the researched-not-found count', () => {
    const queries = build({ inva: [mapsInvaNoQuantityInvasiveFormsLayerId] });

    expect(queries.map((q) => q.key)).toEqual(['invaNoQuantityForms']);
    expect(conditionsOf(queries[0])).not.toContain('is_informational');
  });

  it('leaves the endangered single observations branch as it was', () => {
    const queries = build({ sris: [mapsSrisInformationalFormsLayerId] });

    expect(queries.map((q) => q.key)).toEqual(['srisInformationalForms']);
    expect(conditionsOf(queries[0])).toContain('is_informational');
    expect(conditionsOf(queries[0])).not.toContain('no_quantity_reason');
  });
});
