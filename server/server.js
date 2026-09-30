/* =========================================================
   Servidor da loja — site + API de pedidos/Pix
   Uso:  node server/server.js        (porta 5173, ou PORT=xxxx)
   Sem dependências externas (Node 18+).
   ========================================================= */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PRODUTO = require("../produto.js");
const pix = require("./providers/" + (process.env.PIX_PROVIDER || "teste") + ".js");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(__dirname, "data");
const PEDIDOS = path.join(DATA, "pedidos.json");
const PORT = +process.env.PORT || 5173;
const PIX_MINUTOS = 30;

fs.mkdirSync(DATA, { recursive: true });

/* ---------------- pedidos (arquivo JSON — trocar por banco de dados na versão final) ---------------- */
function lerPedidos() {
  try { return JSON.parse(fs.readFileSync(PEDIDOS, "utf8")); } catch { return {}; }
}
function salvarPedidos(p) {
  const tmp = PEDIDOS + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, PEDIDOS);
}

/* ---------------- validação ---------------- */
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const soDigitos = s => String(s || "").replace(/\D/g, "");
const texto = (s, max = 120) => String(s || "").trim().slice(0, max);

function cpfValido(cpf) {
  cpf = soDigitos(cpf);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += +cpf[i] * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== +cpf[n]) return false;
  }
  return true;
}

function validarPedido(b) {
  const erros = [];
  const vi = Number(b.variant), qty = Number(b.qty);
  if (!Number.isInteger(vi) || !PRODUTO.variants[vi]) erros.push("variant");
  if (!Number.isInteger(qty) || qty < 1 || qty > PRODUTO.maxQty) erros.push("qty");
  const bumps = Array.isArray(b.bumps) ? [...new Set(b.bumps.map(String))] : [];
  if (bumps.some(id => !PRODUTO.bumps.find(x => x.id === id))) erros.push("bumps");
  // cor escolhida para bumps que têm opções de cor
  const cores = {};
  for (const id of bumps) {
    const bp = PRODUTO.bumps.find(x => x.id === id);
    if (!bp || !bp.cores) continue;
    const cor = String((b.cores || {})[id] || "");
    if (!bp.cores.includes(cor)) erros.push("cor");
    cores[id] = cor;
  }

  const c = b.contato || {}, e = b.endereco || {};
  const d = {
    nome: texto(c.nome, 80),
    telefone: soDigitos(c.telefone),
    email: texto(c.email, 120).toLowerCase(),
    cep: soDigitos(e.cep),
    uf: texto(e.uf, 2).toUpperCase(),
    cidade: texto(e.cidade, 80),
    bairro: texto(e.bairro, 80),
    rua: texto(e.rua, 120),
    numero: texto(e.numero, 10),
    complemento: texto(e.complemento, 80),
    cpf: soDigitos(b.cpf),
    nota: texto(b.nota, 300),
  };
  if (d.nome.split(/\s+/).length < 2) erros.push("nome");
  if (!/^\d{10,11}$/.test(d.telefone)) erros.push("telefone");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) erros.push("email");
  if (!/^\d{8}$/.test(d.cep)) erros.push("cep");
  if (!UFS.includes(d.uf)) erros.push("uf");
  for (const k of ["cidade", "bairro", "rua", "numero"]) if (!d[k]) erros.push(k);
  if (!cpfValido(d.cpf)) erros.push("cpf");
  return { erros, vi, qty, bumps, cores, d };
}

