'use strict';
/*
 * Mini-DOM: parseia o HTML que o código REALMENTE gera.
 *
 * Por que existe: o harness antigo devolvia `querySelector: () => null` e
 * `closest: () => null`. Com isso, `marcadosNoLote`, `umCampo` e o handler de clique nunca
 * rodaram em teste nenhum — o comentário do código dizia "travado por teste" e não havia
 * teste. Foi assim que o P3 (clicar em "Aplicar" na segunda linha grava o valor da
 * primeira) atravessou 305 asserções verdes.
 *
 * Escopo de propósito: só o que o painel usa. Seletor composto simples (`.a.b`,
 * `[data-x="v"]`, `:not(.c)`, `:not([data-x])`, `tag`, `#id`) — SEM combinador. Seletor com
 * espaço ou `>` lança, em vez de devolver null e mentir que não achou.
 */

const VAZIAS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

function decodificar(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function camel(nome) {
  return nome.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class No {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this.texto = '';
    this._ouvintes = new Map();
    this._valorTocado = false;
    this._checadoTocado = false;
  }

  // ── atributos ────────────────────────────────────────────────────────────────
  getAttribute(k) { const v = this.attrs.get(String(k).toLowerCase()); return v === undefined ? null : v; }
  setAttribute(k, v) { this.attrs.set(String(k).toLowerCase(), String(v)); }
  hasAttribute(k) { return this.attrs.has(String(k).toLowerCase()); }
  removeAttribute(k) { this.attrs.delete(String(k).toLowerCase()); }

  get id() { return this.getAttribute('id') || ''; }

  get dataset() {
    const d = {};
    for (const [k, v] of this.attrs) if (k.indexOf('data-') === 0) d[camel(k.slice(5))] = v;
    return d;
  }

  get classList() {
    const self = this;
    const lista = () => String(self.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    return {
      contains: (c) => lista().includes(c),
      add(c) { const l = lista(); if (!l.includes(c)) { l.push(c); self.setAttribute('class', l.join(' ')); } },
      remove(c) { self.setAttribute('class', lista().filter((x) => x !== c).join(' ')); },
      // O 2o argumento e o do browser: toggle(c, true) adiciona, toggle(c, false) remove.
      // Sem ele, `i <= passo` do keyword-agent acendia TODOS os passos e o teste media a
      // ausencia do recurso, nao o comportamento do codigo (02/09).
      toggle(c, forca) {
        if (forca === true) return this.add(c);
        if (forca === false) return this.remove(c);
        return lista().includes(c) ? this.remove(c) : this.add(c);
      },
    };
  }

  // `value` e `checked` nascem do atributo e passam a viver em memória depois que alguém
  // escreve — é o que o browser faz, e é o que faz o teste de "o vendedor editou o campo
  // antes de aplicar" valer alguma coisa.
  get value() { return this._valorTocado ? this._valor : (this.getAttribute('value') || ''); }
  set value(v) { this._valorTocado = true; this._valor = String(v); }
  get checked() { return this._checadoTocado ? this._checado : this.hasAttribute('checked'); }
  set checked(v) { this._checadoTocado = true; this._checado = !!v; }

  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }

  get textContent() {
    if (this.tagName === '#TEXT') return this.texto;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this._html = undefined;
    this.children = [];
    const n = new No('#TEXT');
    n.texto = String(v);
    this.appendChild(n);
  }

  // ── árvore ───────────────────────────────────────────────────────────────────
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, ref) {
    n.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i >= 0) this.children.splice(i, 0, n); else this.children.unshift(n);
    return n;
  }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }

  get innerHTML() { return this._html === undefined ? '' : this._html; }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
    for (const filho of parseFragmento(this._html)) this.appendChild(filho);
  }

  // ── consulta ─────────────────────────────────────────────────────────────────
  _todos(saida) {
    for (const c of this.children) {
      if (c.tagName !== '#TEXT') { saida.push(c); c._todos(saida); }
    }
    return saida;
  }
  /**
   * Aceita lista (".a, .b" = OU) e descendente (".a .b" = dentro de). Os dois aparecem no
   * painel: `.fia-check, .fia-check-nova` junta os dois tipos de marcação, e
   * `.fia-secao-palpites .fia-linha` isola um bloco.
   *
   * O que continua lançando é `>`, `+` e `~` (ver `partir`): melhor um erro alto do que um
   * `null` que passa por "não achei".
   */
  querySelectorAll(sel) {
    const alternativas = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    const achados = new Set();
    for (const alt of alternativas) {
      // `>`, `+` e `~` continuam fora: lançar é melhor que devolver vazio e passar por
      // "não achei". Sem esta linha eles viravam um passo solto que casa com tudo.
      if (/[>+~]/.test(alt.replace(/\[[^\]]*\]/g, ''))) {
        throw new Error('mini-dom: combinador não suportado: ' + alt);
      }
      const passos = alt.split(/\s+/).filter(Boolean);
      let nivel = [this];
      for (const passo of passos) {
        const proximo = new Set();
        for (const base of nivel) for (const n of base._todos([])) if (casa(n, passo)) proximo.add(n);
        nivel = [...proximo];
      }
      for (const n of nivel) if (n !== this) achados.add(n);
    }
    // devolve na ordem do documento, como o browser
    return this._todos([]).filter((n) => achados.has(n));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    let n = this;
    while (n) { if (n.tagName !== '#TEXT' && casa(n, sel)) return n; n = n.parentNode; }
    return null;
  }

  // ── eventos ──────────────────────────────────────────────────────────────────
  addEventListener(tipo, fn) {
    if (!this._ouvintes.has(tipo)) this._ouvintes.set(tipo, []);
    this._ouvintes.get(tipo).push(fn);
  }
  removeEventListener(tipo, fn) {
    const l = this._ouvintes.get(tipo) || [];
    const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  }
  /**
   * Sobe a árvore como o browser: o handler delegado no #ficha-ia-body precisa disso.
   * E chega ao DOCUMENT no fim — sem isso, `document.addEventListener('click', ...)` era
   * um no-op no teste, que foi exatamente como o botão "Voltar para a lista" ficou morto
   * na tela sem nenhuma asserção reclamar.
   */
  dispatchEvent(ev) {
    const pendentes = [];
    let n = this;
    let ultimo = this;
    while (n) {
      for (const fn of (n._ouvintes.get(ev.type) || [])) pendentes.push(fn.call(n, ev));
      ultimo = n;
      n = n.parentNode;
    }
    const doc = ultimo && ultimo.__documento;
    if (doc) for (const fn of (doc._ouvintes.get(ev.type) || [])) pendentes.push(fn.call(doc, ev));
    return Promise.all(pendentes.filter((p) => p && typeof p.then === 'function'));
  }
  /**
   * Devolve promise: os handlers do painel são async e o teste precisa esperar.
   * O evento carrega `preventDefault`/`stopPropagation` porque o browser carrega — sem
   * eles, um handler perfeitamente normal explode só aqui, e o teste vira ruído.
   */
  click() {
    const ev = {
      type: 'click',
      target: this,
      defaultPrevented: false,
      preventDefault() { ev.defaultPrevented = true; },
      stopPropagation() { ev.propagacaoParada = true; },
    };
    return this.dispatchEvent(ev);
  }
  focus() {}
}

