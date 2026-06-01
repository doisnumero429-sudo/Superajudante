// api/categorias.js
// GET  -> lista todas as categorias.
// POST { acao, ... } -> gerencia categorias:
//   acao=criar     { nome_categoria, descricao? }
//   acao=renomear  { id_categoria, nome_categoria }
//   acao=ativar    { id_categoria }
//   acao=desativar { id_categoria }

import { readRows, appendRow, updateRow, nextId } from './_lib/db.js';
import { json, preflight, readBody } from './_lib/util.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await readRows('Categorias');
      return json(res, 200, { rows });
    }

    if (req.method === 'POST') {
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

    return json(res, 405, { erro: 'Metodo nao permitido' });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
