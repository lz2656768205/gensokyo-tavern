'use strict';

/* ============================================================
   幻想乡酒馆 · Gensokyo Tavern
   单页应用：首页 / 角色馆 / 剧本馆 / 酒馆 / 设置 / 对话
   ============================================================ */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const App = {
  data: null,
  cfg: null,
  saves: [],
  view: 'home',
  chat: null,
  busy: false,
  abort: null,
  suggestions: [],
  castIndex: new Map(),
  scenario: null,
  filters: { q: '', charSeries: '全部', scSeries: '全部' },
  prefs: { tts: true, voice: '', rate: 1, pitch: 1 },
  returnTo: 'home',
  scrollPos: 0,
};

/* ------------------------------------------------------------ 工具 */
function api(path, opts = {}) {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts }).then(async (r) => {
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { error: txt }; }
    if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
    return data;
  });
}

function toast(msg, kind = '') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; el.style.transition = '.25s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

function fmtTime(ts) {
  const d = new Date((ts || Date.now() / 1000) * 1000);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function fmtAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  return Math.floor(diff / 86400) + ' 天前';
}
function avatar(card) { return card ? card.avatar : 'assets/avatars/HakureiReimu.svg'; }
function charById(id) { return App.castIndex.get(id) || null; }
function scenarioById(id) { return (App.data.scenarios || []).find((s) => s.id === id); }
function actName(a) { return a ? (a.title || '').replace(/^第[一二三四五六七八九十0-9]+幕[·・]\s*/, '') : '尾声'; }
function allCharacters() { return (App.data.characters || []).concat(App.data.vocaloid || []); }

function setCast(ids) {
  App.castIndex = new Map(allCharacters().map((c) => [c.id, c]));
  App.chatCast = (ids || []).map((i) => App.castIndex.get(i)).filter(Boolean);
}

function buildCastIndex() {
  App.castIndex = new Map(allCharacters().map((c) => [c.id, c]));
}

/* ------------------------------------------------------------ 启动 */
async function boot() {
  try {
    const data = await api('/api/bootstrap');
    App.data = data;
    App.cfg = data.config;
    App.saves = data.saves || [];
    buildCastIndex();
    App.prefs = Object.assign(App.prefs, store.get('gt.prefs', {}));
    App.ui = store.get('gt.ui', { onboarded: false });
    const params = new URLSearchParams(location.search);
    const deepSave = params.get('save');
    if (deepSave) {
      try {
        const rec = await api('/api/saves/' + encodeURIComponent(deepSave));
        if (rec && rec.state) {
          App.chat = rec.state;
          App.chatCast = (App.chat.characterIds || []).map((i) => charById(i)).filter(Boolean);
          App.scenario = scenarioById(App.chat.scenarioId);
          App.returnTo = 'tavern';
          if (!location.hash || location.hash === '#/home') location.hash = '#/chat';
        }
      } catch (e) { console.warn('load save failed', e); }
    }
    renderShell();
    window.addEventListener('hashchange', route);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('submit', onSubmit);
    window.addEventListener('error', (e) => console.error(e.error || e.message));
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener?.('voiceschanged', () => { if (App.view === 'settings') fillSettings(); });
    }
    await route();
    if (params.get('char')) setTimeout(() => openCharacter(params.get('char')), 600);
    if (params.get('scenario')) setTimeout(() => openScenario(params.get('scenario')), 600);
    if (params.get('start')) setTimeout(() => startChat({ scenarioId: params.get('start') }), 150);
    if (params.get('chat')) setTimeout(() => startChat({ characterIds: [params.get('chat')] }), 150);
    if (!App.ui.onboarded && !location.search.includes('skiponboard')) setTimeout(showOnboarding, 700);
  } catch (e) {
    $('#app').innerHTML = `<div class="boot-screen"><div class="boot-title">灯笼没点着</div>
      <div class="boot-sub" style="max-width:460px;line-height:1.8">${esc(e.message)}<br><br>
      请确认在 GensokyoTavern 目录运行了 <code>python server.py</code>，然后刷新页面。</div></div>`;
  }
}

/* ------------------------------------------------------------ 骨架 */
function navItems() {
  return [
    ['home', 'home', '首页'],
    ['characters', 'users', '角色馆'],
    ['scenarios', 'book', '剧本馆'],
    ['tavern', 'chat', '酒馆'],
    ['settings', 'settings', '设置'],
  ];
}

function renderShell() {
  const nav = navItems().map(([id, ic, label]) => `<a class="nav-item" href="#/${id}" data-nav="${id}">${icon(ic)}<span>${label}</span></a>`).join('');
  $('#app').className = '';
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="rail">
      <a class="brand" href="#/home">
        <div class="brand-seal">幻想</div>
        <div><div class="brand-name">幻想乡酒馆</div><div class="brand-sub">Gensokyo Tavern</div></div>
      </a>
      <nav class="nav">${nav}<a class="nav-item" href="#/map" data-nav="map">${icon('map')}<span>幻想乡地图</span></a></nav>
      <div class="rail-spacer"></div>
      <div class="rail-card" id="rail-status">
        <div><span class="status-dot ${App.cfg && App.cfg.has_key ? '' : 'off'}" id="status-dot"></span><b id="status-text">${App.cfg && App.cfg.has_key ? 'AI 已连接' : '离线演示'}</b></div>
        <div style="margin-top:5px">${App.cfg && App.cfg.has_key ? esc(App.cfg.model) : '配置 API Key 后开启自由对话'}</div>
      </div>
      <div class="rail-ver">v${esc(App.data.version)} · ${allCharacters().length} 角色 · ${App.data.scenarios.length} 剧本</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <a class="brand" href="#/home"><div class="brand-seal">幻想</div><div><div class="brand-name">幻想乡酒馆</div></div></a>
        <a class="btn-icon btn-ghost" href="#/map" title="幻想乡地图">${icon('map')}</a>
        <button class="btn-icon btn-ghost" data-action="quick-settings">${icon('settings')}</button>
      </header>
      <div class="view" id="view"></div>
    </div>
    <nav class="tabbar">
      ${navItems().map(([id, ic, label]) => `<button data-nav="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}
    </nav>
  </div>`;
  updateStatus();
}

function updateStatus() {
  const on = App.cfg && App.cfg.has_key;
  const dot = $('#status-dot'); const txt = $('#status-text');
  if (dot) dot.className = 'status-dot ' + (on ? '' : 'off');
  if (txt) txt.textContent = on ? 'AI 已连接' : '离线演示';
  const card = $('#rail-status');
  if (card) card.querySelector('div:last-child').textContent = on ? (App.cfg.model || '') : '配置 API Key 后开启自由对话';
}

function highlightNav() {
  $$('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === App.view));
}

async function route() {
  const h = (location.hash || '#/home').replace(/^#\/?/, '');
  const [view, arg] = h.split('/');
  App.view = view || 'home';
  document.body.classList.toggle('in-chat', App.view === 'chat');
  if (App.view === 'chat') {
    if (!App.chat) {
      const saved = store.get('gt.current', null);
      if (saved && saved.messages) App.chat = saved; else { location.hash = '#/tavern'; return; }
    }
    renderChat();
  } else {
    if (App.view !== 'tavern') App.scrollPos = window.scrollY;
    renderView();
  }
  highlightNav();
  window.scrollTo({ top: 0 });
}

function renderView() {
  const v = $('#view');
  if (App.view === 'characters') v.innerHTML = viewCharacters();
  else if (App.view === 'scenarios') v.innerHTML = viewScenarios();
  else if (App.view === 'map') v.innerHTML = viewMap();
  else if (App.view === 'tavern') v.innerHTML = viewTavern();
  else if (App.view === 'settings') v.innerHTML = viewSettings();
  else v.innerHTML = viewHome();
  if (App.view === 'map') mapSelect(App.mapSelected || 'Home', false);
  if (App.view === 'settings') fillSettings();
  if (App.view === 'characters') {
    const input = $('#char-search');
    if (input) {
      input.value = App.filters.q;
      let timer = null;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          App.filters.q = input.value;
          const pos = input.selectionStart;
          renderView();
          const next = $('#char-search');
          if (next) { next.focus(); next.setSelectionRange(pos, pos); }
        }, 180);
      });
    }
  }
}

/* ------------------------------------------------------------ 首页 */
function viewHome() {
  const chars = allCharacters();
  const scs = App.data.scenarios;
  const featuredSc = ['scarlet_mist', 'night_market', 'spring_snow', 'gensokyo_live'].map((id) => scenarioById(id)).filter(Boolean);
  const featuredChars = ['HakureiReimu', 'KirisameMarisa', 'MystiaLorelei', 'WriggleNightbug', 'PatchouliKnowledge', 'SaigyoujiYuyuko', 'hatsune_miku', 'kasane_teto'].map((id) => charById(id)).filter(Boolean);
  const recent = App.saves.slice(0, 3);
  return `
  <div class="page wide">
    <section class="hero">
      <div class="hero-vertical">月が綺麗ですね · 今夜、物語が始まる</div>
      <div class="hero-inner">
        <div class="hero-kicker">Gensokyo Tavern · AI Roleplay</div>
        <h1>今夜，推开<br><span>幻想乡</span>的门</h1>
        <p>${chars.length} 张角色卡、${scs.length} 部可玩剧本。和灵梦在神社喝茶，去夜雀食堂帮米斯蒂娅打烊，或者陪初音把一句副歌唱到天亮。角色会记住你说过的话。</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/scenarios">${icon('book')}选一部剧本</a>
          <a class="btn" href="#/characters">${icon('users')}逛逛角色馆</a>
          <a class="btn" href="#/map">${icon('map')}看幻想乡地图</a>
          <button class="btn btn-ghost" data-action="random-chat">${icon('sparkles')}随缘遇见一位</button>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><b>${chars.length}</b><span>角色卡</span></div>
          <div class="hero-stat"><b>${scs.length}</b><span>剧本</span></div>
          <div class="hero-stat"><b>${App.data.lore.length}</b><span>世界观词条</span></div>
          <div class="hero-stat"><b>∞</b><span>种走法</span></div>
        </div>
      </div>
    </section>

    ${recent.length ? `<div class="section-head"><h2 class="section">继续昨晚的故事</h2><a class="hint" href="#/tavern">全部存档 →</a></div>
      <div class="session-list">${recent.map((s) => sessionCard(s)).join('')}</div>` : ''}

    <div class="section-head"><h2 class="section">今夜推荐</h2><span class="hint">每一部都有分幕、暗线与结局</span></div>
    <div class="grid scenario-grid">${featuredSc.map(scCard).join('')}</div>

    <div class="section-head"><h2 class="section">常客</h2><a class="hint" href="#/characters">全部角色 →</a></div>
    <div class="grid char-grid">${featuredChars.map(charCard).join('')}</div>

    <div class="section-head"><h2 class="section">怎么玩</h2><span class="hint">没有 API Key 也能先看剧本</span></div>
    <div class="quick-row">
      <div class="quick-card"><div class="q-ic">${icon('book')}</div><div><b>挑一部剧本</b><span>分幕推进，有目标、有转折、有结局</span></div></div>
      <div class="quick-card"><div class="q-ic">${icon('brain')}</div><div><b>角色稳定引擎</b><span>人格分层 + 世界观检索 + 记忆 + OOC 纠偏</span></div></div>
      <div class="quick-card"><div class="q-ic">${icon('chat')}</div><div><b>像聊天一样演</b><span>说你想说的，角色会自己接下去</span></div></div>
    </div>
    <div class="mini-note" style="margin-top:18px">角色卡来自 F:\\幻想乡剧本 的 GensokyoAI 角色设定与检索整理；歌姬卡参考 roleplayst / chub.ai / 官方设定重写；剧本为同人再创作，非商业用途。</div>
  </div>`;
}

