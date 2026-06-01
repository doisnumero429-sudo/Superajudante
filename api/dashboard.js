// api/dashboard.js
import { readRows } from './_lib/db.js';
import { json, preflight } from './_lib/util.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    const [produtos, notas, contas, movs] = await Promise.all([
      readRows('Produtos'), readRows('Notas_Fiscais'),
      readRows('Contas_Pagar'), readRows('Movimentacoes_Estoque'),
    ]);

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const ymAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const d7 = new Date(hoje); d7.setDate(d7.getDate() + 7);

    const ativos = produtos.filter((p) => String(p.ativo).toUpperCase() === 'SIM');
    const estoqueBaixo = ativos.filter((p) =>
      p.estoque_minimo !== '' && parseFloat(p.estoque_atual) <= parseFloat(p.estoque_minimo));
    const valorEstoque = ativos.reduce((s, p) =>
      s + (parseFloat(p.estoque_atual || 0) * parseFloat(p.custo_medio || 0)), 0);

    const notasMes = notas.filter((n) => String(n.data_emissao).startsWith(ymAtual));

    const parseData = (s) => { const d = new Date(s); return isNaN(d) ? null : d; };
    const abertas = contas.filter((c) => String(c.status).toUpperCase() === 'ABERTO');
    const vencidas = abertas.filter((c) => { const v = parseData(c.vencimento); return v && v < hoje; });
    const venceHoje = abertas.filter((c) => { const v = parseData(c.vencimento); return v && v.getTime() === hoje.getTime(); });
    const vence7 = abertas.filter((c) => { const v = parseData(c.vencimento); return v && v > hoje && v <= d7; });
    const totalAberto = abertas.reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const pendentes = contas.filter((c) => String(c.status).toUpperCase() === 'PENDENTE_INFO');

    // Consumo dos ultimos 30 dias: soma das SAIDAs por produto.
    const corte = new Date(hoje); corte.setDate(corte.getDate() - 30);
    const corteStr = `${corte.getFullYear()}-${String(corte.getMonth() + 1).padStart(2, '0')}-${String(corte.getDate()).padStart(2, '0')}`;
    const nomeProd = Object.fromEntries(produtos.map((p) => [p.id_produto, p.nome_interno || p.descricao_original_nf]));
    const ultimasMov = movs.slice(-10).reverse().map((m) => ({ ...m, nome_produto: nomeProd[m.id_produto] || '' }));
    const consumo = {};
    for (const m of movs) {
      if (String(m.tipo).toUpperCase() !== 'SAIDA') continue;
      if (String(m.data || '').slice(0, 10) < corteStr) continue;
      const id = m.id_produto;
      consumo[id] = (consumo[id] || 0) + Math.abs(parseFloat(m.quantidade) || 0);
    }
    const consumo30d = Object.entries(consumo)
      .map(([id, qtd]) => ({ nome: nomeProd[id] || id, quantidade: Number(qtd.toFixed(3)) }))
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 5);

    return json(res, 200, {
      produtos_cadastrados: ativos.length,
      produtos_estoque_baixo: estoqueBaixo.length,
      valor_estimado_estoque: Number(valorEstoque.toFixed(2)),
      notas_no_mes: notasMes.length,
      contas_vencidas: vencidas.length,
      contas_vencendo_hoje: venceHoje.length,
      contas_vencendo_7dias: vence7.length,
      total_em_aberto: Number(totalAberto.toFixed(2)),
      contas_pendentes_info: pendentes.length,
      ultimas_movimentacoes: ultimasMov,
      consumo_30d: consumo30d,
      lista_estoque_baixo: estoqueBaixo.map((p) => ({
        nome: p.nome_interno, estoque: p.estoque_atual, minimo: p.estoque_minimo,
      })),
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
