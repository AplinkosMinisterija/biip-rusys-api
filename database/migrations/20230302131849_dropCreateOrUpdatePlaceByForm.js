/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.raw('DROP FUNCTION create_or_update_place_by_form');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(
    `CREATE OR REPLACE FUNCTION create_or_update_place_by_form( 
      f_id integer, 
      p_id integer DEFAULT NULL
    ) 
    RETURNS numeric
    AS
    $$
    DECLARE
    form forms%ROWTYPE;
    species taxonomy_species%ROWTYPE;
    place places%ROWTYPE;
    geometry geometry;
    BEGIN
      EXECUTE 'SELECT * FROM forms WHERE id = $1 limit 1;'
      INTO form
      USING f_id;
    
      IF form.id IS NULL THEN
        RAISE EXCEPTION 'Form % not found.', f_id;
      ELSIF form.geom IS NULL THEN
        RAISE EXCEPTION 'Form % does not have geometry field setup.', f_id;
      ELSIF (form.status != 'APPROVED') THEN
        RAISE EXCEPTION 'Form %1 not approved.', f_id;
      END IF;
    
      EXECUTE 'SELECT * FROM taxonomy_species WHERE id = $1 limit 1;'
      INTO species 
      USING form.species_id;
    
      IF p_id IS NULL THEN
        EXECUTE 'INSERT INTO places(species_id, created_at, created_by) VALUES ($1, NOW(), $2) RETURNING *'
        INTO place
        USING form.species_id, form.created_by;
      ELSE
        EXECUTE 'SELECT * FROM places WHERE id = $1 AND species_id = $2 limit 1;'
        INTO place
        USING p_id, form.species_id;
      END IF;
    
      IF place.id IS NULL THEN
          RAISE EXCEPTION 'Place % not found.', p_id;
      ELSIF place.deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'Place % is deleted.', place.id;
      END IF;
    
      SELECT geometry_to_polygon.geom INTO STRICT geometry FROM (
        (
          SELECT ST_BUFFER(form.geom, form.geom_buffer_size) AS geom 
          WHERE ST_GeometryType(form.geom) IN ('ST_Point','ST_LineString','ST_MultiPoint','ST_MultiLineString')
        )
        UNION ALL
        (
          SELECT form.geom AS geom 
          WHERE ST_GEOMETRYTYPE(form.geom) IN ('ST_Polygon','ST_MultiPolygon')
        )
      ) geometry_to_polygon
      GROUP BY geometry_to_polygon.geom
      LIMIT 1;
      
      IF place.geom IS NOT NULL THEN
        SELECT ST_MULTI(ST_UNION(place.geom, geometry)) INTO STRICT geometry;
      ELSE
        SELECT ST_MULTI(geometry) INTO STRICT geometry;
      END IF;
      
      INSERT INTO	place_histories(place_id, geom, created_by, created_at) 
      VALUES (place.id, geometry, place.created_by, NOW());
      
      UPDATE places
      SET geom = geometry
      WHERE id = place.id;
    
      RETURN place.id;
    END;
    $$
    LANGUAGE plpgsql;`
  );
};
