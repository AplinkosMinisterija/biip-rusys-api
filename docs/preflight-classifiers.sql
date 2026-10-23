-- Pre-flight before releasing the classifier work to an environment.
--
-- Read-only. Every row says what it expects; anything that disagrees is worth looking at
-- before the deploy, because migrations run on container start here and a failing one
-- restart-loops the container.
--
--   psql "<connection>" -f docs/preflight-classifiers.sql

\pset format aligned
\echo ''
\echo '================ BLOCKERS — a mismatch here fails the boot ================'

SELECT * FROM (
  -- A migration row whose file no longer exists makes `migrate:latest` abort outright. An
  -- early revision of the stages work shipped a `createFormCriteriaStages` migration that was
  -- replaced; if this environment ever ran it, the deploy cannot start.
  SELECT 1 AS n,
         'stale migration row (createFormCriteriaStages)' AS check,
         count(*)::text AS actual,
         '0' AS expected
  FROM migrations WHERE name LIKE '%createFormCriteriaStages%'

  UNION ALL
  -- Same thing in general: any recorded migration whose file is gone.
  SELECT 2, 'migrations recorded, newest first', max(name), 'should match the newest file in database/migrations'
  FROM migrations

  UNION ALL
  -- The ALTER adds CHECK ((criteria_sign_id IS NOT NULL)::int + (criteria_id IS NOT NULL)::int = 1).
  -- Every existing row must satisfy it, i.e. none may have a null parent today.
  SELECT 3, 'stage rows with no parent (would fail the new CHECK)', count(*)::text, '0'
  FROM form_criteria_sign_stages WHERE criteria_sign_id IS NULL

  UNION ALL
  -- The leftover table from the replaced revision. Harmless if present, but it means this
  -- environment ran the old migration — see check 1.
  SELECT 4, 'leftover form_criteria_stages table', coalesce(to_regclass('form_criteria_stages')::text, 'none'), 'none'
) x ORDER BY n;

\echo ''
\echo '================ DATA — wrong here means the feature misbehaves, not that it fails ================'

SELECT * FROM (
  -- Nearest-node-wins is only deterministic while one node is scoped by one criteria. There is
  -- no database constraint for this, only the application check on write.
  SELECT 1 AS n, 'taxonomic nodes scoped by more than one criteria' AS check, count(*)::text AS actual, '0' AS expected
  FROM (
    SELECT kingdom_id, phylum_id, class_id, species_id
    FROM form_criteria_taxonomies WHERE deleted_at IS NULL
    GROUP BY 1,2,3,4 HAVING count(*) > 1
  ) d

  UNION ALL
  -- Two live rows with the same code in the shared vocabulary would make the legacy join
  -- ambiguous. A unique index covers it; this confirms the index is actually there.
  SELECT 2, 'duplicate (group, name) in the shared vocabulary', count(*)::text, '0'
  FROM (
    SELECT "group", name FROM form_settings_options
    WHERE deleted_at IS NULL AND form_type IS NULL
    GROUP BY 1,2 HAVING count(*) > 1
  ) d

  UNION ALL
  SELECT 3, 'criteria seeded', count(*)::text, '10 (the seeded groups)'
  FROM form_criteria WHERE deleted_at IS NULL

  UNION ALL
  SELECT 4, 'criteria offering neither signs nor stages', count(*)::text, '0'
  FROM form_criteria c
  WHERE c.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM form_criteria_signs s WHERE s.criteria_id = c.id AND s.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM form_criteria_sign_stages st WHERE st.criteria_id = c.id AND st.deleted_at IS NULL)

  UNION ALL
  SELECT 5, 'criteria scoped to no taxonomic node', count(*)::text, '0'
  FROM form_criteria c
  WHERE c.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM form_criteria_taxonomies t WHERE t.criteria_id = c.id AND t.deleted_at IS NULL)

  UNION ALL
  SELECT 6, 'shared vocabulary: ACTIVITY still in use', count(*)::text, 'about 28'
  FROM form_settings_options WHERE deleted_at IS NULL AND form_type IS NULL AND "group" = 'ACTIVITY' AND active

  UNION ALL
  SELECT 7, 'shared vocabulary: EVOLUTION still in use', count(*)::text, 'about 28'
  FROM form_settings_options WHERE deleted_at IS NULL AND form_type IS NULL AND "group" = 'EVOLUTION' AND active

  UNION ALL
  -- Test data from a previous session, if this environment was ever written to by hand.
  SELECT 8, 'vocabulary rows left by testing', count(*)::text, '0'
  FROM form_settings_options
  WHERE value ~ '^(RQ|TERM|KLAIDA|RECHECK|E2E|CHAIN|VERIFY|PROBE) '
) x ORDER BY n;

\echo ''
\echo '================ LABELS — how many forms still resolve through the legacy code ================'

SELECT
  count(*) FILTER (WHERE activity IS NOT NULL AND activity_id IS NULL) AS activity_on_code,
  count(*) FILTER (WHERE evolution IS NOT NULL AND evolution_id IS NULL) AS evolution_on_code,
  count(*) FILTER (WHERE activity_id IS NOT NULL OR evolution_id IS NOT NULL) AS already_on_ids,
  count(*) AS forms
FROM forms;

\echo '-- zero on the first two columns means the legacy join is dead and a code could be reused'
\echo '-- (see docs/adr/0001); until then run docs/orphan-classifier-codes.sql as well'
