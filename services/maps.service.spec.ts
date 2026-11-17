// maps.service reaches requests.service through a cycle; loading it first unwinds the same way
// forms.service.spec.ts does.
import './requests.service';

import MapsService, {
  mapsSrisInformationalFormsLayerId,
  mapsSrisPlacesLayerId,
} from './maps.service';
import { UserType } from './users.service';

type MapsData = { places: number[]; forms: number[] };
type FilterResult = { filter: string; layers: string };

type ComputeFilterValue = (
  this: unknown,
  ctx: {
    meta: { user?: { id: number; type: string; isExpert: boolean } };
    call: (action: string) => Promise<MapsData>;
  },
  filterValue?: string,
  layersValue?: string,
) => Promise<FilterResult>;

const { computeFilterValue } = MapsService.prototype as unknown as {
  computeFilterValue: ComputeFilterValue;
};

const observer = { id: 5, type: UserType.USER, isExpert: false };
const layers = [mapsSrisPlacesLayerId, mapsSrisInformationalFormsLayerId].join(',');

const compute = (data: MapsData, user = observer) =>
  computeFilterValue.call(
    {},
    { meta: { user }, call: async () => data },
    '',
    layers,
  ) as Promise<FilterResult>;

describe('computeFilterValue — what an observer is allowed to see on the map', () => {
  it('keeps both layers when the observer has places and single observations', async () => {
    const result = await compute({ places: [1, 2], forms: [7] });

    expect(result.filter).toContain(`${mapsSrisPlacesLayerId}:( "id" in ( 1 , 2 ) )`);
    expect(result.filter).toContain(`${mapsSrisInformationalFormsLayerId}:( "id" in ( 7 ) )`);
    expect(result.layers).toBe(layers);
  });

  it('denies the places layer when the observer only has single observations', async () => {
    const result = await compute({ places: [], forms: [7] });

    expect(result.filter).toContain(`${mapsSrisPlacesLayerId}:( "id" in ( -1 ) )`);
    expect(result.filter).toContain(`${mapsSrisInformationalFormsLayerId}:( "id" in ( 7 ) )`);
    expect(result.layers).toBe(layers);
  });

  it('denies the single observations layer when the observer only has places', async () => {
    const result = await compute({ places: [3], forms: [] });

    expect(result.filter).toContain(`${mapsSrisPlacesLayerId}:( "id" in ( 3 ) )`);
    expect(result.filter).toContain(`${mapsSrisInformationalFormsLayerId}:( "id" in ( -1 ) )`);
    expect(result.layers).toBe(layers);
  });

  it('leaves a layer the caller did not ask for out of the filter', async () => {
    const result = (await computeFilterValue.call(
      {},
      {
        meta: { user: observer },
        call: async (): Promise<MapsData> => ({ places: [3], forms: [] }),
      },
      '',
      mapsSrisPlacesLayerId,
    )) as FilterResult;

    expect(result.filter).toBe(`${mapsSrisPlacesLayerId}:( "id" in ( 3 ) )`);
    expect(result.filter).not.toContain(mapsSrisInformationalFormsLayerId);
    expect(result.layers).toBe(mapsSrisPlacesLayerId);
  });

  it('refuses an observer with nothing of their own and no approved request', async () => {
    await expect(compute({ places: [], forms: [] })).rejects.toThrow();
  });

  it('leaves an expert unfiltered', async () => {
    const result = await compute({ places: [], forms: [] }, { ...observer, isExpert: true });

    expect(result.filter).toBe('');
    expect(result.layers).toBe(layers);
  });
});