// ── seletores ──────────────────────────────────────────────────────────────────
function partir(sel) {
  const s = String(sel).trim();
  if (/[\s>+~]/.test(s.replace(/\[[^\]]*\]/g, '').replace(/:not\([^)]*\)/g, ''))) {
    throw new Error('mini-dom: seletor com combinador não suportado: ' + sel);
  }
  const partes = [];
  const re = /(:not\([^)]*\))|(\[[^\]]*\])|(\.[^.#[\]:]+)|(#[^.#[\]:]+)|([a-zA-Z][\w-]*)/g;
  let m;
  while ((m = re.exec(s))) partes.push(m[0]);
  return partes;
}

function casaParte(no, parte) {
  if (parte.indexOf(':not(') === 0) return !casa(no, parte.slice(5, -1));
  if (parte[0] === '.') return no.classList.contains(parte.slice(1));
  if (parte[0] === '#') return no.id === parte.slice(1);
  if (parte[0] === '[') {
    const m = /^\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(parte);
    if (!m) throw new Error('mini-dom: atributo não entendido: ' + parte);
    if (m[2] === undefined) return no.hasAttribute(m[1]);
    return no.getAttribute(m[1]) === m[2];
  }
  return no.tagName === parte.toUpperCase();
}

function casa(no, sel) {
  if (!no || no.tagName === '#TEXT') return false;
  return partir(sel).every((p) => casaParte(no, p));
}

// ── parser ─────────────────────────────────────────────────────────────────────
const RE_TAG = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

function lerAtributos(bruto, no) {
  const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(bruto || ''))) {
    const valor = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
    no.setAttribute(m[1], decodificar(valor));
  }
}

function parseFragmento(html) {
  const raiz = new No('#root');
  let atual = raiz;
  let pos = 0;
  RE_TAG.lastIndex = 0;
  let m;
  const texto = (t) => {
    if (!t) return;
    const n = new No('#TEXT');
    n.texto = decodificar(t);
    atual.appendChild(n);
  };
  while ((m = RE_TAG.exec(html))) {
    texto(html.slice(pos, m.index));
    pos = m.index + m[0].length;
    const [, fecha, tag, attrs, autofecha] = m;
    if (fecha) {
      let n = atual;
      while (n !== raiz && n.tagName !== tag.toUpperCase()) n = n.parentNode;
      if (n !== raiz) atual = n.parentNode || raiz;
      continue;
    }
    const no = new No(tag);
    lerAtributos(attrs, no);
    atual.appendChild(no);
    if (!autofecha && !VAZIAS.has(tag.toLowerCase())) atual = no;
  }
  texto(html.slice(pos));
  const filhos = raiz.children;
  for (const f of filhos) f.parentNode = null;
  return filhos;
}

function criarDocumento() {
  const reg = {};
  const body = new No('body');
  const doc = {
    readyState: 'complete',
    body,
    head: new No('head'),
    _reg: reg,
    _ouvintes: new Map(),
    getElementById(id) {
      if (!reg[id]) { const n = new No('div'); n.setAttribute('id', id); body.appendChild(n); reg[id] = n; }
      return reg[id];
    },
    createElement: (tag) => new No(tag),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    // Registra de verdade. Como no-op, ele engolia toda delegação feita no document — e
    // um botão ligado assim ficava morto sem nenhum teste perceber.
    addEventListener(tipo, fn) {
      if (!doc._ouvintes.has(tipo)) doc._ouvintes.set(tipo, []);
      doc._ouvintes.get(tipo).push(fn);
    },
    removeEventListener(tipo, fn) {
      const l = doc._ouvintes.get(tipo) || [];
      const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    },
    // Dispara no document: e o jeito de um modulo avisar outro na mesma pagina (o Agente
    // avisa o cartao do menu quando a cota muda). Sem isto, o aviso sumiria no teste.
    dispatchEvent(ev) {
      for (const fn of (doc._ouvintes.get(ev.type) || [])) fn.call(doc, ev);
      return true;
    },
  };
  body.__documento = doc;
  return doc;
}

module.exports = { No, criarDocumento, parseFragmento, casa, decodificar };
