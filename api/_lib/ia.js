// api/_lib/ia.js
// Cliente da API Google Gemini (gratuito: gemini-2.0-flash, ~1500 req/dia).
// A chave vem SEMPRE do ambiente (GEMINI_API_KEY), nunca do frontend.
// Usado para sugerir o cadastro de produtos novos a partir da descricao da NF-e.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export function temIA() {
  return !!process.env.GEMINI_API_KEY;
}

// Recebe itens da NF-e e as categorias existentes; devolve um array de sugestoes
// na MESMA ordem dos itens: { nome_interno, categoria, unidade_estoque, fator_conversao, eh_peso }.
export async function sugerirProdutos(itens, categorias) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY nao configurada nas variaveis de ambiente da Vercel.');

  const nomesCategorias = (categorias || [])
    .filter((c) => String(c.ativo || 'SIM').toUpperCase() === 'SIM')
    .map((c) => c.nome_categoria)
    .filter(Boolean);

  const lista = itens.map((it, i) => ({
    indice: i,
    descricao: it.descricao_original || it.descricao || '',
    unidade_compra: it.unidade_nf || '',
    quantidade: it.quantidade_nf || 0,
    valor_unitario: it.valor_unitario_nf || 0,
  }));

  const prompt = [
    'Voce e um assistente de cadastro de produtos de um restaurante.',
    'Para cada item de nota fiscal abaixo, sugira como cadastra-lo no estoque.',
    nomesCategorias.length
      ? `Categorias ja existentes (prefira uma destas quando fizer sentido): ${nomesCategorias.join(', ')}.`
      : 'Ainda nao ha categorias cadastradas; sugira uma categoria curta para cada item.',
    '',
    'Regras:',
    '- nome_interno: nome limpo, curto e legivel em portugues. Sem codigos, sem abreviacoes fiscais. Ex.: "FRANGO CORTES CONG CX 15KG" -> "Frango em cortes (congelado)".',
    '- unidade_estoque: como o item e controlado no estoque (UN, KG, L, CX, PCT, FD...). Se for comprado/usado a peso, use KG; se a volume, use L.',
    '- fator_conversao: quantas unidades_estoque existem em 1 unidade de compra (unidade_compra). Se a unidade_compra for de peso (KG, G) ou volume (L, ML), fator = 1. Se for caixa/fardo com N itens, fator = N.',
    '- eh_peso: true se o produto e controlado por peso ou volume (kg, g, l, ml); senao false.',
    '- categoria: escolha uma das categorias existentes ou proponha uma curta nova.',
    '',
    'Responda APENAS um array JSON valido, um objeto por item, na MESMA ordem do indice,',
    'com as chaves exatas: nome_interno, categoria, unidade_estoque, fator_conversao, eh_peso.',
    '',
    'Itens:',
    JSON.stringify(lista),
  ].join('\n');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  };

  const res = await fetch(`${GEMINI_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = `Erro Gemini HTTP ${res.status}`;
    try { const j = JSON.parse(text); if (j.error?.message) msg += `: ${j.error.message}`; } catch { /* ignore */ }
    throw new Error(msg);
  }

  let saida = '';
  try {
    const j = JSON.parse(text);
    saida = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch {
    saida = text;
  }

  // remove cercas de codigo se vierem
  saida = saida.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  let parsed;
  try { parsed = JSON.parse(saida); }
  catch { throw new Error('A IA retornou um formato inesperado. Tente novamente.'); }

  const arr = Array.isArray(parsed) ? parsed : (parsed.itens || parsed.sugestoes || []);
  // normaliza cada sugestao
  return itens.map((_, i) => {
    const s = arr[i] || {};
    let fator = parseFloat(s.fator_conversao);
    if (!Number.isFinite(fator) || fator <= 0) fator = 1;
    const ehPeso = s.eh_peso === true || s.eh_peso === 'true';
    return {
      nome_interno: String(s.nome_interno || '').trim(),
      categoria: String(s.categoria || '').trim(),
      unidade_estoque: String(s.unidade_estoque || (ehPeso ? 'KG' : 'UN')).trim().toUpperCase(),
      fator_conversao: ehPeso ? 1 : fator,
      eh_peso: ehPeso,
    };
  });
}
