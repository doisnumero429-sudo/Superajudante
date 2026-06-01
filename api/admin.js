// api/admin.js
// Endpoint unico para recursos administrativos (economiza Serverless Functions
// no plano Hobby da Vercel, que limita a 12). O recurso vem em ?recurso=...
//   recurso=categorias  GET lista | POST { acao: criar|renomear|ativar|desativar }
//   recurso=config      GET lista | POST { chave, valor }
//   recurso=ia          POST { itens } -> sugestoes de produtos novos (Gemini)

import { readRows, appendRow, updateRow, nextId } from './_lib/db.js';
import { sugerirProdutos, temIA } from './_lib/ia.js';
import { json, preflight, readBody } from './_lib/util.js';

const CONFIG_EDITAVEL = {
  CNPJ_RESTAURANTE: 'CNPJ do restaurante (valida o destinatario das notas)',
  MAX_TENTATIVAS_NFE: 'Maximo de tentativas por chave NF-e',
  INTERVALO_TENTATIVAS_MS: 'Intervalo minimo entre tentativas por chave (ms)',
  LIMITE_CONSULTAS_SEGUNDO: 'Maximo de consultas por segundo a API Meu Danfe',
};

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const recurso = (req.query?.recurso) || new URL(req.url, 'http://x').searchParams.get('recurso');

  try {
    if (recurso === 'categorias') return await categorias(req, res);
    if (recurso === 'config') return await config(req, res);
    if (recurso === 'ia') return await ia(req, res);
    return json(res, 400, { erro: 'Recurso invalido. Use ?recurso=categorias|config|ia.' });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}

// ---------- CATEGORIAS ----------
async function categorias(req, res) {
  if (req.method === 'GET') {
    const rows = await readRows('Categorias');
    return json(res, 200, { rows });
  }
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  const b = await readBody(req);
  const acao = b.acao || 'criar';
  const cats = await readRows('Categorias');

  if (acao === 'criar') {
    const nome = String(b.nome_categoria || '').trim();
    if (!nome) return json(res, 400, { erro: 'Informe o nome da categoria.' });
    const existe = cats.find((c) =>
      String(c.nome_categoria || '').trim().toLowerCase() === nome.toLowerCase()
      && String(c.ativo || 'SIM').toUpperCase() === 'SIM');
    if (existe) return json(res, 200, { ok: true, id_categoria: existe.id_categoria, nome_categoria: existe.nome_categoria, ja_existia: true });
    const id = await nextId('Categorias', 'id_categoria', 'CAT');
    await appendRow('Categorias', { id_categoria: id, nome_categoria: nome, descricao: b.descricao || '', ativo: 'SIM' });
    return json(res, 200, { ok: true, id_categoria: id, nome_categoria: nome });
  }

  const c = cats.find((x) => x.id_categoria === b.id_categoria);
  if (!c) return json(res, 404, { erro: 'Categoria nao encontrada.' });

  if (acao === 'renomear') {
    const nome = String(b.nome_categoria || '').trim();
    if (!nome) return json(res, 400, { erro: 'Informe o novo nome.' });
    await updateRow('Categorias', c.id_categoria, { ...c, nome_categoria: nome });
    return json(res, 200, { ok: true });
  }
  if (acao === 'ativar' || acao === 'desativar') {
    await updateRow('Categorias', c.id_categoria, { ...c, ativo: acao === 'ativar' ? 'SIM' : 'NAO' });
    return json(res, 200, { ok: true });
  }
  return json(res, 400, { erro: 'Acao invalida.' });
}

// ---------- CONFIG ----------
async function config(req, res) {
  if (req.method === 'GET') {
    const rows = await readRows('Configuracoes');
    const mapa = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
    const lista = Object.entries(CONFIG_EDITAVEL).map(([chave, descricao]) => ({
      chave, descricao, valor: mapa[chave] ?? '',
    }));
    return json(res, 200, { rows: lista });
  }
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  const b = await readBody(req);
  const chave = String(b.chave || '');
  if (!Object.prototype.hasOwnProperty.call(CONFIG_EDITAVEL, chave)) {
    return json(res, 400, { erro: 'Configuracao nao editavel.' });
  }
  const valor = String(b.valor ?? '');
  const rows = await readRows('Configuracoes');
  const existe = rows.find((r) => r.chave === chave);
  if (existe) await updateRow('Configuracoes', chave, { ...existe, valor });
  else await appendRow('Configuracoes', { chave, valor, descricao: CONFIG_EDITAVEL[chave] });
  return json(res, 200, { ok: true });
}

// ---------- IA ----------
async function ia(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  if (!temIA()) {
    return json(res, 503, { erro: 'IA nao configurada. Defina GEMINI_API_KEY nas variaveis de ambiente.' });
  }
  const body = await readBody(req);
  const itens = Array.isArray(body.itens) ? body.itens : [];
  if (!itens.length) return json(res, 400, { erro: 'Envie a lista de itens.' });
  const cats = await readRows('Categorias');
  const sugestoes = await sugerirProdutos(itens, cats);
  return json(res, 200, { sugestoes });
}
