/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return replaceApprovedForms(knex, approvedForms);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return replaceApprovedForms(knex, previousApprovedForms);
};

const NEW_SUFFIX = '_new';
const INDEXES = ['approved_forms_id_uniq', 'approved_forms_geom_idx'];

// Postgres cannot add a column to a materialized view, so the whole view is rebuilt. The old one
// stays queryable until the swap, which keeps the QGIS layers off a missing relation.
async function replaceApprovedForms(knex, sql) {
  await knex.raw(`CREATE MATERIALIZED VIEW approved_forms${NEW_SUFFIX} AS ${sql}`);
  await knex.raw(
    `CREATE UNIQUE INDEX approved_forms_id_uniq${NEW_SUFFIX} ON approved_forms${NEW_SUFFIX} (id)`,
  );
  await knex.raw(
    `CREATE INDEX approved_forms_geom_idx${NEW_SUFFIX} ON approved_forms${NEW_SUFFIX} USING GIST (geom)`,
  );

  // The DROP takes ACCESS EXCLUSIVE and every QGIS read would queue behind it; failing fast and
  // retrying on the next boot beats holding the whole deploy and the map hostage.
  await knex.raw(`SET LOCAL lock_timeout = '10s'`);
  await knex.raw('DROP MATERIALIZED VIEW approved_forms');
  await knex.raw(`ALTER MATERIALIZED VIEW approved_forms${NEW_SUFFIX} RENAME TO approved_forms`);

  for (const index of INDEXES) {
    await knex.raw(`ALTER INDEX ${index}${NEW_SUFFIX} RENAME TO ${index}`);
  }
}

const approvedFormsSelect = (classifierIds) => `
  SELECT
    f.id,
    f.quantity,
    f.description,
    f.place_id,
    f.created_at,
    f.observed_at,
    f.observed_by,
    f.photos,
    f.evolution,
    f.method,
    f.activity,${classifierIds}
    f.notes,
    f.source_id,
    f.is_relevant,
    f.is_informational,
    f.no_quantity_reason,
    fss.name AS source,
    fsom.value AS method_translate,
    COALESCE(fsoa.value, fsoa_legacy.value) AS activity_translate,
    COALESCE(fsoe.value, fsoe_legacy.value) AS evolution_translate,
    fsor.value AS no_quantity_reason_translate,
    ST_Transform(ST_Multi(
      CASE
        WHEN ST_GeometryType(f.geom) IN (
          'ST_Point',
          'ST_LineString',
          'ST_MultiPoint',
          'ST_MultiLineString'
        ) THEN ST_Buffer(f.geom, COALESCE(f.geom_buffer_size, 1))
        WHEN ST_GeometryType(f.geom) IN ('ST_Polygon', 'ST_MultiPolygon') THEN f.geom
      END
    ), 3346)::geometry(multipolygon, 3346) AS geom,
    t.*,
    mhg.id AS hexagon_grid_id,
    ROUND(ST_X(ST_PointOnSurface(f.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(f.geom))::numeric, 2) AS center_coordinates
  FROM forms f
    LEFT JOIN taxonomies_all t ON t.species_id = f.species_id
    LEFT JOIN maps_hexagon_grid mhg ON ST_Intersects(mhg.geom, ST_Centroid(f.geom))
    LEFT JOIN form_settings_sources fss ON fss.id = f.source_id
    LEFT JOIN form_settings_options fsom
      ON fsom.name = f.method AND fsom.group = 'METHOD' AND fsom.form_type = t.form_type
    LEFT JOIN form_settings_options fsor
      ON fsor.name = f.no_quantity_reason AND fsor.group = 'NO_QUANTITY_REASON'
    LEFT JOIN form_settings_options fsoa ON fsoa.id = f.activity_id
    LEFT JOIN form_settings_options fsoe ON fsoe.id = f.evolution_id
    LEFT JOIN form_settings_options fsoa_legacy
      ON f.activity_id IS NULL AND fsoa_legacy.name = f.activity
      AND fsoa_legacy.group = 'ACTIVITY'
    LEFT JOIN form_settings_options fsoe_legacy
      ON f.evolution_id IS NULL AND fsoe_legacy.name = f.evolution
      AND fsoe_legacy.group = 'EVOLUTION' AND fsoe_legacy.form_type = t.form_type
  WHERE f.status = 'APPROVED'
`;

// The request exports resolve the label themselves, so they read the ids rather than the
// translate the view already carries.
const approvedForms = approvedFormsSelect(`
    f.activity_id,
    f.evolution_id,`);

const previousApprovedForms = approvedFormsSelect('');
