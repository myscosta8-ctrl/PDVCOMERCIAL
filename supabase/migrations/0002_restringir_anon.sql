revoke execute on function public.auth_empresa_id(), public.auth_papel() from public, anon;
grant execute on function public.auth_empresa_id(), public.auth_papel() to authenticated;
revoke execute on function public.fixar_empresa(), public.aplicar_movimento_estoque() from public, anon, authenticated;
