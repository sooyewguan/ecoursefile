-- Auditor verdicts. An auditor marks any section of any course file Verified or Needs fix, with a
-- comment, which Needs fix requires. Switched-off sections can be marked too. Each verdict is
-- logged.
--
-- A section's status is its latest verdict while the section is as the auditor judged it: the same
-- files, and on or off as it was. A verdict keeps what section_contents returned for the section
-- when it was given, and section_statuses compares that with what section_contents returns now. So
-- every way that files enter or leave a section returns it to Pending review: an upload, a delete
-- or a reuse, a shared file uploaded or deleted, a lecturer assigned or unassigned, and a program
-- code ticked or unticked. A change that a later migration adds is covered too, as long as the
-- section's files are read through section_contents. A change time that every writer must update
-- would miss any writer that forgets it.

create type public.verdict as enum ('verified', 'needs_fix');

-- Every verdict ever given. The latest for a section counts. file_ids and section_on are the
-- section's content when the verdict was given, as section_contents returns it. A comment has no
-- outer blanks, and Needs fix always has one.
create table public.section_verdicts (
  id bigint generated always as identity primary key,
  offering_id uuid not null references public.offerings (id) on delete restrict,
  section smallint not null check (section between 1 and 19),
  verdict public.verdict not null,
  comment text check (comment ~ '\S'),
  auditor_id uuid not null references public.profiles (id) on delete restrict,
  file_ids uuid[] not null,
  section_on boolean not null,
  created_at timestamptz not null default now(),
  constraint section_verdicts_needs_fix_comment_check check (verdict <> 'needs_fix' or comment is not null)
);

create index section_verdicts_offering_id_section_idx on public.section_verdicts (offering_id, section, id);

-- A verdict is logged with its comment. Its row of section 5 names no program code, unlike the rows
-- of the student timetables' uploads, deletes, ticks and unticks.
alter table public.activity_log
  add column comment text,
  drop constraint activity_log_program_code_check,
  add constraint activity_log_program_code_check check (
    (program_code_id is not null) = (section = 5 and action not in ('verified', 'needs_fix'))
  ),
  add constraint activity_log_comment_check check (
    case action
      when 'needs_fix' then comment is not null
      when 'verified' then true
      else comment is null
    end
  );

-- What an auditor judges in each of the 19 sections of the offering's course file, in section
-- order: whether the section is on, and the ids of its files, sorted. A section's files are its own
-- and the shared files that the course file links into it.
create function public.section_contents(public.offerings)
returns table (section smallint, is_on boolean, file_ids uuid[])
language sql
stable
set search_path = ''
as $$
  select
    g.section::smallint,
    g.section not between 10 and 16 or g.section = any ($1.sections_on),
    coalesce(f.ids, '{}')
  from generate_series(1, 19) as g (section)
  left join (
    select f.section, array_agg(f.id order by f.id) as ids
    from (
      select f.id, f.section from public.files f where f.offering_id = $1.id
      union all
      select f.id, f.section from public.linked_files($1) f
    ) as f
    group by f.section
  ) as f on f.section = g.section
  order by g.section
$$;

