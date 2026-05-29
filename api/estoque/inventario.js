// api/estoque/inventario.js
// GET  ?codigo_barras=...  -> encontra produto e mostra estoque atual.
// POST { id_produto, quantidade_contada, usuario } -> ajusta estoque pela diferenca.
import { readRows, appendRow, updateRow, nextId } from '../_lib/sheets.js';
import { json, readBody, nowStr } from '../_lib/util.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const params = req.query || new URL(req.url, 'http://x').searchParams;
      const ean = params.codigo_barras || params.get?.('codigo_barras');
      const produtos = await readRows('Produtos');
      const prod = produtos.find((p) => String(p.codigo_barras) === String(ean));
      if (!prod) return json(res, 404, { erro: 'Produto nao encontrado para este codigo de barras.', codigo_barras: ean });
      return json(res, 200, {
        id_produto: prod.id_produto, nome_interno: prod.nome_interno,
        estoque_atual: parseFloat(prod.estoque_atual) || 0, unidade: prod.unidade_estoque,
      });
    }

    if (req.method === 'POST') {
      const b = await readBody(req);
      const contada = parseFloat(b.quantidade_contada);
      if (!b.id_produto || isNaN(contada)) {
        return json(res, 400, { erro: 'Informe id_produto e quantidade_contada.' });
      }
      const produtos = await readRows('Produtos');
      const prod = produtos.find((p) => p.id_produto === b.id_produto);
      if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

      const estoqueAtual = parseFloat(prod.estoque_atual) || 0;
      const diff = contada - estoqueAtual;
      const custo = parseFloat(prod.custo_medio) || 0;
      const agora = nowStr();

      const o = { ...prod }; delete o._row;
      await updateRow('Produtos', prod._row, {
        ...o, estoque_atual: Number(contada.toFixed(3)), atualizado_em: agora,
      });

      if (diff !== 0) {
        const idMov = await nextId('Movimentacoes_Estoque', 'id_movimentacao', 'MOV');
        await appendRow('Movimentacoes_Estoque', {
          id_movimentacao: idMov, data: agora, id_produto: b.id_produto,
          tipo: 'AJUSTE', quantidade: Number(diff.toFixed(3)), custo_unitario: custo,
          valor_total: Number((Math.abs(diff) * custo).toFixed(2)), origem: 'INVENTARIO',
          id_nota: '', motivo: 'ajuste manual', usuario: b.usuario || 'sistema',
          observacao: `Inventario: contado ${contada}, sistema ${estoqueAtual}`,
        });
      }
      return json(res, 200, {
        ok: true, id_produto: b.id_produto,
        estoque_anterior: estoqueAtual, estoque_atual: Number(contada.toFixed(3)),
        diferenca: Number(diff.toFixed(3)),
      });
    }

    return json(res, 405, { erro: 'Metodo nao permitido' });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
