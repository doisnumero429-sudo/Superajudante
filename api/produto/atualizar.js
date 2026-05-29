// api/produto/atualizar.js
// POST { id_produto, nome_interno?, codigo_barras?, unidade_estoque?, estoque_minimo?,
//        categoria_id?, observacoes?, forcar? }
// Atualiza os campos editaveis de um produto ja cadastrado.
// NAO mexe em estoque_atual nem em custo (para isso use inventario/saida, que geram movimentacao).

import { readRows, updateRow } from '../_lib/sheets.js';
import { json, readBody, nowStr } from '../_lib/util.js';

const EDITAVEIS = ['nome_interno', 'codigo_barras', 'unidade_estoque', 'estoque_minimo', 'categoria_id', 'observacoes'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  try {
    const b = await readBody(req);
    if (!b.id_produto) return json(res, 400, { erro: 'Informe id_produto.' });

    const produtos = await readRows('Produtos');
    const prod = produtos.find((p) => p.id_produto === b.id_produto);
    if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

    // Se mudou o codigo de barras e ele ja pertence a outro produto ativo, avisa.
    // O inventario localiza o produto pelo codigo de barras, entao codigos repetidos
    // deixariam a leitura ambigua. Pode forcar com forcar:true.
    const novoEan = (b.codigo_barras !== undefined) ? String(b.codigo_barras).trim() : null;
    if (novoEan && !b.forcar) {
      const dono = produtos.find((p) => p.id_produto !== prod.id_produto
        && String(p.codigo_barras).trim() === novoEan
        && String(p.ativo).toUpperCase() === 'SIM');
      if (dono) {
        return json(res, 409, {
          erro: `Este codigo de barras ja esta no produto "${dono.nome_interno || dono.descricao_original_nf}". No inventario a leitura pode ficar ambigua.`,
          conflito_id: dono.id_produto,
        });
      }
    }

    const o = { ...prod };
    delete o._row;
    for (const campo of EDITAVEIS) {
      if (b[campo] !== undefined) o[campo] = b[campo];
    }
    o.atualizado_em = nowStr();
    await updateRow('Produtos', prod._row, o);

    return json(res, 200, { ok: true, id_produto: prod.id_produto });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