function charCard(c) {
  const isVocal = c.series === 'VOCALOID';
  return `<button class="char-card" data-action="open-char" data-id="${esc(c.id)}">
    <img src="${esc(avatar(c))}" alt="${esc(c.name)}" loading="lazy">
    <span class="cc-badge ${isVocal ? 'vocal' : ''}">${isVocal ? 'VOCALOID' : esc(c.faction || '幻想乡')}</span>
    <div class="cc-body">
      <div class="cc-name">${esc(c.name).replace(/·/g, '·<wbr>')}</div>
      <div class="cc-title">${esc(c.summary || '')}</div>
      <div class="cc-tags">${(c.tags || []).slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    </div>
  </button>`;
}

function scCard(s) {
  const cast = (s.characters || []).map((id) => charById(id)).filter(Boolean);
  return `<button class="scenario-card" data-action="open-scenario" data-id="${esc(s.id)}">
    <div class="sc-cover">
      <img src="${esc(s.cover)}" alt="${esc(s.title)}" loading="lazy">
      <span class="sc-series">${esc(s.series)}</span>
      <span class="sc-time">${esc(s.difficulty)} · ${esc(s.duration)}</span>
    </div>
    <div class="sc-body">
      <div class="sc-title">${esc(s.title)}</div>
      <div class="sc-sub">${esc(s.subtitle)}</div>
      <div class="sc-tags">${(s.tags || []).slice(0, 3).map((t, i) => `<span class="tag ${i === 0 ? '' : 'plain'}">${esc(t)}</span>`).join('')}</div>
      <div class="sc-meta">
        <div class="sc-cast">${cast.slice(0, 5).map((c) => `<img src="${esc(avatar(c))}" alt="${esc(c.name)}" title="${esc(c.name)}">`).join('')}<span>${cast.length} 位角色</span></div>
        <span class="small gold">进入 →</span>
      </div>
    </div>
  </button>`;
}

