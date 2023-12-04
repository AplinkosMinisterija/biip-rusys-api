/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw('DROP TRIGGER assign_place_code_trigger on places')
    .raw('DROP FUNCTION assign_place_code').raw(`
      CREATE OR REPLACE FUNCTION rusys_assign_place_code()
      RETURNS TRIGGER
      AS
      $$
      DECLARE
        species_name VARCHAR(255);
      BEGIN
        SELECT STRING_AGG(species_names_arr.text, '-') INTO species_name FROM (
          SELECT SUBSTRING(UNNEST(STRING_TO_ARRAY(UPPER(ts.name_latin), ' ')), 0, 4) AS text
          FROM taxonomy_species ts 
          WHERE ts.id=NEW.species_id
        ) AS species_names_arr;
          
        NEW.code := 'RAD-'||species_name||'-'||NEW.id;

        RETURN NEW;
      END;
      $$
      LANGUAGE plpgsql;
  `).raw(`
    CREATE OR REPLACE TRIGGER rusys_assign_place_code_trigger
    BEFORE INSERT ON places
    FOR EACH ROW
    EXECUTE FUNCTION rusys_assign_place_code();
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw('DROP TRIGGER rusys_assign_place_code_trigger')
    .raw('DROP FUNCTION rusys_assign_place_code').raw(`
    CREATE OR REPLACE FUNCTION assign_place_code()
    RETURNS TRIGGER
    AS
    $$
    DECLARE
      species_name VARCHAR(255);
    BEGIN
      SELECT STRING_AGG(species_names_arr.text, '-') INTO species_name FROM (
        SELECT SUBSTRING(UNNEST(STRING_TO_ARRAY(UPPER(ts.name_latin), ' ')), 0, 4) AS text
        FROM taxonomy_species ts 
        WHERE ts.id=NEW.species_id
      ) AS species_names_arr;
        
      NEW.code := 'RAD-'||species_name||'-'||NEW.id;

      RETURN NEW;
    END;
    $$
    LANGUAGE plpgsql;
`).raw(`
  CREATE OR REPLACE TRIGGER assign_place_code_trigger
  BEFORE INSERT ON places
  FOR EACH ROW
  EXECUTE FUNCTION assign_place_code();
`);
};
