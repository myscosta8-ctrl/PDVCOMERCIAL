-- Permite que o servidor (Edge Function, sem usuário logado) grave registros informando a empresa.
-- Usuários comuns continuam com a empresa forçada a partir do login.
create or replace function public.fixar_empresa()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null and coalesce(auth.jwt()->>'role', '') = 'service_role' and new.empresa_id is not null then
      return new;
    end if;
    new.empresa_id := public.auth_empresa_id();
    if new.empresa_id is null then
      raise exception 'Usuário sem empresa vinculada';
    end if;
  elsif new.empresa_id is distinct from old.empresa_id then
    raise exception 'Não é permitido alterar a empresa do registro';
  end if;
  return new;
end $$;
