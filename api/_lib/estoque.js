// api/_lib/estoque.js
// Logica compartilhada de ENTRADA de estoque (custo medio ponderado).
// Mesma regra usada na confirmacao de NF-e (api/nfe/confirmar.js), agora
// reaproveitada pela Entrada Manual para nao duplicar regra divergente.

import { appendRow, updateRow, nextId } from './db.js';
import { nowStr } from './util.js';

// Aplica uma entrada de `qtdBase` unidades-base no produto `prod` (linha ja lida).
// Atualiza estoque e custo medio ponderado, grava a movimentacao ENTRADA.
// Retorna { estoque_anterior, estoque_atual, custo_medio, custo_unitario }.
export async function entradaEstoque(prod, qtdBase, custoUnit, opts = {}) {
  const agora = opts.data || nowStr();
  const estoqueAtual = parseFloat(prod.estoque_atual) || 0;
  const custoMedioAnt = parseFloat(prod.custo_medio) || 0;
  const novoEstoque = estoqueAtual + qtdBase;
  const novoCustoMedio = novoEstoque > 0
    ? ((estoqueAtual * custoMedioAnt) + (qtdBase * custoUnit)) / novoEstoque
    : custoUnit;

  await updateRow('Produtos', prod.id_produto, {
    ...prod,
    estoque_atual: Number(novoEstoque.toFixed(3)),
    ultimo_custo_unitario: Number(custoUnit.toFixed(4)),
    custo_medio: Number(novoCustoMedio.toFixed(4)),
    atualizado_em: agora,
  });

  const idMov = await nextId('Movimentacoes_Estoque', 'id_movimentacao', 'MOV');
  await appendRow('Movimentacoes_Estoque', {
    id_movimentacao: idMov,
    data: agora,
    id_produto: prod.id_produto,
    tipo: 'ENTRADA',
    quantidade: Number(qtdBase.toFixed(3)),
    custo_unitario: Number(custoUnit.toFixed(4)),
    valor_total: Number((qtdBase * custoUnit).toFixed(2)),
    origem: opts.origem || 'MANUAL',
    id_nota: opts.id_nota || '',
    motivo: opts.motivo || 'entrada manual',
    usuario: opts.usuario || 'sistema',
    observacao: opts.observacao || '',
  });

  return {
    estoque_anterior: estoqueAtual,
    estoque_atual: Number(novoEstoque.toFixed(3)),
    custo_medio: Number(novoCustoMedio.toFixed(4)),
    custo_unitario: Number(custoUnit.toFixed(4)),
  };
}
