/* main.js — bootstrap, input wiring and persistence. */
(function (G) {
  'use strict';
  var D = G.DATA, E = G.ENGINE, UI = G.UI;
  var SAVE_KEY = 'torque-and-tally-save-v1';

  /* Fields the P&L needs that the compact history does not keep. */
  var DETAIL_KEYS = ['day', 'laborSales', 'partsSales', 'partsCost', 'techWages', 'writerWages',
    'sublet', 'fixed', 'adSpend', 'other', 'debtService', 'gp', 'netProfit', 'revenue'];

  function detailOf(d) {
    var o = {};
    DETAIL_KEYS.forEach(function (k) { o[k] = d[k] || 0; });
    return o;
  }

  /* ------------------------------------------------------------ lifecycle */
  function start(state) {
    UI.S = state;
    UI.lastDay = null;
    G.state = state;
    UI.render();
  }

  function newGame(name, seed) {
    UI.dayDetails = [];
    start(E.newGame(seed || Math.floor(Math.random() * 1e9), name || 'Rain Street Auto'));
  }

  function save(quiet) {
    var s = UI.S, keep = s._rng, keepDay = s._day;
    delete s._rng; delete s._day;
    try {
      /* Storage can be unavailable entirely in a sandboxed frame. */
      localStorage.setItem(SAVE_KEY, JSON.stringify({ state: s, details: UI.dayDetails }));
      if (!quiet) UI.toast('Saved.', 'good');
    } catch (e) {
      if (!quiet) UI.toast('Could not save: ' + e.message, 'bad');
    }
    s._rng = keep; s._day = keepDay;
  }

  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var box = JSON.parse(raw);
      UI.dayDetails = box.details || [];
      start(E.rehydrate(box.state));
      return true;
    } catch (e) { return false; }
  }

  function endDay() {
    var s = UI.S;
    if (s.gameOver) return;
    var d = E.endDay(s);
    if (!d) return;
    UI.lastDay = d;
    UI.dayDetails.push(detailOf(d));
    if (UI.dayDetails.length > 800) UI.dayDetails.shift();
    UI.render();

    if (s.gameOver) {
      UI.modal(s.gameOver.win ? 'You did it' : 'Out of business',
        '<p class="note">' + s.gameOver.reason + '</p>' +
        '<div class="split"><div class="l">Days traded</div><div class="r mono">' + s.day + '</div>' +
        '<div class="l">Lifetime sales</div><div class="r mono">' + UI.money(s.lifetime.revenue) + '</div>' +
        '<div class="l">Cars delivered</div><div class="r mono">' + s.lifetime.cars + '</div>' +
        '<div class="l">Hours billed</div><div class="r mono">' + Math.round(s.lifetime.hours) + '</div>' +
        '<div class="l">Final net worth</div><div class="r mono">' + UI.money(E.netWorth(s)) + '</div></div>',
        '<button class="btn primary" data-act="newGame">Start over</button>');
      return;
    }
    save(true);
    if (s.dow !== 6) UI.dayReport(s, d);
  }

  /* -------------------------------------------------------------- actions */
  function sel(attr, id) {
    var el = document.querySelector('[' + attr + '="' + id + '"]');
    return el ? el.value : null;
  }

  var ACTS = {
    tab: function (arg) { UI.tab = arg; UI.render(); },
    closeModal: function () { UI.closeModal(); UI.render(); },
    help: function () { UI.help(); },
    newGame: function () { UI.closeModal(); askNewGame(); },

    buyBay: function () { run(E.actions.buyBay(UI.S)); },
    buyParking: function (arg) { run(E.actions.buyParking(UI.S, parseInt(arg, 10))); },
    upgradeTools: function (arg) { run(E.actions.upgradeTools(UI.S, arg)); },
    buyEquip: function (arg) { run(E.actions.buyEquipment(UI.S, arg, sel('data-eqsel', arg))); },
    buyUpgrade: function (arg) { run(E.actions.buyUpgrade(UI.S, arg)); },

    hireTech: function (arg) { run(E.actions.hireTech(UI.S, arg)); },
    hireWriter: function (arg) { run(E.actions.hireWriter(UI.S, arg)); },
    fire: function (arg) { run(E.actions.fire(UI.S, arg)); },
    raise: function (arg) { run(E.actions.raise(UI.S, arg, 3)); },
    promoteTech: function (arg) { run(E.actions.promoteTech(UI.S, arg)); },
    promoteWriter: function (arg) { run(E.actions.promoteWriter(UI.S, arg)); },
    trainCert: function (arg) { run(E.actions.trainCert(UI.S, arg, sel('data-certsel', arg))); },
    salesCourse: function (arg) { run(E.actions.salesCourse(UI.S, arg, sel('data-salesel', arg))); },

    borrow: function () { run(E.actions.borrow(UI.S, num('loanAmt'))); },
    repay: function () { run(E.actions.repay(UI.S, num('loanAmt'))); },

    fleetDecide: function () {
      var f = UI.S.pendingFleet;
      if (!f) return;
      UI.modal('Fleet contract — ' + f.name,
        '<p class="note">' + f.name + ' would move ' + f.min + ' to ' + f.max + ' vehicles a day to you. ' +
        'Fleet work is steady and fills the slow days, but they negotiate: 14% off labor and 6% off parts, and those cars still take bay time.</p>',
        '<button class="btn" data-act="declineFleet">Pass</button><button class="btn primary" data-act="acceptFleet">Sign it</button>');
    },
    acceptFleet: function () { UI.closeModal(); run(E.actions.acceptFleet(UI.S)); },
    declineFleet: function () { UI.closeModal(); run(E.actions.declineFleet(UI.S)); }
  };

  function num(id) { var el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; }

  function run(err) {
    if (err) UI.toast(err, 'bad');
    UI.render();
  }

  function askNewGame() {
    UI.modal('Open a new shop',
      '<label class="field"><span class="lbl">Shop name</span><input type="text" id="ngName" value="Rain Street Auto"></label>' +
      '<label class="field"><span class="lbl">Seed <b>optional</b></span><input type="text" id="ngSeed" placeholder="leave blank for random"></label>' +
      '<p class="hint">The same seed replays the same weather, walk-ins and breakdowns, so you can test a different strategy against an identical year.</p>',
      '<button class="btn primary" data-act="doNewGame">Open the doors</button>');
  }
  ACTS.doNewGame = function () {
    var name = (document.getElementById('ngName') || {}).value || 'Rain Street Auto';
    var seedRaw = (document.getElementById('ngSeed') || {}).value || '';
    var seed = seedRaw ? hash(seedRaw) : Math.floor(Math.random() * 1e9);
    UI.closeModal();
    newGame(name, seed);
    UI.help();
  };

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* --------------------------------------------------------------- wiring */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var fn = ACTS[el.getAttribute('data-act')];
    if (fn) { ev.preventDefault(); fn(el.getAttribute('data-arg')); }
  });

  /* Live label updates while dragging, full re-render when released. */
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    var s = UI.S;
    if (el.hasAttribute && el.hasAttribute('data-set')) {
      var key = el.getAttribute('data-set');
      s[key] = key === 'dispatch' ? el.value : parseFloat(el.value);
      liveLabel(el, key === 'laborRate' ? UI.money(s.laborRate) + '/hr'
        : key === 'partsMarkup' ? s.partsMarkup.toFixed(2) + 'x'
          : key === 'diagFee' ? UI.money(s.diagFee) + '/hr'
            : key === 'lofPrice' ? UI.money(s.lofPrice)
              : key === 'overtime' ? s.overtime.toFixed(1) + ' hrs/tech/day' : el.value);
    } else if (el.hasAttribute && el.hasAttribute('data-ad')) {
      E.actions.setSpend(s, el.getAttribute('data-ad'), parseFloat(el.value));
      liveLabel(el, UI.money(s.channels[el.getAttribute('data-ad')].spend));
    }
  });

  function liveLabel(el, text) {
    var lbl = el.parentElement && el.parentElement.querySelector('.lbl b');
    if (lbl) lbl.textContent = text;
  }

  document.addEventListener('change', function (ev) {
    var el = ev.target, s = UI.S;
    if (el.hasAttribute && el.hasAttribute('data-stock')) {
      E.actions.setStockTarget(s, el.getAttribute('data-stock'), parseFloat(el.value));
      UI.render();
    } else if (el.hasAttribute && (el.hasAttribute('data-set') || el.hasAttribute('data-ad'))) {
      UI.render();
    }
  });

  document.getElementById('btnEnd').addEventListener('click', endDay);
  document.getElementById('btnSave').addEventListener('click', function () { save(false); });
  document.getElementById('btnNew').addEventListener('click', askNewGame);
  document.getElementById('btnHelp').addEventListener('click', UI.help);

  document.addEventListener('keydown', function (ev) {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      if (document.querySelector('.veil')) { UI.closeModal(); UI.render(); }
      else endDay();
      ev.preventDefault();
    }
  });

  /* ----------------------------------------------------------------- boot */
  if (!load()) {
    newGame('Rain Street Auto', Math.floor(Math.random() * 1e9));
    UI.help();
  }
})(window);
