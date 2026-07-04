/*
 * Painel Seletor de Anúncios — servidor de protótipo (standalone, fora do Bubble)
 * Node puro, zero dependências, http/https nativos.
 *
 * SEGURANÇA INVIOLÁVEL:
 *   - O access_token do Mercado Livre NUNCA vai para o browser.
 *   - NUNCA aparece em logs (logamos só método + caminho, sem query).
 *   - NUNCA aparece em mensagens de erro.
 *   - NUNCA tentamos renovar o token. Se a ML devolver 401, repassamos 401
 *     e o front mostra "sessão do Mercado Livre expirada".
 *
 * O token é lido do disco A CADA request (não fica em memória entre chamadas),
 * então se outro processo rotacionar o arquivo, pegamos o valor novo.
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3477; // override via env só para testes locais
const HOST = '127.0.0.1'; // bind SOMENTE loopback — nunca exposto na rede
const TOKENS_PATH = 'C:\\Users\\Lucas Sertori\\.ml-mcp-tokens.json';
const INDEX_PATH = path.join(__dirname, 'index.html');
const ML_HOST = 'api.mercadolibre.com';

// Whitelist de prefixos de caminho aceitos no proxy /api/ml/<caminho>.
// Qualquer coisa fora disso responde 403.
function isAllowedMlPath(restPath) {
  return (
    restPath === 'users' ||
    restPath.startsWith('users/') ||
    restPath === 'items' ||
    restPath.startsWith('items/') ||
    restPath.startsWith('questions/search') ||
    restPath.startsWith('orders/search')
  );
}

// Loga apenas método + caminho (sem query string, para não vazar nada por acidente).
function logReq(method, url, status) {
  const pathnameOnly = String(url).split('?')[0];
  const stamp = new Date().toISOString();
  console.log(`${stamp}  ${method} ${pathnameOnly}${status != null ? '  -> ' + status : ''}`);
}

// Lê o token do disco, strip BOM. Retorna { access_token, user_id } ou lança.
function readTokens() {
  const raw = fs.readFileSync(TOKENS_PATH, 'utf8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// Proxy GET -> https://api.mercadolibre.com/<rest> injetando o Bearer server-side.
function proxyToMl(rest, res) {
  let tokens;
  try {
    tokens = readTokens();
  } catch (e) {
    // Não ecoamos e.message (poderia conter caminho/detalhes); mensagem genérica.
    sendJson(res, 500, {
      error: 'token_indisponivel',
      message: 'Não foi possível ler a sessão do Mercado Livre.',
    });
    return;
  }

  const token = tokens && tokens.access_token;
  if (!token) {
    // Sem token salvo -> trata como sessão expirada, o front reconecta.
    sendJson(res, 401, {
      error: 'sem_sessao',
      message: 'Sessão do Mercado Livre não encontrada.',
    });
    return;
  }

  const options = {
    hostname: ML_HOST,
    path: '/' + rest, // rest já vem com a query string original (encoded pelo browser)
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'User-Agent': 'mf-ad-selector-proto',
    },
  };

  const upstream = https.request(options, (up) => {
    const chunks = [];
    up.on('data', (c) => chunks.push(c));
    up.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct = up.headers['content-type'] || 'application/json; charset=utf-8';
      // Repassa status code e corpo tal como vieram da ML.
      res.writeHead(up.statusCode || 502, {
        'Content-Type': ct,
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    });
  });

  upstream.on('error', (err) => {
    // Nunca ecoamos o objeto de erro (defensivo). Só o código de rede.
    logReq('GET', '/api/ml/(upstream-error)', err && err.code ? err.code : 'ERR');
    sendJson(res, 502, {
      error: 'falha_conexao',
      message: 'Não foi possível falar com o Mercado Livre agora. Tente de novo.',
    });
  });

  upstream.end();
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  // Só GET é permitido.
  if (method !== 'GET') {
    logReq(method, url, 405);
    sendJson(res, 405, { error: 'metodo_nao_permitido' });
    return;
  }

  // Favicon: 204 silencioso para não poluir o log.
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Raiz -> index.html
  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(INDEX_PATH, (err, data) => {
      if (err) {
        logReq(method, url, 500);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('index.html não encontrado ao lado de serve.js');
        return;
      }
      logReq(method, url, 200);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Health — expõe user_id (público), nunca o token.
  if (pathname === '/api/health') {
    let ok = false;
    let user_id = null;
    try {
      const t = readTokens();
      user_id = t.user_id != null ? t.user_id : null;
      ok = !!t.access_token;
    } catch (e) {
      ok = false;
    }
    logReq(method, url, 200);
    sendJson(res, 200, { ok, user_id });
    return;
  }

  // Proxy ML
  if (pathname.startsWith('/api/ml/')) {
    const rest = url.slice('/api/ml/'.length); // inclui query
    const restPath = rest.split('?')[0];
    if (!isAllowedMlPath(restPath)) {
      logReq(method, url, 403);
      sendJson(res, 403, { error: 'caminho_nao_permitido' });
      return;
    }
    logReq(method, '/api/ml/' + restPath, null); // loga sem query
    proxyToMl(rest, res);
    return;
  }

  // Qualquer outra rota
  logReq(method, url, 404);
  sendJson(res, 404, { error: 'nao_encontrado' });
});

server.listen(PORT, HOST, () => {
  console.log(`Painel Seletor de Anúncios (protótipo) rodando em http://${HOST}:${PORT}`);
  console.log('Token lido server-side a cada request — nunca enviado ao browser.');
  console.log('Ctrl+C para parar.');
});
