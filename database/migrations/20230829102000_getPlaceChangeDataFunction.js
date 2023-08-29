/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.raw(
    `CREATE OR REPLACE FUNCTION rusys_get_place_change_data( 
      p_id integer
    ) 
    RETURNS table(
      status varchar(255),
      form_ids int[],
      quantity numeric,
      geom geometry,
      area_change_percentage numeric,
      quantity_change_percentage numeric
    )
    AS
    $$
    DECLARE
    place_history place_histories%ROWTYPE;
    status varchar(255) = 'INITIAL';
    geom geometry;
    area numeric;
    quantity numeric;
    form_ids int[];
    area_status varchar(255) = 'STABLE';
    quantity_status varchar(255) = 'STABLE';
    area_change_percentage numeric;
    quantity_change_percentage numeric;
    BEGIN
      EXECUTE 'SELECT * FROM place_histories WHERE place_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1;'
      INTO place_history 
      USING p_id;
    
      SELECT place_data.geom, place_data.quantity, place_data.form_ids, ST_Area(place_data.geom) INTO STRICT geom, quantity, form_ids, area FROM rusys_get_place_data_from_relevant_forms(p_id) as place_data;
    
      IF place_history.id IS NOT NULL THEN
        IF quantity > 0 THEN quantity_change_percentage := (quantity - place_history.quantity) / quantity * 100;
        ELSE quantity_change_percentage := 0;
        END IF;

        IF area > 0 THEN area_change_percentage := (area - ST_Area(place_history.geom)) / area * 100;
        ELSE area_change_percentage := 0;
        END IF;

        IF area_change_percentage > 5 THEN area_status := 'INCREASED';
        ELSIF area_change_percentage < -5 THEN area_status := 'DECREASED';
        END IF;
    
        IF quantity_change_percentage > 5 THEN quantity_status := 'INCREASED';
        ELSIF quantity_change_percentage < -5 THEN quantity_status := 'DECREASED';
        END IF;
    
        IF area_status = 'STABLE' THEN status := quantity_status;
        ELSIF area_status = 'DECREASED' THEN status := 'DECREASED';
        ELSIF area_status = 'INCREASED' AND quantity_status IN ('INCREASED', 'STABLE') THEN status := 'INCREASED';
        ELSIF area_status = 'INCREASED' AND quantity_status = 'DECREASED' THEN status := 'DECREASED';
        ELSE status := 'STABLE';
        END IF;
      END IF;
    
      RETURN query select status, form_ids, quantity, geom, area_change_percentage, quantity_change_percentage;
    END;
    $$
    LANGUAGE plpgsql;`
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(
    `CREATE OR REPLACE FUNCTION rusys_get_place_change_data( 
      p_id integer
    ) 
    RETURNS table(
      status varchar(255),
      form_ids int[],
      quantity numeric,
      geom geometry,
      area_change_percentage numeric,
      quantity_change_percentage numeric
    )
    AS
    $$
    DECLARE
    place_history place_histories%ROWTYPE;
    status varchar(255) = 'INITIAL';
    geom geometry;
    quantity numeric;
    form_ids int[];
    area_status varchar(255) = 'STABLE';
    quantity_status varchar(255) = 'STABLE';
    area_change_percentage numeric;
    quantity_change_percentage numeric;
    BEGIN
      EXECUTE 'SELECT * FROM place_histories WHERE place_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1;'
      INTO place_history 
      USING p_id;
    
      SELECT place_data.geom, place_data.quantity, place_data.form_ids INTO STRICT geom, quantity, form_ids FROM rusys_get_place_data_from_relevant_forms(p_id) as place_data;
    
      IF place_history.id IS NOT NULL THEN
        area_change_percentage := (ST_Area(geom) - ST_Area(place_history.geom)) / ST_Area(geom) * 100;
        quantity_change_percentage := (quantity - place_history.quantity) / quantity * 100;
        
        IF area_change_percentage > 5 THEN area_status := 'INCREASED';
        ELSIF area_change_percentage < -5 THEN area_status := 'DECREASED';
        END IF;
    
        IF quantity_change_percentage > 5 THEN quantity_status := 'INCREASED';
        ELSIF quantity_change_percentage < -5 THEN quantity_status := 'DECREASED';
        END IF;
    
        IF area_status = 'STABLE' THEN status := quantity_status;
        ELSIF area_status = 'DECREASED' THEN status := 'DECREASED';
        ELSIF area_status = 'INCREASED' AND quantity_status IN ('INCREASED', 'STABLE') THEN status := 'INCREASED';
        ELSIF area_status = 'INCREASED' AND quantity_status = 'DECREASED' THEN status := 'DECREASED';
        ELSE status := 'STABLE';
        END IF;
      END IF;
    
      RETURN query select status, form_ids, quantity, geom, area_change_percentage, quantity_change_percentage;
    END;
    $$
    LANGUAGE plpgsql;`
  );
};
