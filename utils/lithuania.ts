import { getGeometries } from 'geojsonjs';
import type { AllTypes, Geometry } from 'geojsonjs/src/types';
import type { Knex } from 'knex';

const SRID_LKS94 = 3346;

const UNDEFINED_TABLE = '42P01';

// The stored border is simplified to 200 m, so the check has to be as lenient or an observation
// that close to the real border would be refused.
const BORDER_TOLERANCE_IN_METERS = 200;

// `moleculer-postgis` reprojects what it stores only when every geometry carries a `crs`, and
// reads the coordinates as lon/lat when it does. Anything else here would check one geometry and
// store another.
function geometryAsLks94(geometries: Geometry[]) {
  const reprojected = geometries.every((geometry) => !!(geometry as { crs?: unknown }).crs);
  const parsed = 'st_geomfromgeojson(g.value)';

  return reprojected
    ? `st_transform(${parsed}, ${SRID_LKS94})`
    : `st_setsrid(${parsed}, ${SRID_LKS94})`;
}

export async function isInsideLithuania(knex: Knex, geom?: AllTypes): Promise<boolean> {
  if (!geom) return true;

  const geometries = getGeometries(geom);

  if (!geometries?.length) return true;

  try {
    // The border is read as a scalar, never joined: a join against a table carrying no statistics
    // — which is what a one-row table looks like after a restore — is priced at 1.8M, and postgres
    // then JIT-compiles every single check. 76 ms per observation, measured, against 0.4 ms.
    // An empty table answers null here, not false, so a boundary nobody filled refuses nothing.
    const { rows } = await knex.raw(
      `select bool_and(st_dwithin((select geom from lithuania_boundary limit 1),
                                  ${geometryAsLks94(geometries)}, ?)) as inside
         from jsonb_array_elements(?::jsonb) as g(value)`,
      [BORDER_TOLERANCE_IN_METERS, JSON.stringify(geometries)],
    );

    return rows[0]?.inside ?? true;
  } catch (err) {
    // With no table there is nothing to check against, which is not the same answer as "outside":
    // a rolled back migration must not refuse every observation in the country.
    if ((err as { code?: string })?.code === UNDEFINED_TABLE) return true;

    throw err;
  }
}
