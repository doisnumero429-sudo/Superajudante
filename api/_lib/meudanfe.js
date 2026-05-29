// api/_lib/meudanfe.js
// Cliente da API Meu Danfe v2. A Api-Key vem SEMPRE do ambiente (nunca do frontend).
// Comportamento conforme a documentacao oficial (OAS 3.1):
//  - PUT /fd/add/{chave}: a 1a chamada dispara a busca e pode retornar so { value, type }.
//    O campo "status" (WAITING|SEARCHING|NOT_FOUND|OK|ERROR) aparece nas reconsultas.
//  - GET /fd/get/xml/{chave}: retorna JSON (XmlResponse) com o XML em um campo.
//  - GET /fd/get/da/{chave}: retorna JSON { name, type, format, data } com PDF base64 em "data".

const BASE_URL = process.env.BASE_URL_API || 'https://api.meudanfe.com.br/v2';

function apiKey() {
  const k = process.env.API_KEY_MEU_DANFE;
  if (!k) throw new Error('API_KEY_MEU_DANFE nao definida nas Environment Variables da Vercel.');
  return k;
}

function headers(accept = 'application/json') {
  return { 'Api-Key': apiKey(), 'Accept': accept };
}

// Traduz codigos HTTP de erro documentados em mensagens claras.
function erroHttp(status, corpo) {
  const mapa = {
    400: 'Chave de acesso ou XML invalido.',
    401: 'Api-Key nao informada ou invalida.',
    402: 'Saldo insuficiente na conta Meu Danfe. Adicione creditos na Area do Cliente.',
    403: 'Api-Key foi substituida. Gere uma nova na Area do Cliente (menu API / Integracao).',
    404: 'NF-e ainda nao adicionada na Area do Cliente. Faca a busca pela chave primeiro.',
    500: 'Erro interno da API Meu Danfe. Tente novamente mais tarde.',
  };
  return mapa[status] || `Erro HTTP ${status}: ${String(corpo).slice(0, 200)}`;
}

async function parseJsonSafe(res) {
  const text = await res.text();
  try { return { json: JSON.parse(text), text }; }
  catch { return { json: null, text }; }
}

// PUT /fd/add/{chave}
// Retorna SEMPRE objeto normalizado { value, type, status, statusMessage, httpStatus, fatal }.
// Se a API ainda nao incluiu "status" (1a chamada), assumimos WAITING para o fluxo de polling.
export async function addNfe(chave) {
  const res = await fetch(`${BASE_URL}/fd/add/${chave}`, { method: 'PUT', headers: headers() });
  const { json, text } = await parseJsonSafe(res);

  if (!res.ok) {
    return {
      value: chave,
      type: 'NFE',
      status: 'ERROR',
      statusMessage: erroHttp(res.status, text),
      httpStatus: res.status,
      fatal: [400, 401, 402, 403].includes(res.status),
    };
  }

  const status = (json && json.status ? String(json.status).toUpperCase() : 'WAITING');
  return {
    value: (json && json.value) || chave,
    type: (json && json.type) || 'NFE',
    status,
    statusMessage: (json && json.statusMessage) || '',
    httpStatus: res.status,
    fatal: false,
  };
}

// GET /fd/get/xml/{chave} -> JSON (XmlResponse). O XML vem em data/xml/value/content.
export async function getXml(chave) {
  const res = await fetch(`${BASE_URL}/fd/get/xml/${chave}`, { method: 'GET', headers: headers() });
  const { json, text } = await parseJsonSafe(res);
  if (!res.ok) throw new Error(erroHttp(res.status, text));

  if (json) {
    const xml = json.data || json.xml || json.value || json.content;
    if (xml) return xml;
  }
  if (text && text.trim().startsWith('<')) return text; // fallback: XML cru
  throw new Error('XML nao encontrado na resposta da API.');
}

// GET /fd/get/da/{chave} -> JSON { name, type, format, data } com PDF base64 em "data".
export async function getDanfe(chave) {
  const res = await fetch(`${BASE_URL}/fd/get/da/${chave}`, { method: 'GET', headers: headers() });
  const { json, text } = await parseJsonSafe(res);
  if (!res.ok) throw new Error(erroHttp(res.status, text));
  if (json && json.data) return json.data;
  if (json && (json.value || json.pdf)) return json.value || json.pdf;
  throw new Error('DANFE (base64) nao encontrado na resposta da API.');
}

// PUT /fd/add/xml -> envia XML manualmente (GRATIS). Body em text/plain.
// AVISO da doc: reenviar o mesmo XML varias vezes BLOQUEIA a conta.
export async function addXml(xmlString) {
  const res = await fetch(`${BASE_URL}/fd/add/xml`, {
    method: 'PUT',
    headers: { 'Api-Key': apiKey(), 'Content-Type': 'text/plain', 'Accept': 'application/json' },
    body: xmlString,
  });
  const { json, text } = await parseJsonSafe(res);
  if (!res.ok) throw new Error(erroHttp(res.status, text));
  return { value: (json && json.value) || '', type: (json && json.type) || 'NFE' };
}
