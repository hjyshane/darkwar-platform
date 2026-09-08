#!/usr/bin/env bash
# Run the pgTAP suite without Docker.
#
# WHY THIS EXISTS. `supabase test db` needs the whole local stack, the Windows
# machine this project is developed on has no Docker, and the consequence was
# that the suite went unrun for weeks while ten files rotted — every one of
# them a test that had stopped matching the code, and none of them noticed
# because CI's db job was red for so long that red stopped meaning anything.
#
# WHAT IT DOES. Creates a throwaway cluster, lays down `supabase-stub.sql` for
# the pieces Supabase provides before migration 0001, applies every migration
# in order, loads the seed, then runs every file in supabase/tests.
#
# pg_net and pg_cron are the only extensions not installed. Both are used
# exclusively inside plpgsql bodies that nothing in the suite executes, so the
# two `create extension` lines are skipped and the rest is untouched.
#
# KNOWN DISAGREEMENTS WITH CI, as of 2026-09-08. These fail here and pass
# there, and they are this harness's fault rather than the schema's:
#
#   02, 12, 15, 16, 35   auth.users lacks raw_app_meta_data
#   49                   storage.objects grants differ
#   30, 67-70            `authenticated` default privileges are approximated
#
# Anything else failing is worth believing.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work=${WORK:-/tmp/dw-pgtap}
bin=${PGBIN:-/usr/lib/postgresql/16/bin}
export PATH="$bin:$PATH"

# initdb refuses to run as root, and this needs a writable directory the
# postgres user owns.
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else bash -c "$1"; fi; }

rm -rf "$work"; mkdir -p "$work/stage"
if [ "$(id -u)" = 0 ]; then chown -R postgres:postgres "$work"; fi

cp "$repo"/supabase/migrations/*.sql "$repo"/supabase/tests/*.sql \
   "$repo"/supabase/seed.sql "$repo"/scripts/pgtap/supabase-stub.sql "$work/stage/"
# The two extensions that are not installed. Their call sites are all inside
# plpgsql bodies, which are not parsed until they run.
sed -i 's/^create extension if not exists pg_net.*$/-- [harness] pg_net not installed/;
        s/^create extension if not exists pg_cron;$/-- [harness] pg_cron stubbed in supabase-stub.sql/' \
    "$work"/stage/*_the_database_can_raise_the_alarm.sql
chmod -R a+rX "$work"

psql_opts="PGOPTIONS='-c search_path=public,extensions' psql -h $work -U postgres"
as_pg "$bin/initdb -D $work/data -U postgres -A trust" >/dev/null
as_pg "$bin/pg_ctl -D $work/data -o \"-k $work -h ''\" -l $work/pg.log start" >/dev/null
trap 'as_pg "$bin/pg_ctl -D $work/data stop" >/dev/null 2>&1 || true' EXIT
sleep 2

as_pg "$psql_opts -c 'create database dw'" >/dev/null
apply() { as_pg "$psql_opts -d dw -v ON_ERROR_STOP=1 -q -f $1" >>"$work/apply.log" 2>&1; }

apply "$work/stage/supabase-stub.sql"
for f in "$work"/stage/2026*.sql; do
  apply "$f" || { echo "migration failed: $(basename "$f")"; tail -20 "$work/apply.log"; exit 1; }
done
apply "$work/stage/seed.sql"
echo "schema applied — $(ls "$work"/stage/2026*.sql | wc -l) migrations"

failed=0
for f in $(ls "$work"/stage/[0-9][0-9]_*.sql | sort); do
  out=$(as_pg "$psql_opts -d dw -q -f $f" 2>&1 | grep -E '^ *not ok|^psql.*ERROR|Looks like' || true)
  if [ -n "$out" ]; then
    failed=$((failed + 1)); printf '\n── %s\n%s\n' "$(basename "$f" .sql)" "$out"
  fi
done
printf '\nfiles with failures: %s\n' "$failed"
[ "$failed" = 0 ]
