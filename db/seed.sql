-- Local development only. Never run against the hosted project.
-- Creates the dev user that the local dev sign-in uses.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000001', 'dev@example.test')
on conflict do nothing;
