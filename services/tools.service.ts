'use strict';

import { createHash } from 'crypto';
import knex, { Knex } from 'knex';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import config from '../knexfile';
import { EndpointType, throwValidationError } from '../types';
import { FormSettingsGroupType } from './forms.settings.options.service';

type ClassifierColumn = { code: string; id: string };

type ClassifierReport = {
  mapped: number;
  byCode: Record<string, number>;
  unmapped: { count: number; codes: Record<string, number> };
  blank: number;
};

const CLASSIFIER_COLUMNS: Record<string, ClassifierColumn> = {
  [FormSettingsGroupType.ACTIVITY]: { code: 'activity', id: 'activity_id' },
  [FormSettingsGroupType.EVOLUTION]: { code: 'evolution', id: 'evolution_id' },
};

// `approved_forms` resolves a sign by group and name alone and a stage by group, name and
// form type; matching those exactly is what keeps every stored label unchanged.
const OPTION_MATCH: Record<string, string> = {
  [FormSettingsGroupType.ACTIVITY]: '',
  [FormSettingsGroupType.EVOLUTION]:
    'AND o.form_type = t.form_type AND t.species_id = f.species_id',
};

const OPTION_SOURCE: Record<string, string> = {
  [FormSettingsGroupType.ACTIVITY]: 'form_settings_options o',
  [FormSettingsGroupType.EVOLUTION]: 'form_settings_options o, taxonomies_all t',
};

const DEFAULT_BATCH_SIZE = 5000;

function countByCode(rows: Array<{ code: string; count: string }>): Record<string, number> {
  return rows.reduce((acc: Record<string, number>, row) => {
    acc[row.code] = Number(row.count);
    return acc;
  }, {});
}

@Service({
  name: 'tools',
})
export default class ToolsService extends moleculer.Service {
  @Action({
    types: [EndpointType.ADMIN],
    params: {
      batchSize: {
        type: 'number',
        convert: true,
        integer: true,
        positive: true,
        default: DEFAULT_BATCH_SIZE,
      },
    },
    timeout: 0,
  })
  async backfillClassifierIds(ctx: Context<{ batchSize: number }>) {
    const db = knex(config);

    try {
      const report: Record<string, ClassifierReport> = {};

      for (const group of Object.keys(CLASSIFIER_COLUMNS)) {
        report[group] = await this.backfillClassifier(db, group, ctx.params.batchSize);
      }

      return report;
    } finally {
      await db.destroy();
    }
  }

  @Method
  async backfillClassifier(db: Knex, group: string, batchSize: number): Promise<ClassifierReport> {
    const { code, id } = CLASSIFIER_COLUMNS[group];

    await this.rejectAmbiguousCodes(db, group);

    const bounds = await db('forms').min({ min: 'id' }).max({ max: 'id' }).first();

    let mapped = 0;

    for (
      let from = Number(bounds?.min ?? 0);
      from <= Number(bounds?.max ?? -1);
      from += batchSize
    ) {
      const result = await db.raw(
        `UPDATE forms f SET ${id} = o.id
         FROM ${OPTION_SOURCE[group]}
         WHERE o."group" = ?
           AND o.name = f.${code}
           AND o.deleted_at IS NULL
           ${OPTION_MATCH[group]}
           AND f.${id} IS NULL
           AND f.${code} IS NOT NULL
           AND f.${code} <> ''
           AND f.id >= ? AND f.id < ?`,
        [group, from, from + batchSize],
      );

      mapped += Number(result.rowCount ?? 0);
    }

    const byCode = await db('forms')
      .select(`${code} AS code`)
      .count()
      .whereNotNull(id)
      .groupBy(code);

    const unmapped = await db('forms')
      .select(`${code} AS code`)
      .count()
      .whereNull(id)
      .whereNotNull(code)
      .whereNot(code, '')
      .groupBy(code);

    const blank = await db('forms').where(code, '').count().first();

    return {
      mapped,
      byCode: countByCode(byCode),
      unmapped: {
        count: unmapped.reduce((total, row) => total + Number(row.count), 0),
        codes: countByCode(unmapped),
      },
      blank: Number(blank?.count ?? 0),
    };
  }

  // The view resolves a label afresh on every refresh, so an ambiguous match only ever showed the
  // wrong one; writing the id makes that choice permanent, which is worth refusing instead.
  @Method
  async rejectAmbiguousCodes(db: Knex, group: string) {
    const { code, id } = CLASSIFIER_COLUMNS[group];

    const { rows } = await db.raw(
      `SELECT count(*) FROM (
         SELECT f.id
         FROM forms f, ${OPTION_SOURCE[group]}
         WHERE o."group" = ?
           AND o.name = f.${code}
           AND o.deleted_at IS NULL
           ${OPTION_MATCH[group]}
           AND f.${id} IS NULL
           AND f.${code} IS NOT NULL
           AND f.${code} <> ''
         GROUP BY f.id
         HAVING count(*) > 1
       ) ambiguous`,
      [group],
    );

    const count = Number(rows[0]?.count ?? 0);

    if (count) {
      throwValidationError(`${count} forms match more than one ${group} option`, { group });
    }
  }

  @Action({
    params: {
      url: 'string',
      stream: {
        type: 'boolean',
        default: false,
      },
      encoding: {
        type: 'string',
        enum: ['binary', 'base64'],
        default: 'binary',
      },
      waitFor: {
        type: 'string',
        optional: true,
      },
    },
    timeout: 0,
  })
  async makeScreenshot(
    ctx: Context<{
      url: string;
      stream: boolean;
      encoding: string;
      waitFor: string;
    }>,
  ) {
    const { url, stream, encoding, waitFor } = ctx.params;
    const searchParams = new URLSearchParams({
      quality: '75',
      url: url,
      type: 'jpeg',
      encoding,
    });

    if (waitFor) {
      searchParams.set('waitFor', waitFor);
    }

    const screenshotEndpoint = `${this.toolsHost()}/screenshot`;
    return new Promise(async (resolve, reject) => {
      fetch(`${screenshotEndpoint}?${searchParams.toString()}`, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      })
        .then((r) => {
          // Without this the error body is uploaded as a .jpeg, MinIO reports it
          // as too small and the job fails with the useless "Screenshot is emtpy".
          if (!r.ok) {
            throw new Error(`Screenshot service responded with ${r.status}`);
          }
          return stream ? r.body?.getReader() : (r.text() as any);
        })
        .then(resolve)
        .catch((err) => {
          console.error(err);
          reject(err?.message || 'Error while getting screenshot');
        });
    });
  }

  @Action({
    params: {
      url: 'string',
      footer: {
        type: 'string',
        optional: true,
      },
      header: {
        type: 'string',
        optional: true,
      },
    },
    timeout: 0,
  })
  async makePdf(ctx: Context<{ url: string; header?: string; footer?: string }>) {
    const { url, footer, header } = ctx.params;

    const pdfEndpoint = `${this.toolsHost()}/pdf`;

    return new Promise(async (resolve, reject) => {
      fetch(pdfEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          url,
          height: 877,
          width: 620,
          footer,
          header,
          margin: {
            top: 50,
            bottom: 50,
            left: 50,
            right: 50,
          },
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      })
        .then((r) => {
          if (!r.ok) {
            throw new Error(`PDF service responded with ${r.status}`);
          }
          return r.body?.getReader();
        })
        .then(resolve)
        .catch((err) => {
          console.error(err);
          reject(err?.message || 'Error while getting pdf');
        });
    });
  }

  @Method
  toolsHost() {
    return process.env.TOOLS_HOST || 'https://internalapi.biip.lt/tools';
  }
}
