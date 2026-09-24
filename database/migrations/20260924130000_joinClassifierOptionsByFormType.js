/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return replaceViews(knex, {
    taxonomies_all: taxonomiesAll(FORM_TYPE_COLUMN),
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
    taxonomies_all: taxonomiesAll(''),
    approved_forms: previousApprovedForms,
    places_with_taxonomies: previousPlacesWithTaxonomies,
  });
};

const NEW_SUFFIX = '_new';
const GEOM_VIEWS = ['approved_forms', 'places_with_taxonomies'];
const UNIQUE_KEYS = {
  taxonomies_all: 'species_id',
  approved_forms: 'id',
  places_with_taxonomies: 'id',
};

async function replaceViews(knex, definitions) {
  const taxonomies = `taxonomies_all${NEW_SUFFIX}`;
  const views = {
    taxonomies_all: definitions.taxonomies_all,
    approved_forms: definitions.approved_forms(taxonomies),
    places_with_taxonomies: definitions.places_with_taxonomies(taxonomies),
  };
  const indexes = [];

  for (const [name, sql] of Object.entries(views)) {
    await knex.raw(`CREATE MATERIALIZED VIEW ${name}${NEW_SUFFIX} AS ${sql}`);
  }

  for (const [name, column] of Object.entries(UNIQUE_KEYS)) {
    const index = `${name}_${column}_uniq`;
    indexes.push(index);
    await knex.raw(`CREATE UNIQUE INDEX ${index}${NEW_SUFFIX} ON ${name}${NEW_SUFFIX} (${column})`);
  }

  for (const name of GEOM_VIEWS) {
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

const FORM_TYPE_COLUMN = `,
  CASE
    WHEN ts.type = 'ENDANGERED' THEN
      CASE
        WHEN tk.name = 'Gyvūnai' THEN 'ENDANGERED_ANIMAL'
        WHEN tk.name = 'Augalai' THEN 'ENDANGERED_PLANT'
        WHEN tk.name = 'Grybai' THEN 'ENDANGERED_MUSHROOM'
        ELSE 'DEFAULT'
      END
    WHEN tp.name = 'Žuvys' THEN 'INVASIVE_FISH'
    WHEN tk.name = 'Augalai' THEN 'INVASIVE_PLANT'
    WHEN tp.name = 'Žinduoliai' THEN 'INVASIVE_MAMMAL'
    WHEN tp.name = 'Moliuskai' THEN 'INVASIVE_MOLLUSK'
    WHEN tp.name = 'Vėžiagyviai' THEN 'INVASIVE_CRUSTACEAN'
    ELSE 'INVASIVE'
  END AS form_type`;

const taxonomiesAll = (formTypeColumn) => `
  SELECT
    ts.id AS species_id,
    ts.name AS species_name,
    ts.name_latin AS species_name_latin,
    ts.type AS species_type,
    ts.is_hidden AS species_is_hidden,
    ts.synonyms AS species_synonyms,
    ts.global_id AS species_global_id,
    ts.description AS species_description,
    ts.conventions AS species_conventions,
    ts.photos AS species_photos,
    ts.lt_added_at AS species_lt_added_at,
    ts.eu_added_at AS species_eu_added_at,
    tc.id AS class_id,
    tc.name AS class_name,
    tc.name_latin AS class_name_latin,
    tp.id AS phylum_id,
    tp.name AS phylum_name,
    tp.name_latin AS phylum_name_latin,
    tk.id AS kingdom_id,
    tk.name AS kingdom_name,
    tk.name_latin AS kingdom_name_latin${formTypeColumn}
  FROM taxonomy_species ts
    JOIN taxonomy_classes tc ON ts.class_id = tc.id
    JOIN taxonomy_phylums tp ON tc.phylum_id = tp.id
    JOIN taxonomy_kingdoms tk ON tp.kingdom_id = tk.id
  WHERE ts.deleted_at IS NULL
    AND tk.deleted_at IS NULL
    AND tp.deleted_at IS NULL
    AND tc.deleted_at IS NULL
  GROUP BY ts.id, tc.id, tp.id, tk.id
  ORDER BY ts.name
`;

const APPROVED_FORMS_GEOM = `
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
  ), 3346)::geometry(multipolygon, 3346) AS geom`;

const approvedForms = (taxonomies) => `
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
    ${APPROVED_FORMS_GEOM},
    t.*,
    mhg.id AS hexagon_grid_id,
    ROUND(ST_X(ST_PointOnSurface(f.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(f.geom))::numeric, 2) AS center_coordinates
  FROM forms f
    LEFT JOIN ${taxonomies} t ON t.species_id = f.species_id
    LEFT JOIN maps_hexagon_grid mhg ON ST_Intersects(mhg.geom, ST_Centroid(f.geom))
    LEFT JOIN form_settings_sources fss ON fss.id = f.source_id
    LEFT JOIN form_settings_options fsom
      ON fsom.name = f.method AND fsom.group = 'METHOD' AND fsom.form_type = t.form_type
    LEFT JOIN form_settings_options fsoe
      ON fsoe.name = f.evolution AND fsoe.group = 'EVOLUTION' AND fsoe.form_type = t.form_type
    LEFT JOIN form_settings_options fsoa
      ON fsoa.name = f.activity AND fsoa.group = 'ACTIVITY'
    LEFT JOIN form_settings_options fsor
      ON fsor.name = f.no_quantity_reason AND fsor.group = 'NO_QUANTITY_REASON'
  WHERE f.status = 'APPROVED'
`;

const previousApprovedForms = (taxonomies) => `
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
    translates.method_translate,
    translates.activity_translate,
    translates.evolution_translate,
    translates.no_quantity_reason_translate,
    ${APPROVED_FORMS_GEOM},
    t.*,
    mhg.id AS hexagon_grid_id,
    ROUND(ST_X(ST_PointOnSurface(f.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(f.geom))::numeric, 2) AS center_coordinates
  FROM forms f
    LEFT JOIN ${taxonomies} t ON t.species_id = f.species_id
    LEFT JOIN maps_hexagon_grid mhg ON ST_Intersects(mhg.geom, ST_Centroid(f.geom))
    LEFT JOIN form_settings_sources fss ON fss.id = f.source_id
    LEFT JOIN (
      SELECT
        f.id,
        f.method,
        min(fsom.value) AS method_translate,
        f.activity,
        min(fsoa.value) AS activity_translate,
        f.evolution,
        min(fsoe.value) AS evolution_translate,
        f.no_quantity_reason,
        min(fsor.value) AS no_quantity_reason_translate
      FROM forms f
        LEFT JOIN form_settings_options fsom ON fsom.name = f.method AND fsom.group = 'METHOD'
        LEFT JOIN form_settings_options fsoe ON fsoe.name = f.evolution AND fsoe.group = 'EVOLUTION'
        LEFT JOIN form_settings_options fsoa ON fsoa.name = f.activity AND fsoa.group = 'ACTIVITY'
        LEFT JOIN form_settings_options fsor
          ON fsor.name = f.no_quantity_reason AND fsor.group = 'NO_QUANTITY_REASON'
      GROUP BY f.id
    ) translates ON translates.id = f.id
  WHERE f.status = 'APPROVED'
`;

const RELEVANT_FORMS = `
  place_id IS NOT NULL AND status = 'APPROVED' AND is_relevant IS TRUE`;

const LATEST_RELEVANT_FORM = `
  SELECT DISTINCT ON (place_id) place_id, id, activity, evolution, description, photos, observed_at
  FROM forms
  WHERE ${RELEVANT_FORMS}
  ORDER BY place_id, observed_at DESC`;

const placesWithTaxonomiesSelect = (taxonomies, translates) => `
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
    ${translates.columns},
    mhg.id AS hexagon_grid_id,
    ROUND(ST_X(ST_PointOnSurface(p.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(p.geom))::numeric, 2) AS center_coordinates,
    ROUND(ST_Area(p.geom)::numeric, 2) AS area
  FROM places p
    LEFT JOIN ${taxonomies} t ON t.species_id = p.species_id
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
    LEFT JOIN (${LATEST_RELEVANT_FORM}) latest ON latest.place_id = p.id
    ${translates.joins}
`;

const placesWithTaxonomies = (taxonomies) =>
  placesWithTaxonomiesSelect(taxonomies, {
    columns: `fsoa.value AS activity_translate,
    fsoe.value AS evolution_translate`,
    joins: `
    LEFT JOIN form_settings_options fsoa
      ON fsoa.name = latest.activity AND fsoa.group = 'ACTIVITY'
    LEFT JOIN form_settings_options fsoe
      ON fsoe.name = latest.evolution AND fsoe.group = 'EVOLUTION' AND fsoe.form_type = t.form_type`,
  });

const previousPlacesWithTaxonomies = (taxonomies) =>
  placesWithTaxonomiesSelect(taxonomies, {
    columns: `latest_translates.latest_activity_translate AS activity_translate,
    latest_translates.latest_evolution_translate AS evolution_translate`,
    joins: `
    LEFT JOIN (
      SELECT
        latest.id,
        min(fsoa.value) AS latest_activity_translate,
        min(fsoe.value) AS latest_evolution_translate
      FROM (${LATEST_RELEVANT_FORM}) latest
        LEFT JOIN form_settings_options fsoa
          ON fsoa.name = latest.activity AND fsoa.group = 'ACTIVITY'
        LEFT JOIN form_settings_options fsoe
          ON fsoe.name = latest.evolution AND fsoe.group = 'EVOLUTION'
      GROUP BY latest.id
    ) latest_translates ON latest_translates.id = latest.id`,
  });
