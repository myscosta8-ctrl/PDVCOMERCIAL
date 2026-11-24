-- Operador pode cadastrar e editar clientes, mas não mexe em limite de crédito nem em bloqueio
create or replace function public.proteger_credito_cliente()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(public.auth_papel(), '') = 'operador' then
    if tg_op = 'INSERT' then
      new.limite_credito := 0; new.bloqueado := false;
    elsif new.limite_credito is distinct from old.limite_credito or new.bloqueado is distinct from old.bloqueado then
      raise exception 'Somente gerente ou administrador altera limite de crédito e bloqueio';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.proteger_credito_cliente() from public, anon, authenticated;
create trigger clientes_protege_credito before insert or update on public.clientes
  for each row execute function public.proteger_credito_cliente();
