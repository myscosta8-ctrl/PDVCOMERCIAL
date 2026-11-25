// Edge Function "resumo": resumo do mês para gerente e administrador.
// Com o segredo ANTHROPIC_API_KEY configurado, o texto é escrito pela IA; sem ele, por regras fixas.
import { createClient } from "@supabase/supabase-js";
import { textoPorRegras, pedidoIA, type Indicadores } from "./resumo.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MODELO = "claude-haiku-5-5";

async function escreverComIA(chave: string, ind: Indicadores): Promise<string[] | null> {
  const { system, mensagem } = pedidoIA(ind);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELO, max_tokens: 700, system, messages: [{ role: "user", content: mensagem }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) { console.error("IA respondeu", resp.status, (await resp.text()).slice(0, 300)); return null; }
    const json = await resp.json();
    const texto = (json.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n").trim();
    const paragrafos = texto.split(/\n\s*\n|\n/).map((s: string) => s.trim()).filter(Boolean);
    return paragrafos.length ? paragrafos : null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = req.headers.get("Authorization") ?? "";
    // Consulta com a sessão do próprio usuário: valem as regras de acesso do banco
    const cliente = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false }, global: { headers: { Authorization: token } },
    });
    const { data: ind, error } = await cliente.rpc("indicadores_mes");
    if (error) return resposta({ erro: error.message }, 400);
    const chave = Deno.env.get("ANTHROPIC_API_KEY");
    const ia = chave ? await escreverComIA(chave, ind as Indicadores) : null;
    return resposta({
      paragrafos: ia ?? textoPorRegras(ind as Indicadores),
      fonte: ia ? "ia" : "regras",
      aviso: chave && !ia ? "A IA não respondeu agora; este resumo foi montado pelas regras do sistema." : null,
      gerado_em: new Date().toISOString(),
    });
  } catch (e) {
    console.error(e);
    return resposta({ erro: "Não foi possível gerar o resumo agora." }, 500);
  }
});
