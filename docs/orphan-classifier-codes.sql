-- Which classifier codes on forms resolve to no label?
--
-- Read-only. Mirrors exactly how `approved_forms` resolves each field, so a row here is a
-- form that really does show a blank classifier — not merely a code with no catalogue row.
-- Note the asymmetry: ACTIVITY matches on name alone, EVOLUTION and METHOD also require the
-- form type to match, so the same code can resolve for an animal and stay blank for a plant.
--
--   psql "<connection>" -f docs/orphan-classifier-codes.sql

\echo '== ACTIVITY: code on the form, no catalogue row (matched on name alone) =='
SELECT f.activity AS code, count(*) AS forms
FROM forms f
WHERE f.activity IS NOT NULL
  AND f.activity_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM form_settings_options o
    WHERE o.name = f.activity AND o."group" = 'ACTIVITY'
  )
GROUP BY 1 ORDER BY 2 DESC;

\echo '== EVOLUTION: no catalogue row for this code AND this form type =='
SELECT f.evolution AS code, t.form_type, count(*) AS forms
FROM forms f
JOIN taxonomies_all t ON t.species_id = f.species_id
WHERE f.evolution IS NOT NULL
  AND f.evolution_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM form_settings_options o
    WHERE o.name = f.evolution AND o."group" = 'EVOLUTION' AND o.form_type = t.form_type
  )
GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '== METHOD: same shape as EVOLUTION =='
SELECT f.method AS code, t.form_type, count(*) AS forms
FROM forms f
JOIN taxonomies_all t ON t.species_id = f.species_id
WHERE f.method IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM form_settings_options o
    WHERE o.name = f.method AND o."group" = 'METHOD' AND o.form_type = t.form_type
  )
GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '== NO_QUANTITY_REASON: matched on name alone =='
SELECT f.no_quantity_reason AS code, count(*) AS forms
FROM forms f
WHERE f.no_quantity_reason IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM form_settings_options o
    WHERE o.name = f.no_quantity_reason AND o."group" = 'NO_QUANTITY_REASON'
  )
GROUP BY 1 ORDER BY 2 DESC;

\echo '== An id that points at nothing (the id join has no deleted filter, so only a missing row breaks it) =='
SELECT 'activity_id' AS field, f.activity_id AS id, count(*) AS forms
FROM forms f
WHERE f.activity_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM form_settings_options o WHERE o.id = f.activity_id)
GROUP BY 1, 2
UNION ALL
SELECT 'evolution_id', f.evolution_id, count(*)
FROM forms f
WHERE f.evolution_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM form_settings_options o WHERE o.id = f.evolution_id)
GROUP BY 1, 2
ORDER BY 3 DESC;

\echo '== A criteria offering an option that no longer exists =='
SELECT 'sign' AS kind, s.criteria_id, s.option_id
FROM form_criteria_signs s
WHERE s.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM form_settings_options o WHERE o.id = s.option_id)
UNION ALL
SELECT 'stage', coalesce(st.criteria_id, cs.criteria_id), st.option_id
FROM form_criteria_sign_stages st
LEFT JOIN form_criteria_signs cs ON cs.id = st.criteria_sign_id
WHERE st.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM form_settings_options o WHERE o.id = st.option_id);
