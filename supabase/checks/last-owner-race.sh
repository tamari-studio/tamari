#!/usr/bin/env bash
# Two owners demote each other at the same moment (20261116000000_last_owner_lock): the first
# commits, the second waits on the lock, sees no other owner left, and is refused. Leaves two test
# accounts behind, so run it on a throwaway database (CI's). DB defaults to the local Supabase.
#
#   bash supabase/checks/last-owner-race.sh
set -euo pipefail
DB=${DB:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
A=00000000-0000-0000-0000-00000000aa01
B=00000000-0000-0000-0000-00000000aa02
sql() { psql "$DB" -v ON_ERROR_STOP=1 -qtA "$@"; }

# Two active owners. On an empty database the first account becomes the owner by itself.
sql -c "insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('$A', 'race-a@owner.test', now(), 'authenticated', 'authenticated', '{}'),
  ('$B', 'race-b@owner.test', now(), 'authenticated', 'authenticated', '{}')"
sql -c "begin; set local app.actor_id = '$A'; update app.app_user set tier = 'owner', status = 'active' where user_id in ('$A', '$B'); commit;"

# A demotes B and holds the transaction open; B demotes A meanwhile.
sql -c "begin; set local app.actor_id = '$A'; update app.app_user set tier = 'admin' where user_id = '$B'; select pg_sleep(3); commit;" > first.log 2>&1 &
first=$!
sleep 1
if sql -c "begin; set local app.actor_id = '$B'; update app.app_user set tier = 'admin' where user_id = '$A'; commit;" > second.log 2>&1; then
  echo "FAIL: the second demotion went through"; cat second.log; exit 1
fi
wait "$first" || { echo "FAIL: the first demotion failed"; cat first.log; exit 1; }
grep -q 'last-owner invariant' second.log || { echo "FAIL: the second was refused for another reason"; cat second.log; exit 1; }
owners=$(sql -c "select count(*) from app.app_user where tier = 'owner' and status = 'active' and user_id in ('$A', '$B')")
[ "$owners" = 1 ] || { echo "FAIL: $owners active owners left"; exit 1; }
echo "ok   two owners demoting each other at once leave one owner"
