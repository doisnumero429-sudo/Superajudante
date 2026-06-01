// api/estoque/saida.js
// POST { id_produto, quantidade, fator?, embalagem?, data?, observacao?, usuario? }
// Saida simples: "saiu = baixa do estoque". A quantidade e informada na embalagem
// escolhida; o fator converte para a unidade-base (ex.: 1 Caixa 6 UN -> 6 unidades).
import { readRows, appendRow, updateRow, nextId } from '../_lib/db.js';
import { json, preflight, readBody, nowStr } from '../_lib/util.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  try {
    const b = await readBody(req);
    const qtdEmb = parseFloat(b.quantidade);
    const fator = parseFloat(b.fator) > 0 ? parseFloat(b.fator) : 1;
    if (!b.id_produto || !qtdEmb || qtdEmb <= 0) {
      return json(res, 400, { erro: 'Informe id_produto e quantidade > 0.' });
    }
    const qtd = qtdEmb * fator; // quantidade na unidade-base
    const produtos = await readRows('Produtos');
    const prod = produtos.find((p) => p.id_produto === b.id_produto);
    if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

    const estoqueAtual = parseFloat(prod.estoque_atual) || 0;
    const novoEstoque = estoqueAtual - qtd;
    const custo = parseFloat(prod.custo_medio) || 0;
    const agora = b.data ? `${b.data} ${nowStr().slice(11)}` : nowStr();
    const obsEmb = b.embalagem && fator !== 1 ? `${b.embalagem} x${qtdEmb}` : '';

    await updateRow('Produtos', prod.id_produto, {
      ...prod, estoque_atual: Number(novoEstoque.toFixed(3)), atualizado_em: agora,
    });

    const idMov = await nextId('Movimentacoes_Estoque', 'id_movimentacao', 'MOV');
    await appendRow('Movimentacoes_Estoque', {
      id_movimentacao: idMov, data: agora, id_produto: b.id_produto,
      tipo: 'SAIDA', quantidade: Number(qtd.toFixed(3)), custo_unitario: custo,
      valor_total: Number((qtd * custo).toFixed(2)), origem: 'MANUAL',
      id_nota: '', motivo: b.motivo || 'saida', usuario: b.usuario || 'sistema',
      observacao: [obsEmb, b.observacao].filter(Boolean).join(' - '),
    });

    return json(res, 200, {
      ok: true, id_produto: b.id_produto, quantidade_baixada: Number(qtd.toFixed(3)),
      estoque_anterior: estoqueAtual, estoque_atual: Number(novoEstoque.toFixed(3)),
      alerta_negativo: novoEstoque < 0,
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
