// api/dashboard.js
import { readRows, readConfig } from './_lib/db.js';
import { json, preflight } from './_lib/util.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    const semanaOffset = parseInt(((req.query) || {}).semana_offset || '0', 10) || 0;

    const [produtos, notas, contas, movs, fornecedores, config] = await Promise.all([
      readRows('Produtos'), readRows('Notas_Fiscais'),
      readRows('Contas_Pagar'), readRows('Movimentacoes_Estoque'),
      readRows('Fornecedores'), readConfig(),
    ]);

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const ymAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const d7 = new Date(hoje); d7.setDate(d7.getDate() + 7);

    // ── Produtos ──────────────────────────────────────────────────────────────
    const ativos = produtos.filter((p) => String(p.ativo).toUpperCase() === 'SIM');
    const estoqueBaixo = ativos.filter((p) =>
      p.estoque_minimo !== '' && parseFloat(p.estoque_atual) <= parseFloat(p.estoque_minimo));
    const valorEstoque = ativos.reduce((s, p) =>
      s + (parseFloat(p.estoque_atual || 0) * parseFloat(p.custo_medio || 0)), 0);

    // ── Notas do mês ──────────────────────────────────────────────────────────
    const notasMes = notas.filter((n) => String(n.data_emissao).startsWith(ymAtual));

    // ── Contas ────────────────────────────────────────────────────────────────
    const parseData = (s) => { const d = new Date(s); return isNaN(d) ? null : d; };
    const abertas = contas.filter((c) => String(c.status).toUpperCase() === 'ABERTO');
    const vencidas = abertas.filter((c) => { const v = parseData(c.vencimento); return v && v < hoje; });
    const venceHoje = abertas.filter((c) => { const v = parseData(c.vencimento); return v && v.getTime() === hoje.getTime(); });
    const vence7 = abertas.filter((c) => { const v = parseData(c.vencimento); return v && v > hoje && v <= d7; });
    const totalAberto = abertas.reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const pendentes = contas.filter((c) => String(c.status).toUpperCase() === 'PENDENTE_INFO');

    // ── Consumo 30 dias ───────────────────────────────────────────────────────
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

    // ── Central da Cris: limite semanal de compras ────────────────────────────
    const pad = (n) => String(n).padStart(2, '0');
    const fmtISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const limite = parseFloat(config.LIMITE_SEMANAL_COMPRAS || '30000') || 30000;

    // Semana começa na segunda-feira (ISO week)
    const inicioSemana = new Date(hoje);
    const diaSemana = hoje.getDay(); // 0=Dom, 1=Seg…
    const diffSeg = diaSemana === 0 ? -6 : 1 - diaSemana;
    inicioSemana.setDate(hoje.getDate() + diffSeg + semanaOffset * 7);
    const fimSemana = new Date(inicioSemana);
    fimSemana.setDate(inicioSemana.getDate() + 6);

    const inicioStr = fmtISO(inicioSemana);
    const fimStr = fmtISO(fimSemana);

    const fornMap = Object.fromEntries(
      fornecedores.map((f) => [f.id_fornecedor, f.nome_fantasia || f.razao_social || f.cnpj])
    );

    const notasSemana = notas
      .filter((n) => {
        const dt = String(n.data_entrada || '').slice(0, 10);
        return dt >= inicioStr && dt <= fimStr
          && String(n.status_importacao || '').toUpperCase() === 'LANCADA';
      })
      .map((n) => ({
        id_nota: n.id_nota,
        numero_nota: n.numero_nota,
        fornecedor_nome: fornMap[n.fornecedor_id] || n.cnpj_fornecedor || '—',
        data_entrada: n.data_entrada,
        valor_total_nota: Number(parseFloat(n.valor_total_nota || 0).toFixed(2)),
      }))
      .sort((a, b) => String(b.data_entrada).localeCompare(String(a.data_entrada)));

    const gastoSemana = notasSemana.reduce((s, n) => s + n.valor_total_nota, 0);
    const disponivelSemana = limite - gastoSemana;
    const percentualSemana = limite > 0 ? (gastoSemana / limite) * 100 : 0;

    return json(res, 200, {
      // ── Campos existentes (sem alteração) ───────────────────────────────────
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
      // ── Central da Cris ─────────────────────────────────────────────────────
      limite_semanal: limite,
      gasto_semana: Number(gastoSemana.toFixed(2)),
      disponivel_semana: Number(disponivelSemana.toFixed(2)),
      percentual_semana: Number(percentualSemana.toFixed(1)),
      periodo_inicio: inicioStr,
      periodo_fim: fimStr,
      notas_semana: notasSemana,
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
