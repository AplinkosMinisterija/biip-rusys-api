/**
 * The hexagon grid only reached the territorial sea, so observations further
 * out in the Lithuanian exclusive economic zone fell outside every hexagon.
 *
 * Missing cells of the same lattice are added over the zone. The border with
 * Russia follows the 1997 treaty points (WGS 84); the borders with Latvia and
 * Sweden are approximated by the 56.08°N parallel and the 19.05°E meridian.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(
      `WITH zone AS (
         SELECT ST_Transform(
           ST_GeomFromText(
             'POLYGON((20.9583 55.2817, 20.653783 55.384, 19.924433 55.636250,
                       19.046750 55.923667, 19.05 56.08, 21.065 56.07, 20.9583 55.2817))',
             4326
           ),
           3346
         ) AS geom
       ),
       cells AS (
         SELECT
           c,
           r,
           281076.2971 + c * 8660.254037844386 AS x,
           6259254.9556 - (((c % 2) + 2) % 2) * 5000 - r * 10000 AS y
         FROM generate_series(-15, 45) c, generate_series(-5, 40) r
       ),
       hexagons AS (
         SELECT
           c,
           r,
           ST_SetSRID(
             ST_MakePolygon(
               ST_MakeLine(ARRAY[
                 ST_MakePoint(x, y),
                 ST_MakePoint(x + 2886.751345948129, y + 5000),
                 ST_MakePoint(x + 8660.254037844386, y + 5000),
                 ST_MakePoint(x + 11547.005383792516, y),
                 ST_MakePoint(x + 8660.254037844386, y - 5000),
                 ST_MakePoint(x + 2886.751345948129, y - 5000),
                 ST_MakePoint(x, y)
               ])
             ),
             3346
           ) AS geom
         FROM cells
       ),
       missing AS (
         SELECT h.c, h.r, h.geom
         FROM hexagons h, zone z
         WHERE ST_Intersects(h.geom, z.geom)
           AND NOT EXISTS (
             SELECT 1 FROM maps_hexagon_grid g WHERE ST_Intersects(g.geom, ST_Centroid(h.geom))
           )
       )
       INSERT INTO maps_hexagon_grid (id, geom, "left", "right", top, bottom)
       SELECT
         10000 + row_number() OVER (ORDER BY c, r),
         geom,
         ST_XMin(geom),
         ST_XMax(geom),
         ST_YMax(geom),
         ST_YMin(geom)
       FROM missing`,
    )
    .raw(`SELECT setval('maps_hexagon_grid_id_seq', (SELECT MAX(id) FROM maps_hexagon_grid))`)
    .refreshMaterializedView('approvedForms')
    .refreshMaterializedView('placesWithTaxonomies');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw(`DELETE FROM maps_hexagon_grid WHERE id > 10000`)
    .raw(`SELECT setval('maps_hexagon_grid_id_seq', (SELECT MAX(id) FROM maps_hexagon_grid))`)
    .refreshMaterializedView('approvedForms')
    .refreshMaterializedView('placesWithTaxonomies');
};