-- The status of each of the 19 sections of the offering's course file, in section order, and
-- whether the section counts toward the course file's completeness.
--
-- - missing: the section is on and has no files, except sections 7 to 9, which may stay empty.
--   Section 4 is also missing while any lecturer of the offering has no timetable, and section 5
--   while any ticked program code has none. A verdict does not change it.
-- - verified or needs_fix: the latest verdict, while section_contents still returns what it did
--   when the verdict was given.
-- - off: a switchable section (10 to 16) that the offering has off, with no verdict or a section
--   changed since.
-- - pending_review: a section with files, with no verdict or a section changed since.
-- - empty: sections 7 to 9 with no files, with no verdict or a section changed since.
--
-- Every section counts except a switched-off one, which counts while its status is needs_fix. A
-- caller who may not read the offering gets no rows.
create or replace function public.section_statuses(offering_id uuid)
returns table (section smallint, status public.section_status, counts_toward_completeness boolean)
language sql
stable
set search_path = ''
as $$
  select s.section, s.status, s.is_on or s.status = 'needs_fix'
  from (
    select
      c.section,
      c.is_on,
      case
        when c.is_on and (
          (c.file_ids = '{}' and c.section not between 7 and 9)
          or (c.section = 4 and exists (
            select 1
            from public.offering_lecturers l
            where l.offering_id = o.id
              and not exists (select 1 from public.linked_files(o) f where f.lecturer_id = l.lecturer_id)
          ))
          or (c.section = 5 and exists (
            select 1
            from public.offering_program_codes t
            where t.offering_id = o.id
              and not exists (select 1 from public.linked_files(o) f where f.program_code_id = t.program_code_id)
          ))
        ) then 'missing'
        when (v.file_ids, v.section_on) = (c.file_ids, c.is_on) then v.verdict::text
        when not c.is_on then 'off'
        when c.file_ids <> '{}' then 'pending_review'
        else 'empty'
      end::public.section_status as status
    from public.offerings o
    cross join lateral public.section_contents(o) c
    left join lateral (
      select v.verdict, v.file_ids, v.section_on
      from public.section_verdicts v
      where v.offering_id = o.id and v.section = c.section
      order by v.id desc
      limit 1
    ) as v on true
    where o.id = section_statuses.offering_id
  ) as s
  order by s.section
$$;

-- Records the caller's verdict on a section of the offering's course file, with the section's
-- content as it is now, and logs it. The caller must be an auditor. Every section can be marked, a
-- switched-off one too. Needs fix needs a comment that is not blank. A comment is stored without
-- its outer blanks, and a blank comment on Verified as none.
create function public.record_verdict(offering_id uuid, section smallint, verdict public.verdict, comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.offerings;
  stored_comment text := nullif(regexp_replace(record_verdict.comment, '^\s+|\s+$', '', 'g'), '');
begin
  select * into target from public.offerings o where o.id = record_verdict.offering_id;
  if not found
    or not (select public.jwt_roles()) @> '{auditor}'
    or record_verdict.section not between 1 and 19
  then
    raise exception 'Only auditors may record verdicts on course file sections.' using errcode = '42501';
  end if;
  if record_verdict.verdict is null then
    raise exception 'Say whether the section is verified or needs fixing.' using errcode = '22004';
  end if;
  if record_verdict.verdict = 'needs_fix' and stored_comment is null then
    raise exception 'Say what needs fixing.' using errcode = '23514';
  end if;

  insert into public.section_verdicts (offering_id, section, verdict, comment, auditor_id, file_ids, section_on)
  select target.id, c.section, record_verdict.verdict, stored_comment, (select auth.uid()), c.file_ids, c.is_on
  from public.section_contents(target) c
  where c.section = record_verdict.section;

  insert into public.activity_log (offering_id, section, action, actor_id, comment)
  values (
    target.id,
    record_verdict.section,
    record_verdict.verdict::text::public.activity_action,
    (select auth.uid()),
    stored_comment
  );
end;
$$;

-- The auditor's name, for everyone who reads the verdict. Lecturers cannot read other profiles.
create function public.auditor_name(public.section_verdicts)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name from public.profiles p where p.id = $1.auditor_id
$$;

revoke execute on function public.section_contents, public.record_verdict, public.auditor_name from anon, public;

alter table public.section_verdicts enable row level security;

-- With no write policies, clients add verdicts only through record_verdict. Verdicts are never
-- changed or removed, not even by the service role.
create policy "Readers of an offering read its verdicts" on public.section_verdicts
  for select to authenticated using (public.can_read_offering(offering_id));

revoke update, delete, truncate on public.section_verdicts from anon, authenticated, service_role;
