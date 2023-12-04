/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.raw(
    `CREATE OR REPLACE FUNCTION rusys_get_place_data_from_relevant_forms( 
      p_id integer
    ) 
    RETURNS TABLE (
      form_ids int[],
      geom geometry,
      quantity numeric
    )
    AS
    $$
    BEGIN
      RETURN QUERY
        SELECT
          combined_place_data.form_ids,
          combined_place_data.geom,
          (ROUND(ST_Area(ST_Transform(combined_place_data.geom, 3346)) * density))::numeric AS quantity
        FROM
          (
            SELECT
              array_agg(forms_with_density.id) as form_ids,
              ST_Multi(ST_Union(ST_Transform(forms_with_density.geom, 3346))) as geom,
              AVG(forms_with_density.density) AS density
            FROM
              (
                SELECT
                  transformed_forms.id,
                  transformed_forms.geom,
                  transformed_forms.quantity,
                  CASE
                    WHEN transformed_forms.transect_area > 0 THEN transformed_forms.quantity / transformed_forms.transect_area
                    WHEN ST_Area(transformed_forms.geom) > 0 THEN transformed_forms.quantity / ST_Area(ST_Transform(transformed_forms.geom, 3346))
                    ELSE 0
                  END AS density
                FROM
                  (
                    SELECT
                      forms.id,
                      forms.quantity,
                      CASE
                        WHEN ST_GeometryType(forms.geom) IN (
                          'ST_Point',
                          'ST_LineString',
                          'ST_MultiPoint',
                          'ST_MultiLineString'
                        ) THEN ST_Buffer(forms.geom, forms.geom_buffer_size)
                        WHEN ST_GeometryType(forms.geom) IN ('ST_Polygon', 'ST_MultiPolygon') THEN forms.geom
                      END AS geom,
                      CASE
                        WHEN forms.transect ->> 'unit' = 'METER' THEN (forms.transect ->> 'height') :: numeric * (forms.transect ->> 'width') :: numeric
                        WHEN forms.transect ->> 'unit' = 'CENTIMETER' THEN (forms.transect ->> 'height') :: numeric * (forms.transect ->> 'width') :: numeric / 10000
                        ELSE 0
                      END AS transect_area
                    FROM
                      forms
                    WHERE forms.status = 'APPROVED'
                    AND forms.is_relevant IS TRUE
                    AND forms.place_id = p_id
                  ) AS transformed_forms
              ) AS forms_with_density
          ) AS combined_place_data;
    END;
    $$
    LANGUAGE plpgsql;`,
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw('DROP FUNCTION rusys_get_place_data_from_relevant_forms');
};
