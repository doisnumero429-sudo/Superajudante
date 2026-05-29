// api/estoque/saida.js
// POST { id_produto, quantidade, motivo, observacao, usuario }
import { readRows, appendRow, updateRow, nextId } from '../_lib/sheets.js';
import { json, readBody, nowStr } from '../_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  try {
    const b = await readBody(req);
    const qtd = parseFloat(b.quantidade);
    if (!b.id_produto || !qtd || qtd <= 0) {
      return json(res, 400, { erro: 'Informe id_produto e quantidade > 0.' });
    }
    const produtos = await readRows('Produtos');
    const prod = produtos.find((p) => p.id_produto === b.id_produto);
    if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

    const estoqueAtual = parseFloat(prod.estoque_atual) || 0;
    const novoEstoque = estoqueAtual - qtd;
    const custo = parseFloat(prod.custo_medio) || 0;
    const agora = nowStr();

    const o = { ...prod }; delete o._row;
    await updateRow('Produtos', prod._row, {
      ...o, estoque_atual: Number(novoEstoque.toFixed(3)), atualizado_em: agora,
    });

    const idMov = await nextId('Movimentacoes_Estoque', 'id_movimentacao', 'MOV');
    await appendRow('Movimentacoes_Estoque', {
      id_movimentacao: idMov, data: agora, id_produto: b.id_produto,
      tipo: 'SAIDA', quantidade: qtd, custo_unitario: custo,
      valor_total: Number((qtd * custo).toFixed(2)), origem: 'MANUAL',
      id_nota: '', motivo: b.motivo || 'outro', usuario: b.usuario || 'sistema',
      observacao: b.observacao || '',
    });

    return json(res, 200, {
      ok: true, id_produto: b.id_produto,
      estoque_anterior: estoqueAtual, estoque_atual: Number(novoEstoque.toFixed(3)),
      alerta_negativo: novoEstoque < 0,
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
