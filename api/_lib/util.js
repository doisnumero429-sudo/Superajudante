// api/_lib/util.js

// Cabecalhos CORS — o app nativo (Capacitor) roda na origem https://localhost
// e chama a API em superajudante.vercel.app (cross-origin). Sem isto o webview
// bloqueia a resposta e o fetch falha com "Failed to fetch".
export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Responde a requisicao de preflight (OPTIONS) e devolve true se ja tratou.
// Deve ser a 1a linha de cada handler: if (preflight(req, res)) return;
export function preflight(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function json(res, status, data) {
  setCors(res);
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data));
}

export function validarChave(chave) {
  const c = String(chave || '').replace(/\D/g, '');
  return /^\d{44}$/.test(c) ? c : null;
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
  });
}

// Controle simples de tentativas por chave, em memoria do processo.
// Evita repetir a mesma chave em menos de INTERVALO ms e limita tentativas.
const tentativas = new Map(); // chave -> { count, lastTs }

export function podeConsultar(chave, intervaloMs, maxTentativas) {
  const agora = Date.now();
  const reg = tentativas.get(chave) || { count: 0, lastTs: 0 };
  if (agora - reg.lastTs < intervaloMs) {
    return { ok: false, motivo: 'INTERVALO', espera: intervaloMs - (agora - reg.lastTs) };
  }
  if (reg.count >= maxTentativas) {
    return { ok: false, motivo: 'MAX_TENTATIVAS' };
  }
  return { ok: true };
}

export function registrarConsulta(chave) {
  const reg = tentativas.get(chave) || { count: 0, lastTs: 0 };
  reg.count += 1;
  reg.lastTs = Date.now();
  tentativas.set(chave, reg);
}

export function resetarTentativas(chave) {
  tentativas.delete(chave);
}

export function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
