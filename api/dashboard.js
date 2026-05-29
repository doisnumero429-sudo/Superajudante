// api/dashboard.js
import { readRows } from './_lib/sheets.js';
import { json } from './_lib/util.js';

export default async function handler(req, res) {
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

    const ultimasMov = movs.slice(-10).reverse();

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
      lista_estoque_baixo: estoqueBaixo.map((p) => ({
        nome: p.nome_interno, estoque: p.estoque_atual, minimo: p.estoque_minimo,
      })),
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
