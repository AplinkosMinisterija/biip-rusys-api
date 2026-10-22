# Classifier values are withdrawn, never deleted

`forms.settings.options` deliberately has no `remove` action: a form stores its sign and stage
by id **and**, for everything written before the 2026 model, by the derived code, so deleting
a value would blank the classifier on historical observations. A value is retired by setting
`active = false`, which drops it from every picker while it keeps naming what older forms
recorded (2026-10-22).

The cost is that a label, once used, cannot be used again. `rejectDuplicateName` checks even
soft-deleted rows, because the `approved_forms` view still joins legacy forms on
`group + name` with no deleted filter — reusing a code would make one form match two rows.
An administrator who wants a retired label back puts that value back into use rather than
creating a second one; the duplicate-label error says so.

## Considered options

- **Delete only what nothing references.** Safe in principle — a value no form and no criteria
  points at could go, freeing its label. Not built: it needs a guard across
  `forms.activity_id`, `forms.evolution_id`, the two legacy code columns and both criteria
  join tables, and it only helps the narrow case of a value created by mistake.
- **Delete, and keep labels by reading soft-deleted rows.** Would preserve historical labels —
  the `approved_forms` view already joins by id without a deleted filter. Rejected because it
  does not free the label: while any form still resolves through `forms.activity`, a reused
  code matches both the deleted row and the new one.

Revisit when every form carries classifier ids. The query that decides it:

```sql
SELECT count(*) FROM forms
WHERE (activity IS NOT NULL AND activity_id IS NULL)
   OR (evolution IS NOT NULL AND evolution_id IS NULL);
```

Zero means the legacy code join is dead and deletion becomes expressible.

## Two things that are easy to get wrong

- **A criteria draws only on the shared vocabulary** — the `form_settings_options` rows that
  carry no `form_type`. The older rows scoped to a single form type are all withdrawn and
  survive solely so historical forms keep their labels; five of them repeat a label the shared
  vocabulary also uses. Listing both sets together is what put duplicated labels on the
  administration screens once already.
- **The user-facing word is "nebenaudojama"**, in both portals. Not "archyvinė" or
  "neaktyvi" — this module already uses those for form, place and user states.
