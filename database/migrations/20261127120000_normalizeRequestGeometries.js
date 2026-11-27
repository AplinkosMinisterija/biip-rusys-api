/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(
      `
      CREATE OR REPLACE FUNCTION rusys_normalize_request_geom()
      RETURNS TRIGGER
      AS
      $$
      BEGIN
        -- ST_IsValid passes a GeometryCollection with overlapping members, and ST_Intersects throws on it.
        IF NEW.geom IS NOT NULL
          AND (ST_GeometryType(NEW.geom) = 'ST_GeometryCollection' OR NOT ST_IsValid(NEW.geom)) THEN
          BEGIN
            NEW.geom := ST_Multi(ST_CollectionExtract(
              ST_Union(ARRAY(SELECT ST_MakeValid(d.geom) FROM ST_Dump(NEW.geom) d)),
              3
            ));
          -- A boot migration that throws restart-loops the container; keep the row as drawn instead.
          EXCEPTION WHEN others THEN
            RAISE WARNING 'request % geometry left as drawn: %', NEW.id, SQLERRM;
          END;
        END IF;

        RETURN NEW;
      END;
      $$
      LANGUAGE plpgsql;
    `,
    )
    .raw(
      `
      CREATE OR REPLACE TRIGGER rusys_normalize_request_geom_trigger
      BEFORE INSERT OR UPDATE OF geom ON requests
      FOR EACH ROW
      EXECUTE FUNCTION rusys_normalize_request_geom();
    `,
    )
    .raw(
      `UPDATE requests SET geom = geom
       WHERE ST_GeometryType(geom) = 'ST_GeometryCollection' OR NOT ST_IsValid(geom)`,
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw('DROP TRIGGER IF EXISTS rusys_normalize_request_geom_trigger ON requests')
    .raw('DROP FUNCTION IF EXISTS rusys_normalize_request_geom()');
};
