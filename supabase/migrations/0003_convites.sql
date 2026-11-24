-- Convites: ao criar o login (Authentication) com um e-mail convidado, o usuário é vinculado automaticamente à empresa.
create table public.convites (
  email       text primary key,
  empresa_id  uuid not null references public.empresas(id),
  nome        text not null,
  papel       text not null default 'operador' check (papel in ('administrador','gerente','operador')),
  criado_em   timestamptz not null default now(),
  usado_em    timestamptz
);
alter table public.convites enable row level security;
create policy convites_admin on public.convites for all
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() = 'administrador')
  with check (empresa_id = public.auth_empresa_id() and public.auth_papel() = 'administrador');

create or replace function public.vincular_convite()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.convites;
begin
  select * into c from public.convites where lower(email) = lower(new.email) and usado_em is null;
  if found then
    insert into public.usuarios(id, empresa_id, nome, email, papel)
    values (new.id, c.empresa_id, c.nome, new.email, c.papel)
    on conflict (id) do nothing;
    update public.convites set usado_em = now() where email = c.email;
  end if;
  return new;
end $$;
revoke execute on function public.vincular_convite() from public, anon, authenticated;

create trigger vincular_convite after insert on auth.users
  for each row execute function public.vincular_convite();

-- Os cadastros de empresas e convites iniciais são feitos direto no banco (não ficam no repositório).
