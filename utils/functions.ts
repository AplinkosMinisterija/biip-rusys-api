import { createHash } from 'crypto';
import _ from 'lodash';
import { Readable } from 'stream';
import { FormStatus } from '../types';

export function toReadableStream(fetchReadable: any): NodeJS.ReadableStream {
  return new Readable({
    async read() {
      if (!fetchReadable?.read) {
        this.emit('done');
        return;
      }

      const { value, done } = await fetchReadable.read();
      if (done) {
        this.emit('end');
        return;
      }

      this.push(value);
    },
  });
}

export function toMD5Hash(text: string) {
  return createHash('md5').update(text).digest('hex');
}

const FORMS_SINGLE_UPDATE_ACTION = 'forms.update';

interface RelevancyRecomputeForm {
  isRelevant?: boolean;
  isInformational?: boolean;
  status?: string;
  place?: number | object;
}

/**
 * Place geom derives from relevant forms only, so a single-form relevancy
 * change must recompute its place. Only the direct update (PATCH /forms/:id)
 * qualifies: bulk paths must not recompute per form — places.updateForms
 * emits one places.changed itself (per-form emissions would duplicate place
 * history entries), and places.removed flags the forms of an already-removed
 * place, where a recompute would throw on empty geometry.
 */
export function shouldRecomputePlaceOnRelevancyChange(
  form: RelevancyRecomputeForm,
  prevForm?: RelevancyRecomputeForm,
  parentActionName?: string,
): boolean {
  const relevancyChanged = prevForm?.isRelevant !== form.isRelevant;

  return (
    relevancyChanged &&
    parentActionName === FORMS_SINGLE_UPDATE_ACTION &&
    !!form.place &&
    form.place === prevForm?.place &&
    form.status === FormStatus.APPROVED &&
    !form.isInformational
  );
}

export function parseToObject(data: object | string) {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {}
  }

  return data;
}

export function optionCodeFromLabel(label: string): string {
  return _.snakeCase(_.deburr(label)).toUpperCase();
}

// The ids reach `knex.raw` as literals (a bound `whereIn` breaks past ~100k
// items), so anything that is not a plain positive integer is dropped here.
export function toPositiveIntegerIds(values: unknown): number[] {
  const list = Array.isArray(values) ? values : [values];

  return list
    .map((value) => (typeof value === 'number' ? value : Number(String(value).trim())))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export type OfferedSign = {
  id: number | string;
  stages?: Array<{ id: number | string }>;
};

export function signIsOffered(signs: OfferedSign[], signId: number): boolean {
  return signs.some((sign) => Number(sign.id) === signId);
}

export function stageIsOffered(
  signs: OfferedSign[],
  signId: number | null | undefined,
  stageId: number,
): boolean {
  if (!signId) return false;

  const sign = signs.find((offered) => Number(offered.id) === signId);

  return !!sign?.stages?.some((stage) => Number(stage.id) === stageId);
}

// Every historical protected-species form holds a deactivated classifier, so an
// unchanged value must never be re-validated against the current criterion.
export function classifierChanged(value: unknown, stored: unknown): boolean {
  if (value === undefined) return false;

  const toId = (id: unknown) => (id === null || id === undefined ? null : Number(id));

  return toId(value) !== toId(stored);
}
