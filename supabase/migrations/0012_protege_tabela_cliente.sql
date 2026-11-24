-- Operador também não altera a tabela de preço do cliente (daria desconto sem autorização)
create or replace function public.proteger_credito_cliente()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(public.auth_papel(), '') = 'operador' then
    if tg_op = 'INSERT' then
      new.limite_credito := 0; new.bloqueado := false; new.tabela_preco_id := null;
    elsif new.limite_credito is distinct from old.limite_credito or new.bloqueado is distinct from old.bloqueado
       or new.tabela_preco_id is distinct from old.tabela_preco_id then
      raise exception 'Somente gerente ou administrador altera limite de crédito, bloqueio e tabela de preço';
    end if;
  end if;
  return new;
end $$;