/* ------------------------------------------------------------ 角色馆 */
function viewCharacters() {
  const q = App.filters.q.trim().toLowerCase();
  let list = allCharacters();
  if (App.filters.charSeries !== '全部') list = list.filter((c) => c.series === App.filters.charSeries);
  if (q) {
    list = list.filter((c) => [c.name, c.name_en, c.title, c.faction, c.summary, ...(c.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  const series = ['全部', '东方Project', 'VOCALOID'];
  return `<div class="page">
    <div class="page-head">
      <div><div class="eyebrow">Character Gallery</div><h1 class="display">角色馆</h1>
        <p class="lead" style="margin-top:10px">${allCharacters().length} 位角色：东方 Project 住民、声之都歌姬，以及《东方夜雀食堂》的新常客。点开可以读完整角色卡，也可以直接开口。</p></div>
      <div class="result-count">${list.length} / ${allCharacters().length} 位</div>
    </div>
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="char-search" placeholder="搜索名字、称号、种族…" value="${esc(App.filters.q)}"></div>
      <div class="chip-row">${series.map((s) => `<button class="chip ${App.filters.charSeries === s ? 'active' : ''}" data-action="filter-series" data-value="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    </div>
    <div class="grid char-grid">${list.map(charCard).join('')}</div>
    ${list.length ? '' : '<div class="empty-state"><div class="es-ic">' + icon('search') + '</div>没有找到这位住民。换个词试试？</div>'}
  </div>`;
}

/* ------------------------------------------------------------ 剧本馆 */
function viewScenarios() {
  let list = App.data.scenarios;
  if (App.filters.scSeries !== '全部') list = list.filter((s) => s.series === App.filters.scSeries);
  const series = ['全部', '东方Project', 'VOCALOID', '联动'];
  return `<div class="page">
    <div class="page-head">
      <div><div class="eyebrow">Scenario Library</div><h1 class="display">剧本馆</h1>
        <p class="lead" style="margin-top:10px">不是提示词合集，而是有分幕、有目标、有暗线、有结局的剧本。你可以按自己的方式演，也可以让故事推着你走。</p></div>
      <div class="result-count">${list.length} 部可玩</div>
    </div>
    <div class="chip-row" style="margin-bottom:22px">${series.map((s) => `<button class="chip ${App.filters.scSeries === s ? 'active' : ''}" data-action="filter-sc-series" data-value="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div class="grid scenario-grid">${list.map(scCard).join('')}</div>
  </div>`;
}

/* ------------------------------------------------------------ 地图 */
function mapColor(type) {
  return ({
    home: '#e0a45f', path: '#b08a5a', village: '#c9a35f', shrine: '#d35b4a',
    mansion: '#b03a3a', forest: '#5f9e6a', mountain: '#8f7a5f', underground: '#8f5fa8',
    lake: '#5f8fc9', temple: '#5fa89e', mausoleum: '#9e7fbf', field: '#c9b04f',
    castle: '#6f8fd3', moon: '#b9c4d8', makai: '#b05f8f', stage: '#c96f8f', other: '#c98f9e',
  })[type] || '#b9a48a';
}

function viewMap() {
  const map = App.data.map || { nodes: [], edges: [] };
  const nodes = map.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = (map.edges || []).map(([a, b]) => [byId.get(a), byId.get(b)]).filter(([a, b]) => a && b);
  const glyph = (n) => n.name.slice(0, 1);
  const svg = `<svg class="map-svg" viewBox="0 0 1000 920" role="img" aria-label="幻想乡地图">
    <defs>
      <radialGradient id="mapbg" cx="0.5" cy="0.4" r="0.8">
        <stop offset="0" stop-color="#2b2118"/><stop offset="0.65" stop-color="#1a1410"/><stop offset="1" stop-color="#0e0b09"/>
      </radialGradient>
      <pattern id="mapgrain" width="26" height="26" patternUnits="userSpaceOnUse">
        <path d="M0 26 Q13 10 26 26" fill="none" stroke="#e8d9c8" stroke-opacity="0.05"/>
      </pattern>
      <filter id="mapglow"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1000" height="920" fill="url(#mapbg)"/>
    <rect width="1000" height="920" fill="url(#mapgrain)"/>
    <g stroke="#c9a35f" stroke-opacity="0.26" stroke-width="2" stroke-dasharray="3 8" fill="none">
      ${edges.map(([a, b]) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`).join('')}
    </g>
    ${nodes.map((n) => {
      const col = mapColor(n.type);
      return `<g class="map-node" data-action="map-node" data-id="${esc(n.id)}" tabindex="0">
        <circle cx="${n.x}" cy="${n.y}" r="30" fill="${col}" opacity="0.12"/>
        <circle cx="${n.x}" cy="${n.y}" r="15" fill="${col}" opacity="0.9" stroke="#f6e6d8" stroke-opacity="0.5"/>
        <text x="${n.x}" y="${n.y + 5}" text-anchor="middle" class="map-node-glyph">${esc(glyph(n))}</text>
        <text x="${n.x}" y="${n.y + 36}" text-anchor="middle" class="map-node-label">${esc(n.name)}</text>
      </g>`;
    }).join('')}
    <text x="40" y="880" class="map-compass">幻想郷 · 夜雀食堂見聞録</text>
  </svg>`;
  return `<div class="page map-page">
    <div class="page-head">
      <div><div class="eyebrow">Gensokyo Map</div><h1 class="display">幻想乡地图</h1>
        <p class="lead" style="margin-top:10px">据《东方夜雀食堂》的场景与路线整理。点一处地名，看看那里住着谁、夜里是什么样子。</p></div>
      <div class="chip-row">
        <a class="btn btn-primary" href="#/scenarios">${icon('book')}去剧本馆</a>
        <button class="btn" data-action="start-chat-scenario" data-id="night_market">${icon('play')}夜雀食堂·今夜营业</button>
      </div>
    </div>
    <div class="map-layout">
      <div class="map-canvas">${svg}</div>
      <aside class="map-detail" id="map-detail"></aside>
    </div>
    <div class="section-head"><h2 class="section">地点</h2><span class="hint">${nodes.length} 处 · 点击查看</span></div>
    <div class="region-grid">
      ${nodes.map((n) => `<button class="region-card" data-action="map-node" data-id="${esc(n.id)}">
        <span class="region-dot" style="background:${mapColor(n.type)}"></span>
        <b>${esc(n.name)}</b>
        <span>${esc(n.title || '')}</span>
      </button>`).join('')}
    </div>
    <div class="mini-note" style="margin-top:16px">地图为示意，坐标不是游戏内坐标；地点描述来自游戏内 DaySceneMapLang 文本。</div>
  </div>`;
}

function mapSelect(id, scroll = true) {
  const map = App.data.map || { nodes: [] };
  const node = (map.nodes || []).find((n) => n.id === id) || (map.nodes || [])[0];
  if (!node) return;
  App.mapSelected = node.id;
  $$('.map-node').forEach((el) => el.classList.toggle('active', el.dataset.id === node.id));
  const detail = $('#map-detail');
  if (!detail) return;
  const chars = (node.characters || []).map((i) => charById(i)).filter(Boolean);
  detail.innerHTML = `<div class="map-detail-inner">
    <div class="eyebrow">${esc(node.title || '地点')}</div>
    <h2 class="display" style="font-size:30px">${esc(node.name)}</h2>
    <p class="m-text" style="margin:12px 0 18px">${esc(node.description || '这里还没有留下详细的记述。')}</p>
    ${chars.length ? `<div class="m-label">这里的人</div><div class="chip-row" style="margin-bottom:16px">
      ${chars.map((c) => `<button class="chip" data-action="open-char" data-id="${esc(c.id)}"><img src="${esc(avatar(c))}" style="width:20px;height:20px;border-radius:50%">${esc(c.name)}</button>`).join('')}
    </div>` : ''}
    <div class="tip-card" style="margin-top:8px">${icon('info', 'sm')} 夜雀食堂的营业路线：夜雀小屋（准备）→ 妖怪兽道（出摊）→ 人间之里 / 博丽神社 / 红魔馆 / 地灵殿……</div>
    ${chars[0] ? `<button class="btn btn-primary" style="margin-top:12px" data-action="map-chat" data-id="${esc(chars[0].id)}">${icon('chat')}和${esc(chars[0].name)}聊聊</button>` : ''}
  </div>`;
  if (scroll) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ------------------------------------------------------------ 酒馆 */
function viewTavern() {
  const saves = App.saves || [];
  return `<div class="page">
    <div class="page-head">
      <div><div class="eyebrow">Tavern</div><h1 class="display">酒馆</h1>
        <p class="lead" style="margin-top:10px">存下来的故事都在这里。服务器存档写在 data/saves，换台机器也能带走。</p></div>
      <div class="chip-row"><button class="btn btn-primary" data-action="random-chat">${icon('sparkles')}开始新的邂逅</button></div>
    </div>
    ${saves.length ? `<div class="session-list">${saves.map((s) => sessionCard(s)).join('')}</div>` : `<div class="empty-state"><div class="es-ic">${icon('moon')}</div>酒馆还空着。<br>去角色馆找个人聊聊，或挑一部剧本。</div>`}
  </div>`;
}

function sessionCard(s) {
  const cards = (s.character_ids || []).map((id) => charById(id)).filter(Boolean);
  const sc = s.scenario_id ? scenarioById(s.scenario_id) : null;
  const title = sc ? sc.title : (cards[0] ? cards[0].name : s.title);
  return `<div class="session-card">
    <div class="session-avatars">${cards.slice(0, 3).map((c) => `<img src="${esc(avatar(c))}" alt="">`).join('')}</div>
    <div class="session-main"><b>${esc(title)}</b><span>${sc ? '剧本' : '自由对话'} · ${s.turns || 0} 轮 · ${fmtAgo(s.updated_at)}</span></div>
    <button class="btn btn-sm" data-action="load-save" data-id="${esc(s.id)}">继续</button>
    <button class="btn btn-sm btn-ghost" data-action="delete-save" data-id="${esc(s.id)}">${icon('trash', 'sm')}</button>
  </div>`;
}

/* ------------------------------------------------------------ 角色详情 */
function openCharacter(id) {
  const c = charById(id);
  if (!c) return;
  const isVocal = c.series === 'VOCALOID';
  const ex = (c.example_dialogue || []).slice(0, 3).map((e) => `<div class="example"><div class="ex-u">玩家：${esc(e.user)}</div><div class="ex-a">${esc(e.assistant)}</div></div>`).join('');
  const related = App.data.scenarios.filter((s) => (s.characters || []).includes(id)).slice(0, 4);
  const nm = c.nightmarket;
  const nmRole = nm ? (nm.role || '常客').replace('夜雀食堂', '').replace(/^[ /·]+/, '') : '';
  const nmHTML = nm ? `<div class="m-section nm-card">
      <div class="m-label">夜雀食堂 · ${esc(nmRole)}</div>
      <div class="nm-meta">
        <span>${icon('map', 'sm')}${esc(nm.location || c.location || '幻想乡')}</span>
        ${nm.bond ? `<span>羁绊 ${esc(nm.bond)}</span>` : ''}
        ${nm.price ? `<span>${esc(nm.price)}</span>` : ''}
      </div>
      <div class="m-text" style="margin-top:10px">${(nm.profile || []).map((p) => `<p style="margin:0 0 8px">${esc(p)}</p>`).join('')}</div>
      ${(nm.likes || []).length || (nm.dislikes || []).length || (nm.drinks || []).length ? `<div class="nm-tags">
        ${(nm.likes || []).map((t) => `<span class="nm-like">喜欢 · ${esc(t)}</span>`).join('')}
        ${(nm.dislikes || []).map((t) => `<span class="nm-dislike">不喜 · ${esc(t)}</span>`).join('')}
        ${(nm.drinks || []).map((t) => `<span class="nm-drink">${esc(t)}</span>`).join('')}
      </div>` : ''}
      ${(nm.snippets || []).length ? `<div class="nm-quotes">${nm.snippets.map((q) => `<div>「${esc(q)}」</div>`).join('')}</div>` : ''}
    </div>` : '';
  openModal(`
    <div class="modal-head">
      <div class="m-art"><img src="${esc(avatar(c))}" alt="${esc(c.name)}"></div>
      <div>
        <div class="tag ${isVocal ? 'vocal' : ''}">${esc(c.series)} · ${esc(c.faction || '')}</div>
        <h2>${esc(c.name)}</h2>
        <div class="m-title">${esc(c.title || '')}</div>
      </div>
      <button class="btn-icon btn-ghost modal-close" data-action="close-modal">${icon('x')}</button>
    </div>
    <div class="modal-body">
      <div class="m-section"><div class="m-label">速写</div><div class="m-text">${esc(c.summary || '')}</div></div>
      <div class="m-section"><div class="kv">
        <div>种族 / 身份<b>${esc(c.species || '—')}</b></div>
        <div>能力<b>${esc(c.ability || '—')}</b></div>
        <div>居所<b>${esc(c.location || '—')}</b></div>
        <div>年龄<b>${esc(c.age || '—')}</b></div>
        <div>代表色<b>${esc(c.theme_color || '—')}</b></div>
        <div>出处<b>${esc(c.source || '')}</b></div>
      </div></div>
      <div class="m-section"><div class="m-label">性格</div><ul class="bullet-list">${(c.personality || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      ${nmHTML}
      <div class="m-section"><div class="m-label">说话方式</div><ul class="bullet-list">${(c.speech_style || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      ${(c.relationships || []).length ? `<div class="m-section"><div class="m-label">关系</div><ul class="bullet-list">${c.relationships.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${ex ? `<div class="m-section"><div class="m-label">台词示例</div><div class="examples">${ex}</div></div>` : ''}
      ${related.length ? `<div class="m-section"><div class="m-label">适合的剧本</div><div class="chip-row">${related.map((s) => `<button class="chip" data-action="open-scenario" data-id="${esc(s.id)}">${esc(s.title)}</button>`).join('')}</div></div>` : ''}
      <div class="m-section"><div class="m-label">开场白</div><div class="example"><div class="ex-a">${esc(c.greeting || '')}</div></div></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-action="close-modal">先看看</button>
      <button class="btn" data-action="start-chat-char" data-id="${esc(c.id)}">${icon('chat')}自由对话</button>
      <button class="btn btn-primary" data-action="char-scenarios" data-id="${esc(c.id)}">${icon('book')}进入剧本</button>
    </div>`);
}

/* ------------------------------------------------------------ 剧本详情 */
function openScenario(id) {
  const s = scenarioById(id);
  if (!s) return;
  const cast = (s.characters || []).map((cid) => charById(cid)).filter(Boolean);
  openModal(`
    <div class="modal-head">
      <div class="m-art" style="width:150px;height:96px"><img src="${esc(s.cover)}" alt=""></div>
      <div style="flex:1;min-width:0">
        <div class="tag">${esc(s.series)} · ${esc(s.difficulty)}</div>
        <h2 style="font-size:26px">${esc(s.title)}</h2>
        <div class="m-title">${esc(s.subtitle)}</div>
      </div>
      <button class="btn-icon btn-ghost modal-close" data-action="close-modal">${icon('x')}</button>
    </div>
    <div class="modal-body">
      <div class="m-section"><div class="m-text">${esc(s.premise)}</div></div>
      <div class="m-section"><div class="m-label">你的身份</div><div class="m-text">${esc(s.player_role)}</div>
        <div class="mini-note">目标：${esc(s.player_goal || '')}</div></div>
      <div class="m-section"><div class="m-label">登场角色（${cast.length}）</div>
        <div class="chip-row">${cast.map((c) => `<button class="chip" data-action="open-char" data-id="${esc(c.id)}"><img src="${esc(avatar(c))}" style="width:20px;height:20px;border-radius:50%">${esc(c.name)}</button>`).join('')}</div></div>
      <div class="m-section"><div class="m-label">分幕</div><div class="acts">
        ${s.acts.map((a, i) => `<div class="act-item"><b>${i + 1}. ${esc(a.title)}</b><p>${esc(a.goal)}</p><div class="beat">${esc((a.beats || []).slice(0, 3).join(' / '))}</div></div>`).join('')}
      </div></div>
      <div class="m-section"><div class="m-label">规则</div><ul class="bullet-list">${(s.world_rules || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="m-section"><div class="m-label">可能抵达的结局</div><div class="endings">
        ${(s.endings || []).map((e) => `<div class="ending-item"><b>${esc(e.title)}</b><p>${esc(e.condition)}</p></div>`).join('')}
      </div></div>
      ${(s.inspiration || []).length ? `<div class="mini-note">考据来源：${s.inspiration.map((u) => {
        try { const host = new URL(u).hostname; return `<a href="${esc(u)}" target="_blank" rel="noreferrer" style="text-decoration:underline">${esc(host)}</a>`; }
        catch { return `<span>${esc(u)}</span>`; }
      }).join(' · ')}</div>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-action="close-modal">再想想</button>
      <button class="btn btn-primary" data-action="start-chat-scenario" data-id="${esc(s.id)}">${icon('play')}进入剧本</button>
    </div>`, { wide: true });
}

function openCharScenarios(id) {
  const c = charById(id);
  const list = App.data.scenarios.filter((s) => (s.characters || []).includes(id));
  openModal(`<div class="modal-head"><div><div class="tag">选择剧本</div><h2>和${esc(c.name)}演哪一出？</h2></div>
    <button class="btn-icon btn-ghost modal-close" data-action="close-modal">${icon('x')}</button></div>
    <div class="modal-body"><div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
    ${list.map((s) => `<button class="scenario-card" data-action="start-chat-scenario" data-id="${esc(s.id)}">
      <div class="sc-cover"><img src="${esc(s.cover)}" alt=""><span class="sc-series">${esc(s.series)}</span></div>
      <div class="sc-body"><div class="sc-title" style="font-size:16px">${esc(s.title)}</div><div class="sc-sub">${esc(s.subtitle)}</div></div>
    </button>`).join('')}
    ${list.length ? '' : '<div class="empty-state">这位角色还没有专属剧本，先自由对话吧。</div>'}
    </div></div>`, { narrow: true });
}

/* ------------------------------------------------------------ 对话 */
function startChat({ characterIds, scenarioId, loadState }) {
  if (loadState) {
    App.chat = loadState;
    App.chatCast = (loadState.characterIds || []).map((i) => charById(i)).filter(Boolean);
    App.scenario = scenarioById(loadState.scenarioId);
    App.returnTo = 'tavern';
    location.hash = '#/chat';
    return;
  }
  const sc = scenarioById(scenarioId);
  const ids = (characterIds && characterIds.length) ? characterIds : (sc ? sc.characters : []);
  const persona = sc && sc.player_persona ? { ...sc.player_persona } : defaultPersona();
  App.chat = {
    id: uid(),
    mode: sc ? 'scenario' : 'character',
    characterIds: ids,
    scenarioId: sc ? sc.id : '',
    actIndex: 0,
    messages: [],
    memory: { summary: '', facts: [], relations: {} },
    stats: sc && sc.stats ? sc.stats.map((s) => ({ ...s, value: s.initial })) : [],
    persona,
    title: sc ? sc.title : (charById(ids[0]) || {}).name || '新的故事',
    createdAt: Date.now(),
    turn: 0,
    ended: false,
  };
  App.chatCast = ids.map((i) => charById(i)).filter(Boolean);
  App.scenario = sc;
  App.returnTo = sc ? 'scenarios' : 'characters';
  store.set('gt.current', App.chat);
  if (location.hash === '#/chat') {
    App.view = 'chat';
    document.body.classList.add('in-chat');
    renderChat();
  } else {
    location.hash = '#/chat';
  }
  setTimeout(() => opening(), 80);
}

function defaultPersona() {
  return { name: '旅人', identity: '误入幻想乡的外界人', note: '对幻想乡的常识不太了解，但好奇心很重。' };
}

function castCards() {
  if (!App.chat) return [];
  return (App.chat.characterIds || []).map((i) => charById(i)).filter(Boolean);
}
function primaryCard() { return castCards()[0] || null; }

function chatTitle() {
  if (!App.chat) return '';
  const sc = App.scenario;
  if (sc) return sc.title;
  const cs = castCards();
  return cs.map((c) => c.name).join(' · ') || '自由对话';
}

function chatState({ history, userMessage, advance }) {
  const c = App.chat;
  return {
    mode: c.mode,
    character_ids: c.characterIds,
    scenario_id: c.scenarioId,
    act_index: c.actIndex,
    turn: c.turn || 0,
    history: history || [],
    user_message: userMessage || '',
    user: c.persona || {},
    memory: c.memory || {},
    stats: (c.stats || []).map((s) => ({ key: s.key, label: s.label, value: s.value, max: s.max })),
    strictness: App.cfg ? App.cfg.strictness : 2,
    advance: !!advance,
  };
}

function historyOf(messages) {
  return (messages || []).filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({
    role: m.role,
    content: m.role === 'assistant' ? (m.raw || m.text) : m.text,
    speaker: m.speaker || '',
  }));
}

function renderChat() {
  const c = App.chat;
  if (!c) { location.hash = '#/tavern'; return; }
  App.scenario = scenarioById(c.scenarioId);
  App.chatCast = (c.characterIds || []).map((i) => charById(i)).filter(Boolean);
  const cs = castCards();
  const sc = App.scenario;
  const act = sc ? sc.acts[c.actIndex] : null;
  const title = chatTitle();
  const sub = sc
    ? `${act ? actName(act) : '尾声'} · ${sc.location || ''}`
    : [cs[0] ? cs[0].title : '', (cs[0] && cs[0].location) || '幻想乡'].filter(Boolean).join(' · ');

  $('#view').innerHTML = `
  <div class="chat">
    <div class="chat-main">
      <div class="chat-head">
        <button class="btn-icon btn-ghost" data-action="back" title="返回">${icon('left')}</button>
        <div class="ch-avatars">${cs.slice(0, 3).map((x) => `<img src="${esc(avatar(x))}" alt="">`).join('')}</div>
        <div class="ch-meta"><div class="ch-name">${esc(title)}</div><div class="ch-sub">${esc(sub)}</div></div>
        <div class="ch-actions">
          <button class="btn-icon btn-ghost" data-action="side-toggle" title="角色与记忆">${icon('brain')}</button>
          <button class="btn-icon btn-ghost" data-action="save-chat" title="存档">${icon('download')}</button>
          <button class="btn-icon btn-ghost" data-action="quick-settings" title="设置">${icon('settings')}</button>
        </div>
      </div>
      <div class="chat-scene" id="chat-scene">${sceneBar()}</div>
      <div class="chat-log" id="chat-log"><div class="chat-log-inner" id="chat-log-inner">${messagesHTML()}</div></div>
      <div class="chat-bottom"><div class="chat-bottom-inner">
        <div class="suggest-row" id="suggest-row">${App.suggestions.map((s) => `<button class="suggest-chip" data-action="use-suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <div class="composer">
          <textarea id="composer" rows="1" placeholder="${App.cfg && App.cfg.has_key ? '说点什么…（Enter 发送）' : '离线演示中，说点什么…'}"></textarea>
          <div class="composer-bar">
            <button class="btn-icon btn-ghost sm" data-action="suggest" title="建议回复">${icon('sparkles', 'sm')}</button>
            <button class="btn-icon btn-ghost sm" data-action="narration" title="插入旁白">${icon('edit', 'sm')}</button>
            <span class="sep"></span>
            <span class="hint">${App.cfg && App.cfg.has_key ? esc(App.cfg.model) : '离线演示模式'}</span>
            <button class="send-btn" id="send-btn" data-action="send" title="发送">${icon('send')}</button>
          </div>
        </div>
        <div class="chat-note">${sc ? '剧本会自动记录进度；不满意可以重写，角色会保持人格' : '角色稳定引擎已开启：人格卡 · 世界观检索 · 记忆'} · 全年龄向</div>      </div></div>
    </div>
    <aside class="chat-side" id="chat-side">${sidePanel()}</aside>
  </div>`;
  const input = $('#composer');
  if (input) {
    input.addEventListener('input', () => autoGrow(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    setTimeout(() => input.focus(), 120);
  }
  scrollLog(true);
  setTimeout(() => scrollLog(true), 120);
  updateSendBtn();
}

function sceneBar() {
  const sc = App.scenario;
  const c = App.chat;
  if (!sc) {
    const cs = castCards();
    return `<span>${esc((cs[0] && cs[0].location) || '幻想乡')}</span><span class="dot"></span><span>${esc((cs[0] && cs[0].title) || '自由对话')}</span><span class="dot"></span><span>${esc(c.mode === 'character' ? '自由扮演' : '')}</span>`;
  }
  const act = sc.acts[c.actIndex] || sc.acts[sc.acts.length - 1];
  const stats = (c.stats || []).map((s) => `<span class="stat">${esc(s.label)} <b>${esc(s.value)}</b></span>`).join('');
  return `<span class="act-pill">第 ${c.actIndex + 1} / ${sc.acts.length} 幕</span>
    <span>${esc(act ? actName(act) : '尾声')}</span><span class="dot"></span><span class="loc">${esc(sc.location || '')}</span>
    ${stats}
    ${c.actIndex < sc.acts.length - 1 ? `<button class="btn btn-sm btn-ghost" style="margin-left:auto" data-action="advance">${icon('right', 'sm')}推进剧情</button>` : `<button class="btn btn-sm btn-ghost" style="margin-left:auto" data-action="finish">${icon('flag', 'sm')}收束故事</button>`}`;
}

function messagesHTML() {
  const c = App.chat;
  if (!c.messages.length) return `<div class="chat-empty"><div class="ce-moon"></div><h2>${esc(chatTitle())}</h2>
    <p>${esc(App.scenario ? App.scenario.subtitle : (primaryCard() ? primaryCard().summary : ''))}</p></div>`;
  return c.messages.map((m, i) => messageHTML(m, i)).join('');
}

function messageHTML(m, i) {
  if (m.role === 'system') return `<div class="msg system"><div class="sys-line">${esc(m.text)}</div></div>`;
  const isUser = m.role === 'user';
  const card = m.speaker ? charById(m.speaker) : null;
  const name = isUser ? (App.chat.persona && App.chat.persona.name) || '你' : (card ? card.name : '旁白');
  const avatarHTML = isUser
    ? `<div class="msg-avatar"><div class="user-av">${esc((name || '你')[0])}</div></div>`
    : (card ? `<div class="msg-avatar"><img src="${esc(avatar(card))}" alt=""></div>` : `<div class="msg-avatar"><div class="narr-av">旁</div></div>`);
  const body = isUser ? esc(m.text).replace(/\n/g, '<br>') : richHTML(m.text, m);
  const guard = m.guard ? guardBadge(m.guard) : '';
  return `<div class="msg ${isUser ? 'user' : ''} ${m.offline ? 'offline' : ''}" data-mid="${esc(m.id)}">
    ${avatarHTML}
    <div class="msg-body">
      <div class="msg-name">${esc(name)} <span class="time">${fmtTime(m.ts)}</span>${m.streaming ? ' <span class="typing"><i></i><i></i><i></i></span>' : ''}</div>
      <div class="msg-bubble" id="bubble-${esc(m.id)}">${body}</div>
      ${isUser ? '' : `<div class="msg-tools">
        ${App.prefs.tts ? `<button data-action="speak" data-id="${esc(m.id)}" title="朗读">${icon('volume', 'sm')}朗读</button>` : ''}
        <button data-action="copy" data-id="${esc(m.id)}" title="复制">${icon('copy', 'sm')}复制</button>
        <button data-action="regen" data-id="${esc(m.id)}" title="重写">${icon('refresh', 'sm')}重写</button>
        ${guard}
      </div>`}
    </div>
  </div>`;
}

function guardBadge(g) {
  const score = g.score || 0;
  if (!score) return `<span class="guard-badge" title="角色稳定">${icon('shield', 'sm')}稳定</span>`;
  const cls = score >= 0.6 ? 'bad' : 'warn';
  return `<button class="guard-badge ${cls}" data-action="guard-fix" title="${esc((g.issues || []).join(' / '))}">${icon('shield', 'sm')}${score >= 0.6 ? '可能出戏' : '轻微漂移'}</button>`;
}

function richHTML(text, m) {
  const cast = castCards();
  const names = new Set();
  cast.forEach((c) => { names.add(c.name); names.add(c.name.replace('·', '')); });
  if (m.speaker && charById(m.speaker)) names.add(charById(m.speaker).name);
  const parts = [];
  const re = /(「[^」]*」|（[^）]*）|\([^)]*\)|【[^】]*】)/g;
  let last = 0, match, currentSpeaker = m.speaker || '';
  const pushText = (t) => {
    if (!t) return;
    const clean = t.replace(/^\n+|\n+$/g, '');
    if (!clean.trim()) return;
    parts.push(`<span class="plain">${esc(clean).replace(/\n/g, '<br>')}</span>`);
  };
  while ((match = re.exec(text))) {
    pushText(text.slice(last, match.index));
    const tok = match[0];
    if (tok.startsWith('【')) {
      const inner = tok.slice(1, -1).trim();
      if (names.has(inner)) {
        currentSpeaker = inner;
        parts.push(`<span class="speaker-tag">${esc(inner)}</span>`);
      } else {
        parts.push(`<span class="narration">${esc(inner)}</span>`);
      }
    } else if (tok.startsWith('「')) {
      parts.push(`<span class="dialogue">${esc(tok)}</span>`);
    } else {
      parts.push(`<span class="action">${esc(tok)}</span>`);
    }
    last = re.lastIndex;
  }
  pushText(text.slice(last));
  return parts.join('') || esc(text);
}

function sidePanel() {
  const c = App.chat;
  const sc = App.scenario;
  const cs = castCards();
  const guard = lastGuard();
  const stability = Math.round((1 - (guard ? guard.score : 0)) * 100);
  return `
  <div class="side-card">
    <h4>角色稳定度</h4>
    <div class="guard-ring">
      <div class="ring" style="--v:${stability};--ring-color:${stability > 80 ? 'var(--ok)' : stability > 55 ? 'var(--gold)' : 'var(--danger)'}"><b>${stability}</b></div>
      <div class="guard-meta"><b>${stability > 80 ? '稳住了' : stability > 55 ? '有点漂' : '需要纠偏'}</b>人格 · 口吻 · 记忆<br>每轮自动检查</div>
    </div>
    ${guard && guard.issues && guard.issues.length ? `<div class="mini-note">${esc(guard.issues.join(' / '))} · <button data-action="guard-fix-last" style="color:var(--gold);text-decoration:underline">纠偏</button></div>` : ''}
  </div>
  <div class="side-card">
    <h4>在场</h4>
    ${cs.map((x) => `<div class="cast-item"><img src="${esc(avatar(x))}" alt=""><div><b>${esc(x.name)}</b><span>${esc(x.title || x.species || '')}</span></div></div>`).join('')}
  </div>
  ${sc ? `<div class="side-card"><h4>剧本进度</h4>
    <div class="big-serif">${esc(actName(sc.acts[c.actIndex]))}</div>
    <div class="mini-note">${esc((sc.acts[c.actIndex] || {}).goal || '故事已经走到最后。')}</div>
    <div class="stat-line" style="margin-top:12px"><span>进度</span><div class="bar"><i style="width:${Math.round(((c.actIndex + 1) / sc.acts.length) * 100)}%"></i></div><b>${c.actIndex + 1}/${sc.acts.length}</b></div>
    <div class="side-actions" style="margin-top:8px">
      ${c.actIndex < sc.acts.length - 1 ? `<button class="btn btn-sm" data-action="advance">推进剧情</button>` : `<button class="btn btn-sm" data-action="finish">收束故事</button>`}
      <button class="btn btn-sm" data-action="open-scenario-info">剧本详情</button>
    </div></div>` : ''}
  ${(c.stats || []).length ? `<div class="side-card"><h4>资源</h4>${c.stats.map((s) => statLine(s)).join('')}</div>` : ''}
  <div class="side-card"><h4>记忆</h4>
    <div class="memory-text">${esc(c.memory && c.memory.summary ? c.memory.summary : '还没有整理记忆。聊几轮之后，点"整理记忆"，角色会记住更久。')}</div>
    ${(c.memory && c.memory.facts || []).slice(0, 4).map((f) => `<div class="fact">${esc(f)}</div>`).join('')}
    <div class="side-actions" style="margin-top:10px">
      <button class="btn btn-sm" data-action="summarize">整理记忆</button>
      <button class="btn btn-sm" data-action="memory-edit">编辑</button>
    </div>
  </div>
  <div class="side-card"><h4>剧本工具</h4>
    <div class="side-actions">
      <button class="btn btn-sm" data-action="save-chat">保存进度</button>
      <button class="btn btn-sm" data-action="export-chat">导出对话</button>
      <button class="btn btn-sm" data-action="reload-save">重新读档</button>
      <button class="btn btn-sm" data-action="quick-settings">模型设置</button>
    </div>
  </div>`;
}

function statLine(s) {
  const pct = clamp((s.value / (s.max || 9)) * 100, 0, 100);
  return `<div class="stat-line"><span>${esc(s.label)}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${esc(s.value)}</b></div>`;
}

function lastGuard() {
  const c = App.chat;
  if (!c) return null;
  for (let i = c.messages.length - 1; i >= 0; i--) {
    if (c.messages[i].guard) return c.messages[i].guard;
  }
  return null;
}

/* ------------------------------------------------------------ 消息流 */
async function opening() {
  if (!App.chat || App.busy) return;
  App.busy = true;
  const msg = { id: uid(), role: 'assistant', text: '', raw: '', speaker: '', ts: Date.now() / 1000, streaming: true };
  App.chat.messages.push(msg);
  renderChat();
  updateSendBtn();
  try {
    await streamChat(chatState({ history: [], userMessage: '' }), msg);
  } catch (e) {
    msg.text = '【灯笼灭了】' + e.message;
    msg.streaming = false;
    updateMessage(msg);
  }
  App.busy = false;
  updateSendBtn();
  store.set('gt.current', App.chat);
}

async function streamChat(state, msg) {
  App.abort = new AbortController();
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
    signal: App.abort.signal,
  });
  if (!res.ok || !res.body) throw new Error('连接服务器失败（HTTP ' + res.status + '）');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let guard = null;
  const finish = () => {
    msg.streaming = false;
    if (!msg.text.trim()) msg.text = '【……（对方没有开口）】';
    parseAssistant(msg);
    if (guard) msg.guard = guard;
    updateMessage(msg);
    scrollLog();
    store.set('gt.current', App.chat);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, '\n');
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === 'delta') {
            msg.text += ev.text;
            msg.offline = ev.offline || msg.offline;
            updateStreamText(msg);
          } else if (ev.type === 'guard') {
            guard = ev.guard;
          } else if (ev.type === 'error') {
            throw new Error(ev.message);
          } else if (ev.type === 'done') {
            msg.offline = ev.offline || msg.offline;
          }
        }
      }
      scrollLog();
    }
  } catch (e) {
    if (e.name === 'AbortError') { msg.text += '\n（已停止）'; }
    else throw e;
  } finally {
    finish();
    App.abort = null;
  }
}

function updateStreamText(msg) {
  const el = document.getElementById('bubble-' + msg.id);
  if (!el) return;
  el.innerHTML = esc(msg.text).replace(/\n/g, '<br>') + '<span class="stream-cursor"></span>';
}
function updateMessage(msg) {
  const el = document.getElementById('bubble-' + msg.id);
  if (!el) return;
  el.classList.remove('stream-cursor');
  el.innerHTML = richHTML(msg.text, msg);
  const row = el.closest('.msg');
  const typ = row.querySelector('.typing');
  if (typ) typ.remove();
  const nameEl = row.querySelector('.msg-name');
  if (nameEl && msg.speaker) {
    const card = charById(msg.speaker);
    if (card) {
      nameEl.firstChild.textContent = card.name + ' ';
      const av = row.querySelector('.msg-avatar');
      if (av && !av.querySelector('img')) av.innerHTML = `<img src="${esc(avatar(card))}" alt="">`;
    }
  }
  if (msg.guard) {
    const tools = row.querySelector('.msg-tools');
    if (tools && !tools.querySelector('.guard-badge')) tools.insertAdjacentHTML('beforeend', guardBadge(msg.guard));
  }
}

function parseAssistant(msg) {
  let text = (msg.text || '').trim();
  const cast = castCards();
  let speaker = '';
  const pick = (n) => cast.find((c) => c.name === n || c.name.replace('·', '') === n || c.name.slice(0, 2) === n || c.name.slice(-2) === n);
  const m = text.match(/^【([^】]{1,12})】\s*/);
  if (m) {
    const hit = pick(m[1].trim());
    if (hit) { speaker = hit.id; text = text.slice(m[0].length); }
  }
  if (!speaker) {
    const re = /【([^】]{1,12})】/g;
    let mm;
    while ((mm = re.exec(text))) {
      const hit = pick(mm[1].trim());
      if (hit) { speaker = hit.id; break; }
    }
  }
  if (!speaker && cast.length === 1) speaker = cast[0].id;
  msg.speaker = speaker;
  msg.text = text;
  msg.raw = (m && speaker && pick(m[1].trim()) ? `【${(charById(speaker) || {}).name}】` : '') + text;
  msg.ts = msg.ts || Date.now() / 1000;
  parseStats(text);
}

function parseStats(text) {
  const c = App.chat;
  if (!c || !c.stats || !c.stats.length) return;
  let changed = false;
  const patterns = [];
  c.stats.forEach((s) => {
    [s.key, s.label].filter(Boolean).forEach((alias) => {
      const re = new RegExp('\\[\\[' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([+-]\\d+)\\]\\]', 'g');
      let m;
      while ((m = re.exec(text))) {
        const d = parseInt(m[1], 10);
        s.value = clamp((s.value || 0) + d, 0, s.max || 9);
        changed = true;
      }
      patterns.push(new RegExp('\\[\\[' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[+-]\\d+\\]\\]', 'g'));
    });
  });
  if (changed) {
    const cleaned = patterns.reduce((t, re) => t.replace(re, ''), text).trim();
    const msg = c.messages[c.messages.length - 1];
    if (msg) { msg.text = cleaned; msg.raw = cleaned; }
    const bar = $('#chat-scene');
    if (bar) bar.innerHTML = sceneBar();
    const side = $('#chat-side');
    if (side) side.innerHTML = sidePanel();
    toast('剧本资源变化：' + c.stats.map((s) => s.label + ' ' + s.value).join(' · '));
  }
}

async function sendMessage(textOverride, opts = {}) {
  if (App.busy) return;
  const input = $('#composer');
  const text = (textOverride != null ? textOverride : (input ? input.value : '')).trim();
  if (!text) return;
  if (input && textOverride == null) input.value = '';
  autoGrow(input);
  const history = historyOf(App.chat.messages);
  const userMsg = { id: uid(), role: 'user', text, ts: Date.now() / 1000 };
  App.chat.messages.push(userMsg);
  App.chat.turn = (App.chat.turn || 0) + 1;
  App.suggestions = [];
  renderChat();
  App.busy = true;
  updateSendBtn();
  const msg = { id: uid(), role: 'assistant', text: '', raw: '', speaker: '', ts: Date.now() / 1000, streaming: true };
  App.chat.messages.push(msg);
  const log = $('#chat-log-inner');
  if (log) log.insertAdjacentHTML('beforeend', messageHTML(msg, App.chat.messages.length - 1));
  scrollLog();
  try {
    await streamChat(chatState({ history, userMessage: text, advance: opts.advance }), msg);
  } catch (e) {
    msg.streaming = false;
    msg.text = '【灯笼灭了】' + e.message + '\n检查一下设置里的 Base URL / 模型名 / API Key，或者先切到离线演示。';
    updateMessage(msg);
    toast(e.message, 'err');
  }
  App.busy = false;
  updateSendBtn();
  store.set('gt.current', App.chat);
  if (App.chat.turn % 4 === 0) saveChat(true);
  if (App.chat.turn % 6 === 0) summarize(true);
}

async function regenerate(id) {
  if (App.busy) return;
  const idx = App.chat.messages.findIndex((m) => m.id === id);
  if (idx < 0) return;
  // 删除该条及之后的所有 assistant 消息，保留用户消息
  App.chat.messages = App.chat.messages.slice(0, idx);
  const lastUser = [...App.chat.messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return;
  const prior = App.chat.messages.filter((m) => m !== lastUser);
  App.chat.messages = prior;
  const text = lastUser.text;
  await sendMessage(text, {});
}

async function advanceAct() {
  if (!App.scenario || App.busy) return;
  if (App.chat.actIndex >= App.scenario.acts.length - 1) return finishStory();
  App.chat.actIndex += 1;
  const act = App.scenario.acts[App.chat.actIndex];
  App.chat.messages.push({ id: uid(), role: 'system', text: `—— 第 ${App.chat.actIndex + 1} 幕 · ${actName(act)} ——`, ts: Date.now() / 1000 });
  const history = historyOf(App.chat.messages);
  renderChat();
  App.busy = true;
  updateSendBtn();
  const msg = { id: uid(), role: 'assistant', text: '', raw: '', speaker: '', ts: Date.now() / 1000, streaming: true };
  App.chat.messages.push(msg);
  const log = $('#chat-log-inner'); if (log) log.insertAdjacentHTML('beforeend', messageHTML(msg));
  scrollLog();
  try { await streamChat(chatState({ history, userMessage: '（我们继续往下走吧。请把场景自然推向这一幕的核心事件。）', advance: true }), msg); }
  catch (e) { msg.streaming = false; msg.text = '【灯笼灭了】' + e.message; updateMessage(msg); }
  App.busy = false; updateSendBtn(); store.set('gt.current', App.chat); saveChat(true);
}

function finishStory() {
  if (!App.scenario) return;
  const s = App.scenario;
  openModal(`<div class="modal-head"><div><div class="tag">收束</div><h2>这个故事可以怎么结束</h2></div>
    <button class="btn-icon btn-ghost modal-close" data-action="close-modal">${icon('x')}</button></div>
    <div class="modal-body"><p class="m-text">结局由你走到的地方决定。下面只是可能性——你可以让 AI 顺着现在的剧情写，也可以自己说完最后一句话。</p>
    <div class="endings">${s.endings.map((e) => `<div class="ending-item"><b>${esc(e.title)}</b><p>${esc(e.condition)}</p><p style="color:var(--text-2);margin-top:6px">${esc(e.text)}</p></div>`).join('')}</div></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="close-modal">继续演</button>
    <button class="btn btn-primary" data-action="ai-finish">让 AI 收束</button></div>`);
}

async function aiFinish() {
  closeModal();
  if (App.busy) return;
  const history = historyOf(App.chat.messages);
  const instruction = '（请根据我们走到这里的一切，为这个故事收束。用旁白写结局，最后给一句角色自己的台词。不要总结，不要解释。）';
  renderChat();
  App.busy = true;
  updateSendBtn();
  const msg = { id: uid(), role: 'assistant', text: '', raw: '', speaker: '', ts: Date.now() / 1000, streaming: true };
  App.chat.messages.push(msg);
  const log = $('#chat-log-inner'); if (log) log.insertAdjacentHTML('beforeend', messageHTML(msg));
  scrollLog();
  try { await streamChat(chatState({ history, userMessage: instruction }), msg); }
  catch (e) { msg.streaming = false; msg.text = '【灯笼灭了】' + e.message; updateMessage(msg); }
  App.busy = false; App.chat.ended = true; updateSendBtn(); store.set('gt.current', App.chat); saveChat(true);
}

/* ------------------------------------------------------------ 建议 / 记忆 / 纠偏 */
async function fetchSuggestions() {
  if (!App.chat || App.busy) return;
  const btn = document.querySelector('[data-action="suggest"]');
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/suggest', { method: 'POST', body: JSON.stringify({ state: chatState({ history: historyOf(App.chat.messages), userMessage: '' }) }) });
    App.suggestions = r.choices || [];
    const row = $('#suggest-row');
    if (row) row.innerHTML = App.suggestions.map((s) => `<button class="suggest-chip" data-action="use-suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('');
  } catch (e) { toast('建议生成失败：' + e.message, 'err'); }
  finally { if (btn) btn.disabled = false; }
}

async function summarize(silent) {
  if (!App.chat) return;
  if (!silent) toast('正在整理记忆…');
  try {
    const r = await api('/api/summary', { method: 'POST', body: JSON.stringify({ state: chatState({ history: historyOf(App.chat.messages), userMessage: '' }) }) });
    if (r.summary) {
      App.chat.memory = { summary: r.summary, facts: r.facts || [], relations: r.relations || App.chat.memory.relations || {} };
      const side = $('#chat-side'); if (side) side.innerHTML = sidePanel();
      store.set('gt.current', App.chat);
      if (!silent) toast('记忆已更新', 'ok'); else saveChat(true);
    } else if (!silent) {
      toast(r.offline ? '离线演示无法整理记忆' : (r.error || '没有生成记忆'), 'err');
    }
  } catch (e) { if (!silent) toast('整理失败：' + e.message, 'err'); }
}

function editMemory() {
  const m = App.chat.memory || {};
  openModal(`<div class="modal-head"><div><div class="tag">记忆</div><h2>角色会记住什么</h2></div>
    <button class="btn-icon btn-ghost modal-close" data-action="close-modal">${icon('x')}</button></div>
    <form class="modal-body" data-form="memory">
      <div class="field"><label>前情提要</label><textarea class="input" name="summary" rows="5" placeholder="发生了什么、还没解决什么…">${esc(m.summary || '')}</textarea></div>
      <div class="field"><label>已确认的事实（每行一条）</label><textarea class="input" name="facts" rows="4">${esc((m.facts || []).join('\n'))}</textarea></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存记忆</button></div>
    </form>`, { narrow: true });
}

async function guardFix(id) {
  const msg = App.chat.messages.find((m) => m.id === (id || (lastGuardMessage() || {}).id));
  if (!msg) return;
  toast('正在按角色人格重写…');
  try {
    const r = await api('/api/guard', { method: 'POST', body: JSON.stringify({ text: msg.raw || msg.text, character_ids: App.chat.characterIds, rewrite: true }) });
    if (r.text && r.text !== (msg.raw || msg.text)) {
      msg.text = r.text; msg.raw = r.text; parseAssistant(msg); msg.guard = r.guard;
      updateMessage(msg);
      toast('已按角色口吻重写', 'ok');
      store.set('gt.current', App.chat);
    } else toast(r.error || '这段已经挺稳的', 'err');
  } catch (e) { toast('纠偏失败：' + e.message, 'err'); }
}
function lastGuardMessage() {
  for (let i = App.chat.messages.length - 1; i >= 0; i--) if (App.chat.messages[i].guard) return App.chat.messages[i];
  return null;
}

/* ------------------------------------------------------------ 存档 */
async function saveChat(silent) {
  if (!App.chat) return;
  try {
    const r = await api('/api/saves', { method: 'POST', body: JSON.stringify({ id: App.chat.id, title: chatTitle(), state: App.chat }) });
    App.saves = r.saves || App.saves;
    if (!silent) toast('故事已收进酒馆', 'ok');
  } catch (e) { if (!silent) toast('保存失败：' + e.message, 'err'); }
}

async function loadSave(id) {
  try {
    const rec = await api('/api/saves/' + id);
    if (!rec || !rec.state) throw new Error('存档损坏');
    App.chat = rec.state;
    App.chatCast = (App.chat.characterIds || []).map((i) => charById(i)).filter(Boolean);
    App.scenario = scenarioById(App.chat.scenarioId);
    App.returnTo = 'tavern';
    store.set('gt.current', App.chat);
    location.hash = '#/chat';
    if (App.view === 'chat') renderChat();
    toast('读档成功', 'ok');
  } catch (e) { toast('读档失败：' + e.message, 'err'); }
}

async function deleteSave(id) {
  if (!confirm('把这个存档从酒馆里删掉？')) return;
  try {
    await api('/api/saves/' + id, { method: 'DELETE' });
    App.saves = App.saves.filter((s) => s.id !== id);
    renderView();
    toast('已删除');
  } catch (e) { toast('删除失败：' + e.message, 'err'); }
}

function exportChat() {
  if (!App.chat) return;
  const blob = new Blob([JSON.stringify(App.chat, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gensokyo-${App.chat.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('对话已导出');
}

/* ------------------------------------------------------------ 设置 */
function viewSettings() {
  const cfg = App.cfg || {};
  const presets = [
    ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat'],
    ['OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini'],
    ['Moonshot', 'https://api.moonshot.cn/v1', 'moonshot-v1-8k'],
    ['SiliconFlow', 'https://api.siliconflow.cn/v1', 'Qwen/Qwen2.5-7B-Instruct'],
    ['Ollama 本地', 'http://127.0.0.1:11434/v1', 'qwen2.5:7b'],
    ['LM Studio', 'http://127.0.0.1:1234/v1', 'local-model'],
  ];
  return `<div class="page">
    <div class="page-head"><div><div class="eyebrow">Settings</div><h1 class="display">设置</h1>
      <p class="lead" style="margin-top:10px">API Key 只保存在本机 <code>config.json</code>，不会上传到任何地方。没有 Key 时，应用会进入离线演示。</p></div></div>
    <div class="settings-grid">
      <div>
        <div class="panel">
          <h3>模型连接</h3><div class="p-sub">任何 OpenAI 兼容接口都可以：DeepSeek、OpenAI、Moonshot、SiliconFlow、Ollama、LM Studio…</div>
          <div class="preset-row">${presets.map(([n]) => `<button class="preset" data-action="preset" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
          <div class="field"><label>Base URL</label><input class="input" id="cfg-base" value="${esc(cfg.base_url || '')}" placeholder="https://api.deepseek.com/v1"></div>
          <div class="field-row">
            <div class="field"><label>模型名</label><input class="input" id="cfg-model" value="${esc(cfg.model || '')}" placeholder="deepseek-chat"></div>
            <div class="field"><label>API Key ${cfg.has_key ? '（已保存 ' + esc(cfg.masked_key) + '）' : ''}</label><input class="input" id="cfg-key" type="password" placeholder="${cfg.has_key ? '留空则保持不变' : 'sk-...'}" autocomplete="off"></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-primary" data-action="save-config">${icon('check')}保存连接</button>
            <button class="btn" data-action="test-config">${icon('key')}测试连接</button>
            ${cfg.has_key ? '<button class="btn btn-ghost" data-action="clear-key">清除 Key</button>' : ''}
          </div>
          <div class="conn-status" id="conn-status"><span class="dot"></span><span>${cfg.has_key ? '已配置，可以开始对话' : '未配置 · 当前为离线演示'}</span></div>
        </div>

        <div class="panel">
          <h3>角色稳定</h3><div class="p-sub">稳定度越高，角色越不容易出戏，但自由度会略低。</div>
          <div class="field"><label>严格程度</label>
            <select class="input" id="cfg-strict">
              <option value="1" ${cfg.strictness === 1 ? 'selected' : ''}>宽松 · 更自由，允许即兴发挥</option>
              <option value="2" ${cfg.strictness === 2 ? 'selected' : ''}>平衡 · 推荐</option>
              <option value="3" ${cfg.strictness === 3 ? 'selected' : ''}>严格 · 人格与口吻优先</option>
            </select>
          </div>
          <div class="switch-row"><div class="sw-label"><b>回复后自检</b><span>检测出戏、复读、替玩家说话</span></div><button class="switch ${cfg.guard ? 'on' : ''}" id="cfg-guard" data-action="toggle-guard"></button></div>
          <div class="field-row" style="margin-top:14px">
            <div class="field"><label>温度 <b class="gold" id="temp-val">${cfg.temperature}</b></label><div class="range-row"><input type="range" id="cfg-temp" min="0.2" max="1.3" step="0.05" value="${cfg.temperature}"></div></div>
            <div class="field"><label>最大回复长度</label><input class="input" type="number" id="cfg-max" value="${cfg.max_tokens}" min="200" max="3000" step="50"></div>
          </div>
        </div>

        <div class="panel">
          <h3>我的角色</h3><div class="p-sub">进入剧本时会自动使用剧本指定的身份；这里是没有指定时的默认值。</div>
          <div class="field-row">
            <div class="field"><label>名字</label><input class="input" id="persona-name" value="${esc((App.chat && App.chat.persona && App.chat.persona.name) || '旅人')}"></div>
            <div class="field"><label>身份</label><input class="input" id="persona-id" value="${esc((App.chat && App.chat.persona && App.chat.persona.identity) || '误入幻想乡的外界人')}"></div>
          </div>
          <div class="field"><label>备注（角色会知道的事）</label><textarea class="input" id="persona-note" rows="2">${esc((App.chat && App.chat.persona && App.chat.persona.note) || '')}</textarea></div>
        </div>

        <div class="panel">
          <h3>朗读</h3><div class="p-sub">使用系统自带语音，离线也能用。不同角色会换一点音高。</div>
          <div class="switch-row"><div class="sw-label"><b>显示朗读按钮</b><span>点消息下的"朗读"</span></div><button class="switch ${App.prefs.tts ? 'on' : ''}" data-action="toggle-tts"></button></div>
          <div class="field" style="margin-top:12px"><label>语音</label><select class="input" id="tts-voice"><option value="">自动选择中文语音</option></select></div>
          <div class="field-row"><div class="field"><label>语速</label><div class="range-row"><input type="range" id="tts-rate" min="0.6" max="1.5" step="0.05" value="${App.prefs.rate}"></div></div>
          <div class="field"><label>音高</label><div class="range-row"><input type="range" id="tts-pitch" min="0.6" max="1.6" step="0.05" value="${App.prefs.pitch}"></div></div></div>
        </div>

        <div class="panel danger-zone">
          <h3>数据</h3><div class="p-sub">所有内容都在本地。换机器时，把整个 GensokyoTavern 文件夹带走即可。</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-action="export-all">${icon('download')}导出全部存档</button>
            <button class="btn" data-action="import-all">${icon('upload')}导入存档</button>
            <button class="btn btn-ghost" data-action="clear-current">清除当前对话</button>
          </div>
        </div>
      </div>
      <div>
        <div class="tip-card"><b>不知道填什么？</b><br>DeepSeek 官方：<code>https://api.deepseek.com/v1</code>，模型 <code>deepseek-chat</code>，Key 在 platform.deepseek.com 申请。<br><br>Ollama 本地：先运行 <code>ollama serve</code>，Base URL 填 <code>http://127.0.0.1:11434/v1</code>，模型填你 pull 过的名字。</div>
        <div class="tip-card" style="margin-top:10px"><b>角色稳定引擎在做什么？</b><br>1. 人格卡分层注入（身份/性格/口吻/关系/示例）<br>2. 关键词触发的世界观词条<br>3. 剧本分幕状态与导演提示<br>4. 记忆摘要与关系值<br>5. 回复后 OOC 自检与一键纠偏</div>
        <div class="tip-card" style="margin-top:10px"><b>离线演示能玩吗？</b><br>能。它会按剧本分幕给出旁白与角色台词，但不会真正理解你。配好 Key 之后，角色才会接住你的每一句话。</div>
      </div>
    </div>
  </div>`;
}

function fillSettings() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices().filter((v) => /zh|Chinese|中文/i.test(v.lang + v.name)) : [];
  const sel = $('#tts-voice');
  if (sel) {
    sel.innerHTML = '<option value="">自动选择中文语音</option>' + voices.map((v) => `<option value="${esc(v.name)}" ${App.prefs.voice === v.name ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    sel.onchange = () => { App.prefs.voice = sel.value; store.set('gt.prefs', App.prefs); };
  }
  const rate = $('#tts-rate'); if (rate) rate.oninput = () => { App.prefs.rate = parseFloat(rate.value); store.set('gt.prefs', App.prefs); };
  const pitch = $('#tts-pitch'); if (pitch) pitch.oninput = () => { App.prefs.pitch = parseFloat(pitch.value); store.set('gt.prefs', App.prefs); };
  const temp = $('#cfg-temp');
  if (temp) temp.addEventListener('input', () => { $('#temp-val').textContent = temp.value; });
}

async function saveConfig(extra = {}) {
  const body = Object.assign({}, extra);
  if ($('#cfg-base')) body.base_url = $('#cfg-base').value;
  if ($('#cfg-model')) body.model = $('#cfg-model').value;
  if ($('#cfg-strict')) body.strictness = parseInt($('#cfg-strict').value || '2', 10);
  if ($('#cfg-max')) body.max_tokens = parseInt($('#cfg-max').value || '900', 10);
  if ($('#cfg-temp')) body.temperature = parseFloat($('#cfg-temp').value || '0.85');
  if ($('#cfg-guard')) body.guard = $('#cfg-guard').classList.contains('on');
  const key = ($('#cfg-key') || {}).value || '';
  if (key.trim()) body.api_key = key.trim();
  try {
    const r = await api('/api/config', { method: 'POST', body: JSON.stringify(body) });
    App.cfg = r.config;
    updateStatus();
    toast('设置已保存', 'ok');
    return true;
  } catch (e) { toast('保存失败：' + e.message, 'err'); return false; }
}

/* ------------------------------------------------------------ 设置弹窗 */
function quickSettings() {
  const cfg = App.cfg || {};
  openModal(`<div class="modal-head"><div><div class="tag">当前会话</div><h2>模型与稳定度</h2></div>
    <button class="btn-icon btn-ghost modal-close" data-action="close-modal">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="field"><label>模型</label><input class="input" id="cfg-model" value="${esc(cfg.model || '')}"></div>
      <div class="field"><label>严格程度</label><select class="input" id="cfg-strict">
        <option value="1" ${cfg.strictness === 1 ? 'selected' : ''}>宽松</option>
        <option value="2" ${cfg.strictness === 2 ? 'selected' : ''}>平衡</option>
        <option value="3" ${cfg.strictness === 3 ? 'selected' : ''}>严格</option></select></div>
      <div class="field"><label>温度 <b class="gold" id="temp-val">${cfg.temperature}</b></label><input type="range" id="cfg-temp" min="0.2" max="1.3" step="0.05" value="${cfg.temperature}" style="width:100%"></div>
      <div class="switch-row"><div class="sw-label"><b>回复后自检</b><span>出戏 / 复读 / 替玩家说话</span></div><button class="switch ${cfg.guard ? 'on' : ''}" id="cfg-guard" data-action="toggle-guard"></button></div>
      <div class="modal-actions"><a class="btn btn-ghost" href="#/settings" data-action="close-modal">完整设置</a><button class="btn btn-primary" data-action="save-quick">保存</button></div>
    </div>`, { narrow: true });
  const temp = $('#cfg-temp'); if (temp) temp.addEventListener('input', () => $('#temp-val').textContent = temp.value);
}

/* ------------------------------------------------------------ 引导 */
function showOnboarding() {
  openModal(`<div class="modal-head"><div><div class="tag">欢迎</div><h2>先点灯，还是先坐下？</h2></div>
    <button class="btn-icon btn-ghost modal-close" data-action="close-modal">${icon('x')}</button></div>
    <div class="modal-body">
      <p class="m-text">这里是<strong>幻想乡酒馆</strong>：${allCharacters().length} 张角色卡、${App.data.scenarios.length} 部剧本。角色由大模型扮演，所以需要一个 OpenAI 兼容的 API Key（DeepSeek、OpenAI、Ollama 都行）。</p>
      <div class="kv" style="margin:16px 0">
        <div>有 Key<b>自由对话、真正的即兴</b></div>
        <div>没有 Key<b>离线演示，也能走完剧本</b></div>
        <div>Key 存哪<b>只存本机 config.json</b></div>
      </div>
      <p class="small muted">建议先进入"设置"填 Key，再挑剧本。也可以现在就去离线试玩，随时补上。</p>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="onboard-offline">先离线试玩</button>
    <button class="btn btn-primary" data-action="onboard-config">去配置 API</button></div>`, { narrow: true });
  App.ui.onboarded = true; store.set('gt.ui', App.ui);
}

/* ------------------------------------------------------------ 弹层 */
function openModal(html, opts = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><div class="modal ${opts.narrow ? 'narrow' : ''}" role="dialog">${html}</div></div>`;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
}
function isModalOpen() { return !!$('#modal-root').innerHTML; }

/* ------------------------------------------------------------ 事件 */
function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  const id = t.dataset.id;
  if (a === 'backdrop') { if (e.target === t) closeModal(); return; }
  switch (a) {
    case 'close-modal': closeModal(); break;
    case 'open-char': closeModal(); openCharacter(id); break;
    case 'open-scenario': closeModal(); openScenario(id); break;
    case 'char-scenarios': closeModal(); openCharScenarios(id); break;
    case 'start-chat-char': closeModal(); startChat({ characterIds: [id] }); break;
    case 'start-chat-scenario': closeModal(); startChat({ scenarioId: id }); break;
    case 'random-chat': {
      const pool = allCharacters();
      const c = pool[Math.floor(Math.random() * pool.length)];
      startChat({ characterIds: [c.id] });
      break;
    }
    case 'map-node': mapSelect(id); break;
    case 'map-chat': closeModal(); startChat({ characterIds: [id] }); break;
    case 'filter-series': App.filters.charSeries = t.dataset.value; renderView(); break;
    case 'filter-sc-series': App.filters.scSeries = t.dataset.value; renderView(); break;
    case 'use-suggest': {
      const input = $('#composer');
      if (input) { input.value = t.dataset.text; input.focus(); autoGrow(input); }
      break;
    }
    case 'send': sendMessage(); break;
    case 'suggest': fetchSuggestions(); break;
    case 'narration': {
      const input = $('#composer');
      if (input) { input.value = input.value + (input.value ? '\n' : '') + '（旁白：'; input.focus(); autoGrow(input); }
      break;
    }
    case 'stop': if (App.abort) App.abort.abort(); break;
    case 'speak': speakMessage(id); break;
    case 'copy': {
      const m = App.chat.messages.find((x) => x.id === id);
      if (m) navigator.clipboard.writeText(m.text).then(() => toast('已复制')).catch(() => toast('复制失败', 'err'));
      break;
    }
    case 'regen': regenerate(id); break;
    case 'guard-fix': guardFix(id); break;
    case 'guard-fix-last': guardFix(); break;
    case 'advance': advanceAct(); break;
    case 'finish': finishStory(); break;
    case 'ai-finish': aiFinish(); break;
    case 'save-chat': saveChat(false); break;
    case 'export-chat': exportChat(); break;
    case 'reload-save': loadSave(App.chat.id); break;
    case 'summarize': summarize(false); break;
    case 'memory-edit': editMemory(); break;
    case 'side-toggle': { const s = $('#chat-side'); if (s) s.classList.toggle('open'); break; }
    case 'open-scenario-info': openScenario(App.chat.scenarioId); break;
    case 'back': location.hash = '#/' + (App.returnTo || 'tavern'); break;
    case 'load-save': loadSave(id); break;
    case 'delete-save': deleteSave(id); break;
    case 'quick-settings': quickSettings(); break;
    case 'toggle-guard': t.classList.toggle('on'); break;
    case 'toggle-tts': {
      App.prefs.tts = !App.prefs.tts; t.classList.toggle('on', App.prefs.tts); store.set('gt.prefs', App.prefs);
      break;
    }
    case 'preset': {
      const presets = {
        'DeepSeek': ['https://api.deepseek.com/v1', 'deepseek-chat'],
        'OpenAI': ['https://api.openai.com/v1', 'gpt-4o-mini'],
        'Moonshot': ['https://api.moonshot.cn/v1', 'moonshot-v1-8k'],
        'SiliconFlow': ['https://api.siliconflow.cn/v1', 'Qwen/Qwen2.5-7B-Instruct'],
        'Ollama 本地': ['http://127.0.0.1:11434/v1', 'qwen2.5:7b'],
        'LM Studio': ['http://127.0.0.1:1234/v1', 'local-model'],
      }[t.dataset.name];
      if (presets) { $('#cfg-base').value = presets[0]; $('#cfg-model').value = presets[1]; }
      break;
    }
    case 'save-config': saveConfig(); break;
    case 'save-quick': saveConfig().then((ok) => { if (ok) closeModal(); }); break;
    case 'test-config': testConnection(); break;
    case 'clear-key': if (confirm('清除已保存的 API Key？')) saveConfig({ clear_key: true }).then(() => renderView()); break;
    case 'onboard-config': closeModal(); location.hash = '#/settings'; break;
    case 'onboard-offline': closeModal(); startChat({ characterIds: ['HakureiReimu'] }); break;
    case 'export-all': exportAll(); break;
    case 'import-all': importAll(); break;
    case 'clear-current': {
      if (confirm('清除当前对话？存档不受影响。')) { store.del('gt.current'); App.chat = null; location.hash = '#/tavern'; }
      break;
    }
    case 'save-memory': break;
    default: break;
  }
}

function onKey(e) {
  if (e.key === 'Escape' && isModalOpen()) closeModal();
}

function onSubmit(e) {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form;
  if (kind === 'memory') {
    const data = new FormData(f);
    App.chat.memory = {
      summary: (data.get('summary') || '').toString().trim(),
      facts: (data.get('facts') || '').toString().split('\n').map((s) => s.trim()).filter(Boolean),
      relations: (App.chat.memory && App.chat.memory.relations) || {},
    };
    closeModal();
    const side = $('#chat-side'); if (side) side.innerHTML = sidePanel();
    store.set('gt.current', App.chat);
    toast('记忆已更新', 'ok');
  }
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 190) + 'px';
}

function updateSendBtn() {
  const btn = $('#send-btn');
  if (!btn) return;
  if (App.busy) {
    btn.classList.add('stop');
    btn.innerHTML = icon('stop');
    btn.dataset.action = 'stop';
  } else {
    btn.classList.remove('stop');
    btn.innerHTML = icon('send');
    btn.dataset.action = 'send';
  }
}

function scrollLog(force) {
  const log = $('#chat-log');
  if (!log) return;
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 220;
  if (force || near) log.scrollTop = log.scrollHeight;
}

/* ------------------------------------------------------------ 朗读 */
function speakMessage(id) {
  if (!('speechSynthesis' in window)) return toast('这个浏览器不支持朗读', 'err');
  const m = App.chat.messages.find((x) => x.id === id);
  if (!m) return;
  const card = m.speaker ? charById(m.speaker) : primaryCard();
  let text = m.text.replace(/【[^】]*】/g, '').replace(/[「」]/g, '').replace(/（[^）]*）/g, '').trim();
  if (!text) text = m.text;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 600));
  const voices = speechSynthesis.getVoices();
  let v = voices.find((x) => x.name === App.prefs.voice) || voices.find((x) => /zh[-_]CN|Chinese|中文/.test(x.lang + x.name)) || voices[0];
  if (v) u.voice = v;
  u.lang = v ? v.lang : 'zh-CN';
  u.rate = parseFloat(App.prefs.rate || 1);
  const hash = card ? card.name.charCodeAt(0) : 50;
  u.pitch = parseFloat(App.prefs.pitch || 1) * (0.92 + (hash % 5) * 0.035);
  const msgEl = document.querySelector(`[data-mid="${id}"]`);
  const btn = msgEl ? msgEl.querySelector('[data-action="speak"]') : null;
  if (btn) btn.innerHTML = icon('volume', 'sm') + '朗读中';
  u.onend = () => { if (btn) btn.innerHTML = icon('volume', 'sm') + '朗读'; };
  speechSynthesis.speak(u);
}

/* ------------------------------------------------------------ 导出 / 导入 */
async function exportAll() {
  const records = [];
  for (const s of App.saves) {
    try { records.push(await api('/api/saves/' + s.id)); } catch {}
  }
  const blob = new Blob([JSON.stringify({ saves: records, current: App.chat }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gensokyo-tavern-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`已导出 ${records.length} 个存档`);
}

function importAll() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const saves = data.saves || (Array.isArray(data) ? data : []);
      let n = 0;
      for (const s of saves) {
        if (s && s.state) { await api('/api/saves', { method: 'POST', body: JSON.stringify({ id: s.id, title: s.title, state: s.state }) }); n++; }
      }
      const r = await api('/api/saves');
      App.saves = r.saves; renderView(); toast(`导入了 ${n} 个存档`, 'ok');
    } catch (e) { toast('导入失败：' + e.message, 'err'); }
  };
  input.click();
}

async function testConnection() {
  const el = $('#conn-status');
  if (el) { el.className = 'conn-status'; el.innerHTML = '<span class="dot"></span><span>正在连接…</span>'; }
  try {
    const r = await api('/api/test', {
      method: 'POST',
      body: JSON.stringify({
        base_url: ($('#cfg-base') || {}).value,
        model: ($('#cfg-model') || {}).value,
        api_key: ($('#cfg-key') || {}).value,
      }),
    });
    if (el) {
      el.className = 'conn-status ' + (r.ok ? 'ok' : 'bad');
      el.innerHTML = `<span class="dot"></span><span>${esc(r.ok ? (r.message + (r.models && r.models.length ? ' · ' + r.models.slice(0, 3).join(', ') : '')) : r.message)}</span>`;
    }
    toast(r.ok ? '连接成功' : '连接失败', r.ok ? 'ok' : 'err');
  } catch (e) {
    if (el) { el.className = 'conn-status bad'; el.innerHTML = `<span class="dot"></span><span>${esc(e.message)}</span>`; }
    toast('连接失败：' + e.message, 'err');
  }
}

/* ------------------------------------------------------------ 启动 */
document.addEventListener('DOMContentLoaded', boot);
window.addEventListener('load', () => {
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
});
