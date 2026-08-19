/* ==========================================================================
   main.js — wiring: input handling, actions, the day loop and persistence.
   ========================================================================== */
(function (root) {
  'use strict';
  var AS = root.AS, UI = AS.UI, C = AS.CONFIG;
  var S = null;
  var $ = function (sel) { return document.querySelector(sel); };

  /* ---------------- boot ---------------- */
  function boot() {
    if (AS.hasSave()) $('#btnContinue').hidden = false;
    $('#btnNewGame').addEventListener('click', function () {
      var name = ($('#shopNameInput').value || '').trim();
      S = AS.newGame(name || 'Torque & Profit Auto');
      startGame();
      welcome();
    });
    $('#btnContinue').addEventListener('click', function () {
      var loaded = AS.load();
      if (!loaded) { UI.toast('That save could not be read.', 'bad'); return; }
      S = loaded; startGame();
    });
    $('#shopNameInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('#btnNewGame').click();
    });
  }

  function startGame() {
    $('#startScreen').hidden = true;
    $('#game').hidden = false;
    UI.render(S);
  }

  function welcome() {
    UI.modal('Welcome To ' + esc(S.shopName),
      '<p>You have taken over a two-bay shop in a back alley. There is ' + AS.money(S.cash) +
      ' in the account, two technicians, one service advisor and eight parking spaces.</p>' +
      '<p>Each day you decide what to charge, what to advertise, who to train and what to build. Then you open the doors and find out whether you were right.</p>' +
      '<div class="note warn">Start here: the <strong>Front Office</strong> tab tells you how many cars to expect today and whether your bays, your counter and your lot can actually handle them. The <strong>Manual</strong> tab explains every number in the game.</div>' +
      '<div class="note info">Your first real decision: your labor rate is $118 against a town average of $' + C.marketLaborRate +
      ', and you are spending $45/day on search ads. Neither is necessarily right.</div>',
      '<button class="btn btn-primary" data-action="close-modal">Let&rsquo;s Go</button>');
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* ---------------- the day loop ---------------- */
  function openShop() {
    if (S.gameOver) { showGameOver(); return; }
    var d = AS.runDay(S);
    S.lastDayDetail = trimDay(d);

    /* channel performance history for the marketing tab */
    S.adHistory = S.adHistory || [];
    var rec = { day: d.day };
    Object.keys(d.bySource || {}).forEach(function (k) {
      var x = d.bySource[k];
      rec[k] = { spend: x.spend || 0, leads: x.leads || 0, ros: x.ros || 0, revenue: x.revenue || 0, gp: x.gp || 0 };
    });
    S.adHistory.push(rec);
    if (S.adHistory.length > 40) S.adHistory = S.adHistory.slice(-40);

    AS.save(S);
    UI.render(S);
    showReport(d);
  }

  /* Keep the stored copy small — the full log lives only in memory. */
  function trimDay(d) {
    var copy = {};
    Object.keys(d).forEach(function (k) { copy[k] = d[k]; });
    copy.log = d.log.slice(-30);
    copy.hourly = [];
    return copy;
  }

  function showReport(d) {
    var title = 'Day ' + d.day + ' &mdash; ' + AS.DAYS[d.dow] + ', ' + AS.MONTHS[d.month];
    var body = UI.dayReport(S, d);
    var foot = '<button class="btn btn-primary" data-action="close-modal">Back To The Office</button>';

    if (d.event) {
      body = '<div class="note ' + (d.event.choice ? 'warn' : 'info') + '"><strong>' + d.event.name + '</strong><br>' + d.event.blurb + '</div>' + body;
      if (d.event.choice) {
        foot = '<button class="btn" data-action="event-no" data-id="' + d.event.id + '">Decline</button>' +
               '<button class="btn btn-primary" data-action="event-yes" data-id="' + d.event.id + '">Accept</button>';
      }
    }
    UI.modal(title, body, foot);

    if (S.gameOver) setTimeout(showGameOver, 400);
  }

  function showGameOver() {
    UI.modal('Out Of Business',
      '<div class="note bad">' + S.gameOver.reason + '</div>' +
      '<div class="grid g4">' +
      '<div class="kpi"><div class="k">Days Survived</div><div class="v">' + S.day + '</div></div>' +
      '<div class="kpi"><div class="k">Lifetime Revenue</div><div class="v">' + AS.money(S.stats.totalRevenue) + '</div></div>' +
      '<div class="kpi"><div class="k">Cars Serviced</div><div class="v">' + S.stats.totalCars + '</div></div>' +
      '<div class="kpi"><div class="k">Best Week</div><div class="v">' + AS.money(S.stats.bestWeekRevenue) + '</div></div>' +
      '</div>',
      '<button class="btn btn-primary" data-action="restart">Start A New Shop</button>');
  }

  /* ---------------- actions ---------------- */
  var actions = {
    'close-modal': function () { UI.closeModal(); },

    'save': function () { AS.save(S) ? UI.toast('Saved.', 'good') : UI.toast('Could not save.', 'bad'); },

    'menu': function () {
      UI.modal('Menu',
        '<div class="stack">' +
        '<button class="btn" data-action="export">Export Save Code</button>' +
        '<button class="btn" data-action="import">Import Save Code</button>' +
        '<button class="btn btn-danger" data-action="restart">Start A New Shop</button>' +
        '</div>' +
        '<div class="hr"></div><div class="small muted">Day ' + S.day + ' &middot; ' + AS.money(S.cash) + ' cash &middot; reputation ' + S.reputation.toFixed(0) + '</div>');
    },

    'show-last-report': function () {
      if (!S.lastDayDetail) { UI.toast('No day has been run yet.'); return; }
      showReport(S.lastDayDetail);
    },

    'restart': function () {
      if (!confirm('Abandon this shop and start over? Your save will be erased.')) return;
      AS.clearSave();
      root.location.reload();
    },

    'export': function () {
      UI.modal('Export Save',
        '<p class="small muted">Copy this code somewhere safe. Paste it into Import to restore this shop.</p>' +
        '<textarea rows="7" readonly onclick="this.select()">' + AS.exportSave(S) + '</textarea>');
    },

    'import': function () {
      UI.modal('Import Save',
        '<p class="small muted">Paste a save code. This replaces your current shop.</p>' +
        '<textarea id="importBox" rows="7" placeholder="Paste code here"></textarea>',
        '<button class="btn" data-action="close-modal">Cancel</button>' +
        '<button class="btn btn-primary" data-action="do-import">Import</button>');
    },

    'do-import': function () {
      var v = $('#importBox').value;
      var loaded = AS.importSave(v);
      if (!loaded || !loaded.bays) { UI.toast('That code could not be read.', 'bad'); return; }
      S = loaded; AS.save(S); UI.closeModal(); UI.render(S);
      UI.toast('Shop imported.', 'good');
    },

    /* --- capital --- */
    'build-bay': function () {
      var loc = AS.location(S), cost = AS.bayBuildCost(S);
      if (S.bays.length >= loc.maxBays) { UI.toast('No room for another bay here.', 'bad'); return; }
      if (!spend(cost)) return;
      S.bays.push(AS.newBay(1));
      UI.toast('New bay built. It needs a technician to earn anything.', 'good');
      after();
    },

    'upgrade-bay': function (id) {
      var bay = S.bays.filter(function (b) { return b.id === id; })[0];
      if (!bay) return;
      var next = AS.EQUIP[bay.lvl];
      if (!next) { UI.toast('That bay is fully equipped.'); return; }
      if (!spend(next.cost)) return;
      bay.lvl++;
      UI.toast('Bay upgraded to ' + next.name + '.', 'good');
      after();
    },

    'buy-space': function () {
      if (S.spaces >= AS.location(S).maxSpaces) { UI.toast('No more room to pave.', 'bad'); return; }
      if (!spend(C.spaceCost)) return;
      S.spaces++;
      UI.toast('Another parking space paved.', 'good');
      after();
    },

    'move': function () {
      var next = AS.LOCATIONS[S.locIndex + 1];
      if (!next) return;
      if (!confirm('Move to ' + next.name + ' for ' + AS.money(next.cost) + '? You lose a day of business and your rent rises to ' + AS.money(next.rent) + '/day.')) return;
      if (!spend(next.cost)) return;
      S.locIndex++;
      S.day++; S.dow = (S.dow + 1) % 7;
      UI.toast('Moved to ' + next.name + '.', 'good');
      after();
    },

    /* --- people --- */
    'hire-tech': function (lvl) {
      lvl = parseInt(lvl, 10);
      var lv = AS.TECH_LEVELS[lvl - 1];
      var cost = lv.hireCost;
      if (!spend(cost)) return;
      var t = AS.newTech(lvl); t.hired = S.day;
      S.techs.push(t);
      UI.toast('Hired ' + t.name + ', ' + lv.title + '.', 'good');
      after();
    },

    'fire-tech': function (id) {
      var t = S.techs.filter(function (x) { return x.id === id; })[0];
      if (!t) return;
      var sev = AS.techLevel(t).wage * 9 * 3;
      if (!confirm('Let ' + t.name + ' go? Severance is ' + AS.money(sev) + '.')) return;
      S.cash -= sev;
      S.techs = S.techs.filter(function (x) { return x.id !== id; });
      S.techs.forEach(function (x) { x.morale = Math.max(10, x.morale - 6); });
      UI.toast(t.name + ' is gone. The rest of the crew noticed.', 'bad');
      after();
    },

    'train-tech': function (id) {
      var t = S.techs.filter(function (x) { return x.id === id; })[0];
      if (!t || t.training > 0) return;
      var lv = AS.techLevel(t);
      if (!lv.trainCost) { UI.toast('Already a Master Technician.'); return; }
      if (!spend(lv.trainCost)) return;
      t.training = lv.trainDays;
      UI.toast(t.name + ' starts training — off the floor for ' + lv.trainDays + ' days.', 'good');
      after();
    },

    'hire-advisor': function (lvl) {
      lvl = parseInt(lvl, 10);
      var lv = AS.ADVISOR_LEVELS[lvl - 1];
      var cost = lv.hireCost;
      if (!spend(cost)) return;
      var a = AS.newAdvisor(lvl);
      S.advisors.push(a);
      UI.toast('Hired ' + a.name + ', ' + lv.title + '.', 'good');
      after();
    },

    'fire-advisor': function (id) {
      var a = S.advisors.filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      var sev = AS.advisorLevel(a).wage * 3;
      if (!confirm('Let ' + a.name + ' go? Severance is ' + AS.money(sev) + '.')) return;
      S.cash -= sev;
      S.advisors = S.advisors.filter(function (x) { return x.id !== id; });
      UI.toast(a.name + ' is gone.', 'bad');
      after();
    },

    'train-advisor': function (id) {
      var a = S.advisors.filter(function (x) { return x.id === id; })[0];
      if (!a || a.training > 0) return;
      var lv = AS.advisorLevel(a);
      if (!lv.trainCost) { UI.toast('Already a Master Advisor.'); return; }
      if (!spend(lv.trainCost)) return;
      a.training = lv.trainDays;
      UI.toast(a.name + ' enrolled in advanced sales training — ' + lv.trainDays + ' days off the counter.', 'good');
      after();
    },

    /* --- money --- */
    'borrow': function (amt) {
      amt = parseInt(amt, 10);
      var room = AS.creditLimit(S) - S.loan;
      if (amt > room) { UI.toast('The bank will only lend you ' + AS.money(Math.max(0, room)) + ' more.', 'bad'); return; }
      S.loan += amt; S.cash += amt;
      UI.toast('Borrowed ' + AS.money(amt) + ' at ' + AS.pct(C.loanAPR, 1) + ' APR.', 'good');
      after();
    },

    'repay': function (amt) {
      amt = amt === 'all' ? S.loan : parseInt(amt, 10);
      amt = Math.min(amt, S.loan, S.cash);
      if (amt <= 0) return;
      S.loan -= amt; S.cash -= amt;
      UI.toast('Repaid ' + AS.money(amt) + '.', 'good');
      after();
    },

    /* --- events --- */
    'event-yes': function (id) { resolveEvent(id, true); },
    'event-no': function (id) { resolveEvent(id, false); }
  };

  function resolveEvent(id, accept) {
    var msg = AS.resolveEvent(S, id, accept);
    S.pendingEvent = null;
    UI.closeModal();
    UI.render(S);
    AS.save(S);
    if (msg) UI.toast(msg, accept ? 'good' : '');
  }

  function spend(cost) {
    if (S.cash - cost < -AS.creditLimit(S)) {
      UI.toast('Not enough cash or credit for that.', 'bad');
      return false;
    }
    S.cash -= cost;
    return true;
  }

  function after() { AS.save(S); UI.render(S); }

  /* ---------------- input wiring ---------------- */
  function setters(target, live) {
    var a = target.dataset.action;
    if (!a) return false;
    var v = target.type === 'checkbox' ? target.checked : target.value;

    switch (a) {
      case 'set-labor':
        S.pricing.laborRate = clampNum(v, C.laborRateMin, C.laborRateMax, S.pricing.laborRate);
        syncPair(target, S.pricing.laborRate); break;
      case 'set-oil':
        S.pricing.oilPrice = clampNum(v, 19, 129, S.pricing.oilPrice);
        syncPair(target, S.pricing.oilPrice); break;
      case 'set-diag':
        S.pricing.diagFee = clampNum(v, 0, 260, S.pricing.diagFee);
        syncPair(target, S.pricing.diagFee); break;
      case 'set-autoorder':
        S.partsAutoOrder = clampNum(v, 0, 200000, S.partsAutoOrder);
        syncPair(target, S.partsAutoOrder); break;
      case 'set-ad':
        S.adSpend[target.dataset.id] = clampNum(v, 0, 100000, S.adSpend[target.dataset.id]);
        syncPair(target, S.adSpend[target.dataset.id]); break;
      case 'set-strategy':
        S.pricing.partsStrategy = v; break;
      case 'set-supply':
        S.pricing.supplyFee = !!v; break;
      default: return false;
    }
    if (!live) { after(); } else { UI.renderHeader(S); }
    return true;
  }

  function clampNum(v, lo, hi, fallback) {
    var n = parseFloat(v);
    if (!isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  /* Keep the paired range + number inputs showing the same value. */
  function syncPair(target, value) {
    var group = target.closest('.slider-row');
    if (!group) return;
    Array.prototype.forEach.call(group.querySelectorAll('input'), function (inp) {
      if (inp !== target) inp.value = value;
    });
  }

  document.addEventListener('input', function (e) {
    if (!S) return;
    if (e.target.matches('input[type=range]')) setters(e.target, true);
  });

  document.addEventListener('change', function (e) {
    if (!S) return;
    if (e.target.matches('input,select,textarea')) setters(e.target, false);
  });

  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab && S) { UI.tab = tab.dataset.tab; UI.render(S); return; }

    var btn = e.target.closest('[data-action]');
    if (!btn || btn.matches('input,select,textarea')) return;
    var fn = actions[btn.dataset.action];
    if (fn) { e.preventDefault(); fn(btn.dataset.id); }
  });

  $('#btnOpenShop').addEventListener('click', function () { if (S) openShop(); });

  $('#modalWrap').addEventListener('click', function (e) {
    if (e.target === $('#modalWrap') && !S.pendingEvent) UI.closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (!S || $('#game').hidden) return;
    if (e.key === 'Escape' && !$('#modalWrap').hidden && !S.pendingEvent) UI.closeModal();
    if (e.key === 'Enter' && !$('#modalWrap').hidden) {
      var primary = $('#modalFoot .btn-primary');
      if (primary && primary.dataset.action === 'close-modal') { UI.closeModal(); e.preventDefault(); }
    }
    if ((e.key === ' ' || e.key === 'Enter') && $('#modalWrap').hidden && document.activeElement === document.body) {
      openShop(); e.preventDefault();
    }
  });

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
