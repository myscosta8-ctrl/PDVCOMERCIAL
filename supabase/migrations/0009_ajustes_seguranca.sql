-- Ajustes apontados pela verificação de segurança do Supabase
alter function public.vencimento_convenio(smallint, smallint, date) set search_path = public;
-- Extensão usada só no diagnóstico inicial da NFC-e
drop extension if exists pg_net;
