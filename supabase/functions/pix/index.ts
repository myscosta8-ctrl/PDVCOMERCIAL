// Edge Function "pix": PIX dinâmico pela API Pix do banco da empresa.
// Ações (POST JSON): { acao: "testar" } | { acao: "cobrar", valor, caixa_id? } | { acao: "consultar", txid } | { acao: "cancelar", txid }
import { createClient } from "@supabase/supabase-js";
import { validarConfig, gerarTxid, corpoCobranca, brCodeDinamico, situacao, type ConfigPix } from "./pix.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
class ErroUsuario extends Error {}

const servico = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function usuarioDaRequisicao(req: Request) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data, error } = await servico.auth.getUser(token);
  if (error || !data.user) throw new ErroUsuario("Sessão inválida. Entre novamente.");
  const { data: u } = await servico.from("usuarios").select("id, empresa_id, papel, ativo").eq("id", data.user.id).maybeSingle();
  if (!u || !u.ativo) throw new ErroUsuario("Usuário sem empresa vinculada.");
  return u as { id: string; empresa_id: string; papel: string };
}

interface Banco { cfg: ConfigPix; client: Deno.HttpClient; token: string; empresa: Record<string, any> }

async function conectar(empresaId: string): Promise<Banco> {
  const { data: empresa } = await servico.from("empresas").select("*").eq("id", empresaId).single();
  let cfg: ConfigPix;
  try { cfg = validarConfig(empresa?.pix_dinamico); } catch (e) { throw new ErroUsuario((e as Error).message); }
  const { data: cred, error } = await servico.rpc("ler_credenciais_pix", { p_empresa: empresaId });
  if (error) throw error;
  if (!cred?.client_id || !cred?.client_secret) throw new ErroUsuario("Informe o client_id e o client_secret do banco em Configurações.");
  if (!cred?.cert || !cred?.chave) throw new ErroUsuario("Envie o certificado e a chave privada fornecidos pelo banco em Configurações.");
  // deno-lint-ignore no-explicit-any
  const client = (Deno as any).createHttpClient({ cert: cred.cert, key: cred.chave }) as Deno.HttpClient;
  let resp: Response;
  try {
    resp = await fetch(cfg.url_token, {
      method: "POST", client,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${cred.client_id}:${cred.client_secret}`) },
      body: "grant_type=client_credentials&scope=" + encodeURIComponent("cob.write cob.read pix.read"),
      signal: AbortSignal.timeout(20000),
    } as RequestInit);
  } catch (e) {
    client.close();
    throw new ErroUsuario(`O banco não respondeu à autenticação (${String(e).slice(0, 120)}). Confira o endereço e o certificado.`);
  }
  const texto = await resp.text();
  if (!resp.ok) { client.close(); throw new ErroUsuario(`O banco recusou a autenticação (HTTP ${resp.status}). Confira client_id, client_secret e certificado.`); }
  const token = JSON.parse(texto).access_token;
  if (!token) { client.close(); throw new ErroUsuario("O banco não devolveu o token de acesso."); }
  return { cfg, client, token, empresa };
}

async function chamar(b: Banco, metodo: string, caminho: string, corpo?: unknown) {
  let resp: Response;
  try {
    resp = await fetch(b.cfg.url_api + caminho, {
      method: metodo, client: b.client,
      headers: { Authorization: `Bearer ${b.token}`, "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(20000),
    } as RequestInit);
  } catch (e) {
    throw new ErroUsuario(`Sem resposta do banco (${String(e).slice(0, 120)}). Tente de novo.`);
  }
  const texto = await resp.text();
  let json: any = {};
  try { json = texto ? JSON.parse(texto) : {}; } catch { /* resposta sem JSON */ }
  if (!resp.ok) throw new ErroUsuario(`O banco recusou o pedido (HTTP ${resp.status}): ${json.detail ?? json.title ?? texto.slice(0, 160)}`);
  return json;
}

async function cobrar(u: { empresa_id: string }, valor: number, caixaId?: string) {
  const b = await conectar(u.empresa_id);
  try {
    const txid = gerarTxid();
    const cob = await chamar(b, "PUT", `/cob/${txid}`, corpoCobranca(Math.round(valor * 100) / 100, b.cfg.chave, b.cfg.expiracao!, b.empresa.nome_fantasia || b.empresa.razao_social));
    const copia = cob.pixCopiaECola ?? (cob.location ? brCodeDinamico(cob.location, b.empresa.pix_nome || b.empresa.nome_fantasia || b.empresa.razao_social, b.empresa.pix_cidade || b.empresa.endereco?.municipio) : null);
    if (!copia) throw new ErroUsuario("O banco criou a cobrança mas não devolveu o código para pagamento.");
    const { data, error } = await servico.from("pix_cobrancas").insert({
      empresa_id: u.empresa_id, caixa_id: caixaId ?? null, txid, valor: Math.round(valor * 100) / 100, copia_e_cola: copia,
      expira_em: new Date(Date.now() + b.cfg.expiracao! * 1000).toISOString(),
    }).select("txid, valor, status, copia_e_cola, expira_em").single();
    if (error) throw error;
    return data;
  } finally { b.client.close(); }
}

async function consultar(u: { empresa_id: string }, txid: string) {
  const { data: c } = await servico.from("pix_cobrancas").select("*").eq("empresa_id", u.empresa_id).eq("txid", txid).maybeSingle();
  if (!c) throw new ErroUsuario("Cobrança não encontrada.");
  if (c.status !== "ativa") return c;
  const b = await conectar(u.empresa_id);
  try {
    const cob = await chamar(b, "GET", `/cob/${txid}`);
    let novo = situacao(String(cob.status));
    if (novo === "ativa" && c.expira_em && new Date(c.expira_em).getTime() < Date.now()) novo = "expirada" as never;
    if (novo === c.status) return c;
    const pix = Array.isArray(cob.pix) ? cob.pix[0] : null;
    const { data } = await servico.from("pix_cobrancas").update({
      status: novo, e2eid: pix?.endToEndId ?? null, pago_em: novo === "concluida" ? (pix?.horario ?? new Date().toISOString()) : null,
    }).eq("id", c.id).select("*").single();
    return data;
  } finally { b.client.close(); }
}

async function cancelar(u: { empresa_id: string }, txid: string) {
  const { data: c } = await servico.from("pix_cobrancas").select("*").eq("empresa_id", u.empresa_id).eq("txid", txid).maybeSingle();
  if (!c) throw new ErroUsuario("Cobrança não encontrada.");
  if (c.status !== "ativa") return c;
  const b = await conectar(u.empresa_id);
  try {
    const cob = await chamar(b, "GET", `/cob/${txid}`);
    if (cob.status === "CONCLUIDA") return await consultar(u, txid);
    await chamar(b, "PATCH", `/cob/${txid}`, { status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" });
    const { data } = await servico.from("pix_cobrancas").update({ status: "cancelada" }).eq("id", c.id).select("*").single();
    return data;
  } finally { b.client.close(); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const u = await usuarioDaRequisicao(req);
    const corpo = await req.json().catch(() => ({}));
    if (corpo.acao === "testar") {
      if (u.papel !== "administrador") throw new ErroUsuario("Somente o administrador.");
      const b = await conectar(u.empresa_id);
      b.client.close();
      return resposta({ ok: true, mensagem: "Autenticação no banco funcionando." });
    }
    if (corpo.acao === "cobrar") {
      const valor = Number(corpo.valor);
      if (!(valor > 0) || valor > 1000000) throw new ErroUsuario("Valor da cobrança inválido.");
      return resposta(await cobrar(u, valor, corpo.caixa_id));
    }
    if (corpo.acao === "consultar") return resposta(await consultar(u, String(corpo.txid ?? "")));
    if (corpo.acao === "cancelar") return resposta(await cancelar(u, String(corpo.txid ?? "")));
    throw new ErroUsuario("Ação desconhecida.");
  } catch (e) {
    if (e instanceof Error) return resposta({ erro: e.message }, 400);
    return resposta({ erro: "Erro interno no PIX." }, 500);
  }
});
