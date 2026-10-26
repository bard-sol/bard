-- Exact row count of every table in the schemas that hold Bard's data.
-- Output: one "schema.table|rows" line per table, sorted.
-- Used on the live database (inside the dump's snapshot) and on the restored
-- copy; the two lists must be identical.
select format('%I.%I', n.nspname, c.relname)
       || '|'
       || (xpath('/row/c/text()',
                 query_to_xml(format('select count(*) as c from only %I.%I',
                                     n.nspname, c.relname),
                              false, true, '')))[1]::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname in ('public', 'auth', 'storage', 'supabase_migrations',
                    'realtime', 'vault')
order by 1;
