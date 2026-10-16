-- Run against Cortex as postgres. No row content is returned and all tests roll back.
-- Writes are EXPLAIN-only; this does not test persisted ingest or hosted credentials.
begin;
set local statement_timeout='15s';
do $probe$
declare
  who text;
  rel text;
  stmt text;
  action text;
  old_role text := current_user;
  blocked boolean;
begin
  foreach who in array array['anon','authenticated'] loop
    perform set_config('role',who,true);
    foreach rel in array array['records','messages','api_tokens','observations','distillates','cortex_calendar_structure'] loop
      blocked := false;
      begin
        execute format('select 1 from public.%I limit 0',rel);
      exception when insufficient_privilege then blocked := true;
      end;
      if not blocked then raise exception '% unexpectedly read %',who,rel; end if;
    end loop;
    foreach action in array array['INSERT','UPDATE','DELETE'] loop
      stmt := case action
        when 'INSERT' then 'explain insert into public.records default values'
        when 'UPDATE' then 'explain update public.records set id=id where false'
        when 'DELETE' then 'explain delete from public.records where false'
      end;
      blocked := false;
      begin execute stmt; exception when insufficient_privilege then blocked := true; end;
      if not blocked then raise exception '% unexpectedly planned %',who,action; end if;
    end loop;
    blocked := false;
    begin perform 1 from public.cortex_search_memory(p_query=>'__acl_probe_no_match__',p_limit=>1) limit 0;
    exception when insufficient_privilege then blocked := true; end;
    if not blocked then raise exception '% unexpectedly executed memory RPC',who; end if;
    perform set_config('role',old_role,true);
  end loop;
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('role','service_role',true);
  perform 1 from public.records limit 1;
  execute 'explain insert into public.records default values';
  execute 'explain update public.records set id=id where false';
  execute 'explain delete from public.records where false';
  perform 1 from public.cortex_search_records(p_query=>'__acl_probe_no_match__',p_limit=>1);
  perform 1 from public.cortex_search_memory(p_query=>'__acl_probe_no_match__',p_limit=>1);
  perform set_config('role',old_role,true);
  perform set_config('request.jwt.claim.role','cortex_mirror',true);
  perform set_config('request.jwt.claims','{"role":"cortex_mirror"}',true);
  perform set_config('role','cortex_mirror',true);
  perform 1 from public.distillates limit 1;
  perform 1 from public.cortex_calendar_structure limit 1;
  execute 'explain insert into public.distillates default values';
  execute 'explain update public.distillates set id=id where false';
  perform 1 from public.cortex_search_memory(p_query=>'__acl_probe_no_match__',p_limit=>1);
  if exists(select 1 from public.cortex_search_memory(p_query=>'a',p_limit=>10) where kind='record') then
    raise exception 'Mirror received raw records from memory RPC';
  end if;
  blocked := false;
  begin perform 1 from public.records limit 0;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Mirror unexpectedly read raw records'; end if;
  blocked := false;
  begin perform 1 from public.cortex_search_records(p_query=>'__acl_probe_no_match__',p_limit=>1) limit 0;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Mirror unexpectedly executed raw record RPC'; end if;
  perform set_config('role',old_role,true);
end
$probe$;
do $defaults$
begin
  if exists (
    select 1
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','job_search')
      and c.relkind in ('r','p') and not c.relrowsecurity
  ) then raise exception 'Application table without RLS'; end if;

  if exists (
    select 1
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join (values ('anon'),('authenticated')) roles(name)
    where n.nspname in ('public','job_search') and c.relkind in ('r','p','v','m')
      and has_table_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
  ) then raise exception 'Unexpected public-role table grants'; end if;

  if exists (
    select 1 from aclexplode(coalesce(
      (select defaclacl from pg_default_acl
       where defaclrole='postgres'::regrole and defaclnamespace=0 and defaclobjtype='f'),
      acldefault('f','postgres'::regrole)
    )) a
    where a.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid)
      and a.privilege_type='EXECUTE'
  ) then raise exception 'Future postgres functions inherit public EXECUTE'; end if;

  if exists (
    select 1 from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole
      and (d.defaclnamespace=0 or d.defaclnamespace='public'::regnamespace)
      and d.defaclobjtype in ('r','S','f')
      and a.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid)
  ) then raise exception 'Unexpected public-role default grants'; end if;
end
$defaults$;

select 'PASS: default ACLs, RLS; anon/authenticated read/write/RPC denied; service-role read/write planning and both RPCs allowed; Mirror derived read/write planning and memory RPC allowed; raw tables/RPC denied' as live_role_tests;
rollback;