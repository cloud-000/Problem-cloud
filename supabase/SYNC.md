AI agents never execute,
See AoPs-Scrape/cli/SYNC.md

to below, Not sure if this is true, only take in account if errors are happening

## Gotcha: pgdelta drops view/table grants on recreation

When the declarative-schema diff (pgdelta) detects **any** change to a view body, it
emits `DROP VIEW` + `CREATE VIEW` — it **never** uses `CREATE OR REPLACE VIEW`. Dropping
the view drops its grants, and pgdelta does **not** re-emit an otherwise-unchanged
`grant` after the drop. Reordering columns to make the change "append-only" does **not**
avoid this (verified 2026-07-12 on `user_problem_index`).

The symptom is `permission denied for view ...` / **403 Forbidden** for `authenticated`,
even though the grant is present in an earlier migration and in the schema source of
truth — because a **later** regenerated migration silently dropped it. This bit
`user_problem_index` during the dedup work: `mastery_engagement` created the view + grant,
then the regenerated `deduplication` migration `DROP`+`CREATE`d the view and left it with
only `postgres` able to select.

**Takeaway:** any time you regenerate a migration that touches a view (or table) that had
grants, grep the generated `.sql` for the `CREATE VIEW` / `CREATE TABLE` and **manually
append the matching `GRANT` statements** (mirror the grants in `supabase/schemas/*.sql`).
pgdelta will never do it for you. Then verify:

```sql
select grantee from information_schema.role_table_grants
where table_name = '<view>' and privilege_type = 'SELECT';
-- must include: authenticated
```