/* ---------------- helpers HTTP ---------------- */
function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function lerCorpo(req, limite = 20000) {
  return new Promise((ok, falha) => {
    let t = "";
    req.on("data", c => { t += c; if (t.length > limite) { falha(new Error("corpo grande demais")); req.destroy(); } });
    req.on("end", () => { try { ok(t ? JSON.parse(t) : {}); } catch { falha(new Error("JSON inválido")); } });
  });
}
// resposta pública de um pedido (sem CPF/endereço completo)
function publico(p) {
  return {
    id: p.id, status: p.status, total: p.total, criadoEm: p.criadoEm, pagoEm: p.pagoEm || null,
    item: { label: p.item.label, qty: p.item.qty },
    bumps: (p.bumps || []).map(b => b.nome + (b.cor ? ` (${b.cor})` : "")),
    pix: p.status === "aguardando" ? { copiaECola: p.pix.copiaECola, expiraEm: p.pix.expiraEm } : null,
    teste: !!pix.teste,
  };
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  // criar pedido + cobrança Pix
  if (req.method === "POST" && url.pathname === "/api/pedidos") {
    let body;
    try { body = await lerCorpo(req); } catch (e) { return json(res, 400, { erro: e.message }); }
    const { erros, vi, qty, bumps, cores, d } = validarPedido(body);
    if (erros.length) return json(res, 422, { erro: "Dados inválidos", campos: erros });

    const t = PRODUTO.calcular(vi, qty, bumps);   // total calculado AQUI, nunca pelo navegador
    const id = Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
    const expiraEm = new Date(Date.now() + PIX_MINUTOS * 60000).toISOString();

    let cobranca;
    try {
      cobranca = await pix.criarCobranca({
        pedidoId: id, valor: t.total, expiraEm,
        descricao: `${PRODUTO.nome} ${t.variant.label} x${qty}` + (t.bumps.length ? ` + ${t.bumps.length} adicional(is)` : ""),
        pagador: { nome: d.nome, email: d.email, cpf: d.cpf },
      });
    } catch (e) {
      console.error("Erro ao criar Pix:", e);
      return json(res, 502, { erro: "Não foi possível gerar o Pix agora. Tente novamente." });
    }

    const pedidos = lerPedidos();
    pedidos[id] = {
      id, status: "aguardando", criadoEm: new Date().toISOString(),
      item: { variant: vi, code: t.variant.code, label: t.variant.label, qty, preco: t.variant.price },
      bumps: t.bumps.map(b => ({ id: b.id, nome: b.nome, preco: b.price, ...(cores[b.id] ? { cor: cores[b.id] } : {}) })),
      original: t.original, descontoProduto: t.descontoProduto, cupom: t.cupom, total: t.total,
      cliente: d,
      pix: { txid: cobranca.txid, copiaECola: cobranca.copiaECola, expiraEm },
    };
    salvarPedidos(pedidos);
    return json(res, 201, publico(pedidos[id]));
  }

  // consultar status (o front consulta a cada poucos segundos)
  let m = url.pathname.match(/^\/api\/pedidos\/([A-Z0-9]{6,20})$/);
  if (req.method === "GET" && m) {
    const pedidos = lerPedidos(), p = pedidos[m[1]];
    if (!p) return json(res, 404, { erro: "Pedido não encontrado" });
    if (p.status === "aguardando") {
      if (Date.parse(p.pix.expiraEm) < Date.now()) { p.status = "expirado"; salvarPedidos(pedidos); }
      else if (pix.consultar) {
        const st = await pix.consultar(p.pix.txid).catch(() => null);
        if (st === "pago") { p.status = "pago"; p.pagoEm = new Date().toISOString(); salvarPedidos(pedidos); }
      }
    }
    return json(res, 200, publico(p));
  }

  // SOMENTE NO MODO TESTE: simular o pagamento
  m = url.pathname.match(/^\/api\/teste\/pagar\/([A-Z0-9]{6,20})$/);
  if (req.method === "POST" && m && pix.teste) {
    const pedidos = lerPedidos(), p = pedidos[m[1]];
    if (!p) return json(res, 404, { erro: "Pedido não encontrado" });
    if (p.status === "aguardando") { p.status = "pago"; p.pagoEm = new Date().toISOString(); salvarPedidos(pedidos); }
    return json(res, 200, publico(p));
  }

  // webhook do gateway (a ser implementado junto com o provedor real)
  if (req.method === "POST" && url.pathname === "/api/webhook" && pix.webhook) {
    return pix.webhook(req, res, { lerPedidos, salvarPedidos, json, lerCorpo });
  }

  return json(res, 404, { erro: "Rota não encontrada" });
}

/* ---------------- arquivos estáticos ---------------- */
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".json": "application/json",
};
function estatico(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.normalize(path.join(ROOT, p));
  const rel = path.relative(ROOT, f);
  // nunca servir o código do servidor, dados de pedidos ou arquivos ocultos
  if (rel.startsWith("..") || /^(server|\.)/.test(rel) || rel.split(path.sep).some(s => s.startsWith("."))) {
    res.writeHead(404); return res.end("404");
  }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end("404"); }
    const tipo = TIPOS[path.extname(f).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;
    if (range) {                                   // vídeos: permite avançar/voltar
      let [a, b] = range.replace("bytes=", "").split("-");
      a = parseInt(a, 10) || 0; b = b ? parseInt(b, 10) : st.size - 1;
      res.writeHead(206, { "Content-Type": tipo, "Content-Range": `bytes ${a}-${b}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 });
      return fs.createReadStream(f, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": tipo, "Content-Length": st.size, "Cache-Control": "no-cache" });
    fs.createReadStream(f).pipe(res);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    api(req, res, url).catch(e => { console.error(e); json(res, 500, { erro: "Erro interno" }); });
  } else {
    estatico(req, res, url);
  }
}).listen(PORT, () => {
  console.log(`Loja rodando em http://localhost:${PORT}  (Pix: ${pix.nome})`);
});
