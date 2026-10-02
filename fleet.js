/* ================================================================================
   星海号 · 舰桥进度内核   window.Fleet
   --------------------------------------------------------------------------------
   全站唯一真源：六座水池的元数据、玩家的解锁状态、摸底测评的判定结果。
   零依赖、可在 file:// 下直接工作（不 import 任何东西，普通 <script> 引入）。

   设计约定（后面加关卡时只看这里）:
     1. 想加第七关 / 改关卡名 / 改副题  → 只改下面的 LABS
     2. 某一关建好了                    → 把 BUILT 加一
     3. 想改解锁规则                    → 只动 statusOf / unlockedMax / setQuiz
     4. 想让六池全开放 / 回到逐关解锁     → 只改下面的 GATE（false = 全开放）
     5. 关卡页面只调 Fleet.clear(n)，不关心别人
   ================================================================================ */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------------------
     【配置区】六座实验水池 —— 全站唯一真源
     --------------------------------------------------------------------------- */
  var LABS = [
    { n:1, code:'1-1', name:'引擎之心', sub:'简谐振动的密码',   file:'lab1.html', topic:'振幅 · 周期 · 频率 · 振动学方程',       img:'assets/img/pool-1.jpg' },
    { n:2, code:'2-1', name:'泥沼绝境', sub:'阻尼与共振破局',   file:'lab2.html', topic:'阻尼比 ζ · 品质因数 Q · 相频共振判据', img:'assets/img/pool-2.jpg' },
    { n:3, code:'3-1', name:'破壳而出', sub:'兴波阻力的真面目', file:'lab3.html', topic:'兴波阻力 · 波能带走 · 船首水墙',         img:'assets/img/pool-3.jpg' },
    { n:4, code:'4-1', name:'暗礁迷阵', sub:'绕开水下屏障',     file:'lab4.html', topic:'惠更斯原理 · 次级波源 · 绕射',           img:'assets/img/pool-4.jpg' },
    { n:5, code:'5-1', name:'终极抵消', sub:'打造球鼻艏',       file:'lab5.html', topic:'波的干涉 · 相消条件 · 球鼻艏',           img:'assets/img/pool-5.jpg' },
    { n:6, code:'6-1', name:'稳若泰山', sub:'消除船体共振',     file:'lab6.html', topic:'驻波 · 结构模态 · 减振',                 img:'assets/img/pool-6.jpg' }
  ];

  /* 已建成的水池数量。每建成一关，把这个数 +1 即可，
     摸底测评的起点会自动被它封顶 —— 不会判出一个「已解锁但没有内容」的池子。
     2026-10：六池全部建成（3 破壳而出 / 4 暗礁迷阵 / 5 终极抵消 / 6 稳若泰山）。 */
  var BUILT = 6;

  var KEY  = 'HAIXING_FLEET_V1';
  var COUNT = LABS.length;

  /* ---------------------------------------------------------------------------
     关卡门禁开关
     ---------------------------------------------------------------------------
     GATE = false  全开放（当前设置）：六座水池一开始就全部能进，
                   摸底测评只决定「推荐从哪一池下水」，通关只点亮标定卡，不再锁池子。
     GATE = true   老规矩：摸底测评判起点 + 每通关一关才解锁下一关。
     两种模式共用同一套 clear()/statusOf() 代码，切回来只要改这一个布尔值。
     --------------------------------------------------------------------------- */
  var GATE = false;

  /* ---------------------------------------------------------------------------
     存储：localStorage → sessionStorage → 内存（逐级降级，file:// 也不会炸）
     --------------------------------------------------------------------------- */
  var store = (function () {
    var backends = [];
    try { root.localStorage.setItem('__t', '1'); root.localStorage.removeItem('__t'); backends.push(root.localStorage); } catch (e) {}
    try { root.sessionStorage.setItem('__t', '1'); root.sessionStorage.removeItem('__t'); backends.push(root.sessionStorage); } catch (e) {}
    var mem = {}, memName = 'memory';
    return {
      name: backends.length ? (backends[0] === root.localStorage ? 'localStorage' : 'sessionStorage') : memName,
      get: function (k) {
        for (var i = 0; i < backends.length; i++) { var v = backends[i].getItem(k); if (v) return v; }
        return mem[k] || null;
      },
      set: function (k, v) {
        var ok = false;
        for (var i = 0; i < backends.length; i++) { try { backends[i].setItem(k, v); ok = true; } catch (e) {} }
        if (!ok) mem[k] = v;
      }
    };
  })();

  function blank() {
    return {
      v: 1,
      quiz: { taken: false, score: 0, total: 12, groups: { A: 0, B: 0, C: 0 }, start: 1, at: 0 },
      cleared: [false, false, false, false, false, false],
      flags: {},
      log: []
    };
  }

  var S = blank();

  function load() {
    try {
      var raw = store.get(KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || o.v !== 1) return;
      S.quiz = o.quiz || blank().quiz;
      S.cleared = (o.cleared && o.cleared.length === COUNT) ? o.cleared : blank().cleared;
      S.log = o.log || [];
      S.flags = o.flags || {};
    } catch (e) { /* 存档损坏就当新档，不阻断 */ }
  }
  function save() {
    try { store.set(KEY, JSON.stringify(S)); } catch (e) {}
  }

  /* ---------------------------------------------------------------------------
     解锁状态机
     --------------------------------------------------------------------------- */

  /* 「已解锁」到哪一关（1..COUNT）
     全开放模式下解锁线直接拉满：所有池子都算已解锁。
     GATE=true 时两条线取大：① 摸底测评判定的起点  ② 已通关的最后一关 +1
     这条线<b>不</b>受 BUILT 限制：通关第二关就该解锁第三关，
     哪怕第三关的实验舱还没造好（那时它是 pending，不是 locked）。 */
  function unlockedMax() {
    if (!GATE) return COUNT;                       /* 全开放 */
    var byClear = 1;
    for (var i = 0; i < COUNT; i++) if (S.cleared[i]) byClear = i + 2;   // 通关第 n 关 → 解锁第 n+1 关
    var byQuiz = S.quiz.taken ? S.quiz.start : 1;
    return Math.max(1, Math.min(COUNT, Math.max(byClear, byQuiz)));
  }

  /* 真正能点进去的（受已建成数量限制） */
  function playableMax() { return Math.max(1, Math.min(BUILT, unlockedMax())); }

  /* 单关状态
     cleared  已通关（有标定卡）
     open     当前可进入
     pending  已解锁，但实验舱尚未建造（BUILT 没跟上）
     locked   还没轮到（前一关没过）—— 只在 GATE=true 时才会出现 */
  function statusOf(n) {
    var i = n - 1;
    if (S.cleared[i]) return 'cleared';
    if (!GATE) return (n <= BUILT) ? 'open' : 'pending';   /* 全开放：建好的池子随便进 */
    if (n <= playableMax()) return 'open';
    if (n <= unlockedMax()) return 'pending';
    return 'locked';
  }

  /* 当前该下水的池子
     先看摸底测评选定的起点之后（被判定「免修」的池子不再推荐），
     都走完了再退回最靠前的 open（供复习）。 */
  function nextPlay() {
    var floor = S.quiz.taken ? S.quiz.start : 1;
    var n;
    for (n = floor; n <= COUNT; n++) if (statusOf(n) === 'open') return n;
    for (n = 1; n < floor; n++) if (statusOf(n) === 'open') return n;
    return null;
  }

  function clearedCount() {
    var c = 0;
    for (var i = 0; i < COUNT; i++) if (S.cleared[i]) c++;
    return c;
  }

  /* 配图：每关一张，缺图返回空串（页面会自己退回纯色底，不会出破图） */
  function imgFor(n) {
    var L = LABS[n - 1];
    return (L && L.img) ? L.img : '';
  }

  /* 链接：建好的走自己的文件，没建好的统一走占位页 lab.html?n=N */
  function hrefFor(n) {
    var L = LABS[n - 1];
    if (!L) return 'index.html';
    return n <= BUILT ? L.file : 'lab.html?n=' + n;
  }

  /* ---------------------------------------------------------------------------
     写入口
     --------------------------------------------------------------------------- */

  /* 摸底测评交卷：{ score, total, groups:{A,B,C} } → 判定起点 */
  function setQuiz(res) {
    var g = res.groups || { A: 0, B: 0, C: 0 };
    var start = 1;
    /* 分组规则：每组 4 题，答对 3 题以上才算「这一层已经会了」 */
    if (g.A >= 3) start = 2;
    if (g.A >= 3 && g.B >= 3) start = 3;
    if (g.A >= 3 && g.B >= 3 && g.C >= 3) start = 4;
    /* 不会判出一个还没建好的池子 */
    start = Math.max(1, Math.min(BUILT, start));

    S.quiz = {
      taken: true,
      score: res.score || 0,
      total: res.total || 12,
      groups: g,
      start: start,
      at: Date.now()
    };
    save(); emit();
    return start;
  }

  function skipQuiz() {
    S.quiz = { taken: true, score: 0, total: 12, groups: { A: 0, B: 0, C: 0 }, start: 1, at: Date.now() };
    save(); emit();
    return 1;
  }

  /* 通关：关卡页在自己的 showWin() 里调一次即可 */
  function clear(n) {
    var i = (n | 0) - 1;
    if (i < 0 || i >= COUNT) return false;
    var isNew = !S.cleared[i];
    S.cleared[i] = true;
    pushLog('通关 ' + LABS[i].code + ' · ' + LABS[i].name);
    save(); emit();
    return isNew;
  }

  /* 打一个标记（例如看没看过序章）。不影响解锁，只给页面做提示用 */
  function mark(k) {
    S.flags = S.flags || {};
    if (S.flags[k]) return false;
    S.flags[k] = true; save(); emit(); return true;
  }
  function seen(k) { return !!(S.flags && S.flags[k]); }

  function pushLog(t) {
    S.log.unshift({ t: t, at: Date.now() });
    if (S.log.length > 30) S.log.length = 30;
  }

  function reset() { S = blank(); save(); emit(); }

  /* 调试用：把 1..BUILT 全标为已通关 */
  function unlockAll() {
    for (var i = 0; i < BUILT; i++) S.cleared[i] = true;
    save(); emit();
  }

  /* ---------------------------------------------------------------------------
     变更通知
     --------------------------------------------------------------------------- */
  var subs = [];
  function on(fn) { if (typeof fn === 'function') subs.push(fn); }
  function emit() { for (var i = 0; i < subs.length; i++) { try { subs[i](S); } catch (e) {} } }

  /* ---------------------------------------------------------------------------
     导航坞：所有关卡页共用的「回舰桥」小条

     两种摆法：
       1) 默认：固定浮在左下角（适合没有底部控制台的页面，如序章/占位页）。
       2) opts.host：嵌进页面自己的容器里走正常文档流（推荐给有底部控制台的关卡页，
          否则固定浮层会压住控制台最左边的按钮 —— 第二关的「⛵ 释放船体」就被挡过）。
             host      选择器，比如 '#console'
             hostFirst true 插到容器最前面（默认 false，追加到末尾）
             hostGap   外边距，默认 '0 0 9px'
         host 找不到时自动退回固定浮层，不会丢导航。
     --------------------------------------------------------------------------- */
  function mountDock(opts) {
    opts = opts || {};
    if (root.__fleetDock) return root.__fleetDock;
    var d = document.createElement('div');
    d.id = 'fleetDock';
    var base = 'display:flex;align-items:center;gap:9px;flex:none;white-space:nowrap;' +
      'padding:7px 12px;border-radius:10px;font:12px/1.4 system-ui,"Microsoft YaHei",sans-serif;' +
      'background:rgba(6,18,23,.90);border:1px solid rgba(79,224,200,.30);color:#9fc4cd;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.45);backdrop-filter:blur(4px);letter-spacing:.3px;user-select:none;';
    var a = document.createElement('a');
    a.href = 'index.html';
    a.textContent = '⇱ 舰桥';
    a.style.cssText = 'color:#4fe0c8;text-decoration:none;font-weight:600;border-right:1px solid rgba(79,224,200,.25);padding-right:9px;';
    var s = document.createElement('span');
    s.style.cssText = 'opacity:.9;';
    d.appendChild(a); d.appendChild(s);

    var host = null;
    try { if (opts.host) host = document.querySelector(opts.host); } catch (e) {}
    if (host) {
      /* 内联模式：不脱离文档流，永远不会盖住任何控件 */
      d.style.cssText = base + 'position:relative;left:auto;bottom:auto;z-index:auto;' +
        'width:fit-content;margin:' + (opts.hostGap || '0 0 9px') + ';';
      if (opts.hostFirst && host.firstChild) host.insertBefore(d, host.firstChild);
      else host.appendChild(d);
    } else {
      d.style.cssText = base + 'position:fixed;left:14px;bottom:14px;z-index:99999;';
      (document.body || document.documentElement).appendChild(d);
    }

    function paint() {
      var cc = clearedCount();
      s.textContent = (opts.label ? opts.label + ' · ' : '') + '标定卡 ' + cc + '/' + COUNT;
    }
    paint(); on(paint);
    root.__fleetDock = d;
    return d;
  }

  /* ---------------------------------------------------------------------------
     URL 调试参数（只在地址栏带参数时生效，正常玩家碰不到）
       ?fleet=reset   清空进度
       ?fleet=open    解锁全部已建成的池子
       ?fleet=start=3 强制把起点设为 3
     --------------------------------------------------------------------------- */
  function readUrl() {
    try {
      var q = new URLSearchParams(root.location.search);
      var v = q.get('fleet');
      if (v === 'reset') { reset(); return; }
      if (v === 'open') { unlockAll(); return; }
      if (v && v.indexOf('start=') === 0) {
        var n = parseInt(v.slice(6), 10);
        if (n >= 1 && n <= BUILT) { S.quiz.taken = true; S.quiz.start = n; save(); }
      }
    } catch (e) {}
  }

  load(); readUrl();

  /* ---------------------------------------------------------------------------
     导出
     --------------------------------------------------------------------------- */
  var Fleet = {
    LABS: LABS, COUNT: COUNT, BUILT: BUILT, GATE: GATE,
    get state() { return S; },
    get storage() { return store.name; },
    statusOf: statusOf, unlockedMax: unlockedMax, playableMax: playableMax, nextPlay: nextPlay,
    clearedCount: clearedCount, hrefFor: hrefFor,
    setQuiz: setQuiz, skipQuiz: skipQuiz, clear: clear, reset: reset, unlockAll: unlockAll,
    on: on, mountDock: mountDock, mark: mark, seen: seen,
    lab: function (n) { return LABS[n - 1]; },
    imgFor: imgFor,
    /* 给摸底测评页：判定结果说明 */
    verdict: function () { return verdictOf(S); }
  };

  function verdictOf(st) {
    if (!st.quiz.taken) {
      return GATE
        ? { start: 1, title: '尚未摸底', desc: '默认从一号池下水。' }
        : { start: 1, title: '尚未摸底 · 推荐从一号池开始', desc: '六座水池都已开放，从哪一池下水由你定。' };
    }
    var g = st.quiz.groups;
    var weak = [];
    if (g.A < 3) weak.push('振动的描述（A/T/f、振动方程）');
    if (g.B < 3) weak.push('阻尼与共振');
    if (g.C < 3) weak.push('波的传播与干涉');
    var tail = weak.length ? '待补：' + weak.join('、') : '三组全达标 —— 前面几池可以直接跳过。';
    return {
      start: st.quiz.start,
      title: (GATE ? '起点：第 ' : '推荐起点：第 ') + st.quiz.start + ' 号水池 · ' + LABS[st.quiz.start - 1].name,
      desc: GATE ? tail : tail + '（六池全开放，去哪一池都行）',
      weak: weak
    };
  }

  root.Fleet = Fleet;
})(window);
