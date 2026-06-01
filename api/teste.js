// api/teste.js
// GET /api/teste -> verifica a configuracao do Super Ajudante:
//  - variaveis de ambiente presentes
//  - conexao com o Supabase (le as tabelas)
//  - conexao com a Meu Danfe (valida Api-Key sem gastar credito)

import { readRows, readConfig, TABLES } from './_lib/db.js';
import { json, preflight } from './_lib/util.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  const resultado = { app: 'Super Ajudante', timestamp: new Date().toISOString(), checagens: {} };

  // 1) Variaveis de ambiente
  const envs = ['API_KEY_MEU_DANFE', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
  const faltando = envs.filter((e) => !process.env[e]);
  resultado.checagens.variaveis_ambiente = {
    ok: faltando.length === 0,
    presentes: envs.filter((e) => process.env[e]),
    faltando,
  };

  // 2) Supabase: le cada tabela e verifica acesso
  try {
    const tabelas = Object.keys(TABLES);
    const detalhe = {};
    for (const aba of tabelas) {
      try {
        const rows = await readRows(aba);
        detalhe[aba] = { ok: true, linhas: rows.length };
      } catch (e) {
        detalhe[aba] = { ok: false, erro: e.message };
      }
    }
    const cfg = await readConfig();
    resultado.checagens.supabase = {
      ok: Object.values(detalhe).every((d) => d.ok),
      tabelas: detalhe,
      configuracoes_lidas: Object.keys(cfg),
      cnpj_restaurante_definido: !!(cfg.CNPJ_RESTAURANTE && String(cfg.CNPJ_RESTAURANTE).replace(/\D/g, '').length === 14),
    };
  } catch (e) {
    resultado.checagens.supabase = { ok: false, erro: e.message };
  }

  // 3) Meu Danfe: valida a Api-Key sem gastar credito.
  try {
    const base = process.env.BASE_URL_API || 'https://api.meudanfe.com.br/v2';
    const r = await fetch(`${base}/fd/add/0`, {
      method: 'PUT',
      headers: { 'Api-Key': process.env.API_KEY_MEU_DANFE || '', 'Accept': 'application/json' },
    });
    let diag;
    if (r.status === 401) diag = { ok: false, motivo: 'Api-Key nao informada ou invalida (401).' };
    else if (r.status === 403) diag = { ok: false, motivo: 'Api-Key foi substituida (403). Gere uma nova.' };
    else if (r.status === 400) diag = { ok: true, motivo: 'Api-Key aceita (retornou 400 para chave invalida, como esperado).' };
    else if (r.status === 402) diag = { ok: true, motivo: 'Api-Key valida, porem saldo insuficiente (402).' };
    else diag = { ok: true, motivo: `Conexao estabelecida (HTTP ${r.status}).` };
    resultado.checagens.meu_danfe = { http: r.status, ...diag };
  } catch (e) {
    resultado.checagens.meu_danfe = { ok: false, erro: e.message };
  }

  // 4) Teste real opcional (gasta R$ 0,03 se a nota nao estiver na conta)
  const chave = (req.query?.chave) || new URL(req.url, 'http://x').searchParams.get('chave');
  if (chave && /^\d{44}$/.test(chave.replace(/\D/g, ''))) {
    try {
      const { addNfe } = await import('./_lib/meudanfe.js');
      const r = await addNfe(chave.replace(/\D/g, ''));
      resultado.checagens.busca_real = { ok: !r.fatal, status: r.status, mensagem: r.statusMessage };
    } catch (e) {
      resultado.checagens.busca_real = { ok: false, erro: e.message };
    }
  }

  resultado.tudo_ok = Object.values(resultado.checagens).every((c) => c.ok !== false);
  return json(res, 200, resultado);
}
