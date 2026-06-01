// api/_lib/parser.js
// Faz o parse do XML da NF-e e extrai nota, emitente, destinatario, itens, totais e cobranca.
// Tambem detecta fator de conversao a partir da descricao do produto.

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // mantem tudo como string; convertemos numeros manualmente
  trimValues: true,
});

function num(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function arr(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// Classifica a unidade de compra (uCom) em PESO, VOLUME ou UNIDADE.
// Para PESO/VOLUME, a quantidade da nota ja esta na propria unidade, entao
// o fator de conversao deve ser 1 (entra direto no estoque na mesma unidade).
export function classificarUnidade(uCom) {
  const u = String(uCom || '').trim().toUpperCase().replace(/\./g, '');
  const peso = ['KG', 'KILO', 'KILOGRAMA', 'KGS', 'QUILO', 'G', 'GR', 'GRAMA', 'GRAMAS'];
  const volume = ['L', 'LT', 'LTR', 'LITRO', 'LITROS', 'ML', 'MILILITRO'];
  if (peso.includes(u)) return { tipo: 'PESO', base: (u.startsWith('G') && u !== 'GRS') ? 'G' : 'KG' };
  if (volume.includes(u)) return { tipo: 'VOLUME', base: u.startsWith('ML') ? 'ML' : 'L' };
  return { tipo: 'UNIDADE', base: 'UN' };
}

// Detecta o fator de conversao (ex.: 24UN, 6X, 12 UN) na descricao.
export function detectarFator(descricao) {
  if (!descricao) return 1;
  const d = descricao.toUpperCase();
  // padroes comuns: 24UN, 24 UN, 4XUN, 6X1L, C/24, CX24, 24X
  const padroes = [
    /\bC\/\s*(\d{1,3})\b/,       // C/24
    /\bCX\s*(\d{1,3})\b/,        // CX24
    /\b(\d{1,3})\s*X\s*UN\b/,    // 4XUN
    /\b(\d{1,3})\s*UN\b/,        // 24UN / 24 UN
    /\b(\d{1,3})\s*X\b/,         // 24X
    /\bX\s*(\d{1,3})\b/,         // X24
  ];
  for (const p of padroes) {
    const m = d.match(p);
    if (m) {
      const f = parseInt(m[1], 10);
      if (f >= 2 && f <= 1000) return f;
    }
  }
  return 1;
}

export function parseNfe(xmlString) {
  const doc = parser.parse(xmlString);

  // A estrutura pode vir como nfeProc > NFe > infNFe ou direto NFe > infNFe.
  const NFe = doc?.nfeProc?.NFe || doc?.NFe;
  const inf = NFe?.infNFe;
  if (!inf) throw new Error('XML invalido: infNFe nao encontrado.');

  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const dest = inf.dest || {};
  const total = inf.total?.ICMSTot || {};
  const cobr = inf.cobr || {};
  const pag = inf.pag || {};

  // chave: vem no atributo Id da infNFe como "NFe" + 44 digitos
  let chave = String(inf['@_Id'] || '').replace(/\D/g, '');
  if (chave.length > 44) chave = chave.slice(-44);

  const enderEmit = emit.enderEmit || {};
  const enderDest = dest.enderDest || {};

  const nota = {
    chave_nfe: chave,
    numero_nota: ide.nNF || '',
    serie: ide.serie || '',
    modelo: ide.mod || '',
    data_emissao: (ide.dhEmi || ide.dEmi || '').slice(0, 10),
    data_entrada: (ide.dhSaiEnt || '').slice(0, 10),
    natureza_operacao: ide.natOp || '',
    valor_produtos: num(total.vProd),
    valor_frete: num(total.vFrete),
    valor_desconto: num(total.vDesc),
    valor_outras_despesas: num(total.vOutro),
    valor_total_nota: num(total.vNF),
  };

  const fornecedor = {
    cnpj: String(emit.CNPJ || emit.CPF || '').replace(/\D/g, ''),
    razao_social: emit.xNome || '',
    nome_fantasia: emit.xFant || '',
    inscricao_estadual: emit.IE || '',
    endereco: enderEmit.xLgr || '',
    numero: enderEmit.nro || '',
    bairro: enderEmit.xBairro || '',
    cidade: enderEmit.xMun || '',
    estado: enderEmit.UF || '',
    cep: enderEmit.CEP || '',
    telefone: enderEmit.fone || '',
  };

  const destinatario = {
    cnpj: String(dest.CNPJ || dest.CPF || '').replace(/\D/g, ''),
    razao_social: dest.xNome || '',
    inscricao_estadual: dest.IE || '',
    endereco: enderDest.xLgr || '',
  };

  const totais = {
    vProd: num(total.vProd), vNF: num(total.vNF), vDesc: num(total.vDesc),
    vFrete: num(total.vFrete), vOutro: num(total.vOutro), vICMS: num(total.vICMS),
    vST: num(total.vST), vIPI: num(total.vIPI), vPIS: num(total.vPIS), vCOFINS: num(total.vCOFINS),
  };

  const itens = arr(inf.det).map((det, i) => {
    const prod = det.prod || {};
    const descricao = prod.xProd || '';
    const uCom = prod.uCom || '';
    const classe = classificarUnidade(uCom);
    const ehPeso = classe.tipo !== 'UNIDADE';
    // Peso/volume: a qtd da nota ja esta na unidade final -> fator 1.
    // Unidade/embalagem: tenta detectar o fator pela descricao (ex.: CX 24UN).
    const fator = ehPeso ? 1 : detectarFator(descricao);
    const qtdNf = num(prod.qCom);
    const vTotal = num(prod.vProd);
    const qtdEstoque = qtdNf * fator;
    const custoEstoque = qtdEstoque > 0 ? vTotal / qtdEstoque : 0;
    return {
      numero_item: det['@_nItem'] || (i + 1),
      codigo_produto_nf: prod.cProd || '',
      codigo_barras: (prod.cEAN && prod.cEAN !== 'SEM GTIN') ? prod.cEAN : '',
      descricao_original: descricao,
      ncm: prod.NCM || '',
      cfop: prod.CFOP || '',
      unidade_nf: uCom,
      quantidade_nf: qtdNf,
      valor_unitario_nf: num(prod.vUnCom),
      valor_total_nf: vTotal,
      unidade_tributavel: prod.uTrib || '',
      quantidade_tributavel: num(prod.qTrib),
      valor_unitario_tributavel: num(prod.vUnTrib),
      indtot: prod.indTot || '',
      // dicas de unidade para a tela de conferencia
      unidade_tipo: classe.tipo,            // PESO | VOLUME | UNIDADE
      eh_peso: ehPeso,
      unidade_estoque_sugerida: ehPeso ? classe.base : 'UN',
      fator_conversao: fator,
      quantidade_estoque: qtdEstoque,
      custo_unitario_estoque: Number(custoEstoque.toFixed(6)),
    };
  });

  // Pagamentos / duplicatas
  const duplicatas = arr(cobr.dup).map((d) => ({
    nDup: d.nDup || '',
    vencimento: (d.dVenc || '').slice(0, 10),
    valor: num(d.vDup),
  }));

  const formasPagamento = arr(pag.detPag).map((p) => ({
    tPag: p.tPag || '',
    vPag: num(p.vPag),
  }));

  return { nota, fornecedor, destinatario, totais, itens, duplicatas, formasPagamento };
}

// Mapeia o codigo tPag da NF-e para um rotulo legivel.
export function descreverFormaPagamento(tPag) {
  const mapa = {
    '01': 'DINHEIRO', '02': 'CHEQUE', '03': 'CARTAO', '04': 'CARTAO',
    '05': 'CARTAO', '15': 'BOLETO', '16': 'BOLETO', '17': 'PIX',
    '18': 'TRANSFERENCIA', '90': 'OUTRO', '99': 'OUTRO',
  };
  return mapa[String(tPag)] || 'OUTRO';
}
