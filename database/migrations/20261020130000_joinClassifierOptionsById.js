/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return replaceViews(knex, {
    approved_forms: approvedForms,
    places_with_taxonomies: placesWithTaxonomies,
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return replaceViews(knex, {
    approved_forms: previousApprovedForms,
    places_with_taxonomies: previousPlacesWithTaxonomies,
  });
};

const NEW_SUFFIX = '_new';
const UNIQUE_KEYS = {
  approved_forms: 'id',
  places_with_taxonomies: 'id',
};

async function replaceViews(knex, views) {
  const indexes = [];

  for (const [name, sql] of Object.entries(views)) {
    await knex.raw(`CREATE MATERIALIZED VIEW ${name}${NEW_SUFFIX} AS ${sql}`);
  }

  for (const [name, column] of Object.entries(UNIQUE_KEYS)) {
    const index = `${name}_${column}_uniq`;
    indexes.push(index);
    await knex.raw(`CREATE UNIQUE INDEX ${index}${NEW_SUFFIX} ON ${name}${NEW_SUFFIX} (${column})`);
  }

  for (const name of Object.keys(views)) {
    const index = `${name}_geom_idx`;
    indexes.push(index);
    await knex.raw(`CREATE INDEX ${index}${NEW_SUFFIX} ON ${name}${NEW_SUFFIX} USING GIST (geom)`);
  }

  await knex.raw(`DROP MATERIALIZED VIEW ${Object.keys(views).join(', ')}`);

  for (const name of Object.keys(views)) {
    await knex.raw(`ALTER MATERIALIZED VIEW ${name}${NEW_SUFFIX} RENAME TO ${name}`);
  }

  for (const index of indexes) {
    await knex.raw(`ALTER INDEX ${index}${NEW_SUFFIX} RENAME TO ${index}`);
  }
}

const approvedFormsSelect = (joins) => `
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
    f.activity,
    f.notes,
    f.source_id,
    f.is_relevant,
    f.is_informational,
    f.no_quantity_reason,
    fss.name AS source,
    fsom.value AS method_translate,
    fsoa.value AS activity_translate,
    fsoe.value AS evolution_translate,
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
    ${joins}
  WHERE f.status = 'APPROVED'
`;

const approvedForms = approvedFormsSelect(`
    LEFT JOIN form_settings_options fsoa ON fsoa.id = f.activity_id
    LEFT JOIN form_settings_options fsoe ON fsoe.id = f.evolution_id`);

const previousApprovedForms = approvedFormsSelect(`
    LEFT JOIN form_settings_options fsoa
      ON fsoa.name = f.activity AND fsoa.group = 'ACTIVITY'
    LEFT JOIN form_settings_options fsoe
      ON fsoe.name = f.evolution AND fsoe.group = 'EVOLUTION' AND fsoe.form_type = t.form_type`);

const RELEVANT_FORMS = `
  place_id IS NOT NULL AND status = 'APPROVED' AND is_relevant IS TRUE`;

const latestRelevantForm = (columns) => `
  SELECT DISTINCT ON (place_id) place_id, id, activity, evolution, description, photos, observed_at${columns}
  FROM forms
  WHERE ${RELEVANT_FORMS}
  ORDER BY place_id, observed_at DESC`;

const placesWithTaxonomiesSelect = (latestColumns, joins) => `
  SELECT
    p.id,
    p.code,
    p.status,
    p.geom,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    p.deleted_at,
    p.deleted_by,
    t.*,
    observations.first_observed_at,
    observations.last_observed_at,
    COALESCE(observations.relevant_forms_count, 0) AS relevant_forms_count,
    latest.description,
    latest.photos,
    fsoa.value AS activity_translate,
    fsoe.value AS evolution_translate,
    mhg.id AS hexagon_grid_id,
    ROUND(ST_X(ST_PointOnSurface(p.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(p.geom))::numeric, 2) AS center_coordinates,
    ROUND(ST_Area(p.geom)::numeric, 2) AS area
  FROM places p
    LEFT JOIN taxonomies_all t ON t.species_id = p.species_id
    LEFT JOIN maps_hexagon_grid mhg ON ST_Intersects(mhg.geom, ST_Centroid(p.geom))
    LEFT JOIN (
      SELECT
        place_id,
        min(observed_at) AS first_observed_at,
        max(observed_at) AS last_observed_at,
        count(*) AS relevant_forms_count
      FROM forms
      WHERE ${RELEVANT_FORMS}
      GROUP BY place_id
    ) observations ON observations.place_id = p.id
    LEFT JOIN (${latestRelevantForm(latestColumns)}) latest ON latest.place_id = p.id
    ${joins}
`;

const placesWithTaxonomies = placesWithTaxonomiesSelect(
  `, activity_id, evolution_id`,
  `
    LEFT JOIN form_settings_options fsoa ON fsoa.id = latest.activity_id
    LEFT JOIN form_settings_options fsoe ON fsoe.id = latest.evolution_id`,
);

const previousPlacesWithTaxonomies = placesWithTaxonomiesSelect(
  '',
  `
    LEFT JOIN form_settings_options fsoa
      ON fsoa.name = latest.activity AND fsoa.group = 'ACTIVITY'
    LEFT JOIN form_settings_options fsoe
      ON fsoe.name = latest.evolution AND fsoe.group = 'EVOLUTION' AND fsoe.form_type = t.form_type`,
);
