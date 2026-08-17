/* ============================================================
   Trip planner
   Route + itinerary + budget, persisted locally.
   Distances come from OSRM, places from Nominatim. Nothing about
   the trip is hardcoded and nothing is uploaded anywhere.
   ============================================================ */
(function () {
  "use strict";

  var $ = function (i) { return document.getElementById(i); };
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uid() { return 'i' + (Date.now().toString(36)) + Math.random().toString(36).slice(2, 7); }

  /* ---------------- dates ---------------- */
  function pd(v) { var p = String(v || '').split('-'); return p.length === 3 && p[0] ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addD(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function addH(d, h) { return new Date(d.getTime() + h * 3600000); }
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function fmt(d) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  function fmtLong(d) { return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  function hhmm(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function hh(h) { var m = Math.round(h * 60); return Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); }
  function nd(a, b) { return Math.round((day0(b) - day0(a)) / 86400000); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }

  function money(n) {
    var c = (T && T.currency) || '$';
    var v = Math.round(Math.abs(n)).toLocaleString();
    return (n < 0 ? '-' : '') + c + v;
  }

  /* ---------------- categories ---------------- */
  var CATS = [
    { k: 'lodging',    n: 'Lodging',         auto: 1 },
    { k: 'fuel',       n: 'Fuel',            auto: 1 },
    { k: 'ferry',      n: 'Ferry',           auto: 1 },
    { k: 'food',       n: 'Food' },
    { k: 'activities', n: 'Activities' },
    { k: 'tolls',      n: 'Tolls & parking' },
    { k: 'misc',       n: 'Misc' }
  ];
  function catName(k) { for (var i = 0; i < CATS.length; i++) if (CATS[i].k === k) return CATS[i].n; return k; }
  function catOptions(sel) {
    return CATS.map(function (c) {
      return '<option value="' + c.k + '"' + (c.k === sel ? ' selected' : '') + '>' + esc(c.n) + '</option>';
    }).join('');
  }

  /* ---------------- store ---------------- */
  var KEY = 'roadtrip.v2', DB = { trips: [], active: null }, T = null;

  function defTrip(name) {
    return {
      id: uid(), name: name || 'Newfoundland → Montreal',
      home: "Portugal Cove-St. Philip's, NL", dest: 'Montreal, QC',
      start: '2026-09-08', end: '2026-09-26', type: 'return',
      destNights: 8, destRate: 250, maxDriveH: 8,
      travellers: 2, currency: '$', l100: 9.5, fuelPrice: 1.75,
      ferry: {
        portA: 'Port aux Basques, NL', portB: 'North Sydney, NS',
        seaH: 7, seaHB: 7, ciH: 2,
        outDate: '2026-09-09', outTime: '02:45', retDate: '2026-09-25', retTime: '14:30', cost: 550
      },
      stops: [], items: [],
      budget: {
        conting: 10, actual: {},
        lines: [
          { id: uid(), cat: 'food', label: 'Food & groceries', planned: 0, actual: null },
          { id: uid(), cat: 'activities', label: 'Activities', planned: 0, actual: null },
          { id: uid(), cat: 'tolls', label: 'Tolls & parking', planned: 0, actual: null }
        ]
      }
    };
  }

  // Fill in anything a stored trip is missing, so an old save never crashes a newer build.
  function migrate(t) {
    var d = defTrip();
    Object.keys(d).forEach(function (k) { if (t[k] === undefined) t[k] = d[k]; });
    if (!t.ferry) t.ferry = d.ferry;
    Object.keys(d.ferry).forEach(function (k) { if (t.ferry[k] === undefined) t.ferry[k] = d.ferry[k]; });
    if (!t.budget) t.budget = d.budget;
    if (!t.budget.actual) t.budget.actual = {};
    if (!Array.isArray(t.budget.lines)) t.budget.lines = [];
    if (!Array.isArray(t.stops)) t.stops = [];
    if (!Array.isArray(t.items)) t.items = [];
    t.stops.forEach(function (s) { if (!s.id) s.id = uid(); });
    t.items.forEach(function (i) { if (!i.id) i.id = uid(); });
    return t;
  }

  function loadDB() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    if (raw) {
      try {
        var p = JSON.parse(raw);
        if (p && Array.isArray(p.trips) && p.trips.length) {
          p.trips = p.trips.map(migrate);
          DB = { trips: p.trips, active: p.active || p.trips[0].id };
          if (!DB.trips.some(function (t) { return t.id === DB.active; })) DB.active = DB.trips[0].id;
          return;
        }
      } catch (e) { /* fall through to a fresh trip */ }
    }
    var t = defTrip();
    DB = { trips: [t], active: t.id };
  }

  var saveTimer = null, storageOK = true;
  function mark(dirty) {
    var e = $('saved');
    e.className = 'saved' + (dirty ? ' dirty' : '');
    $('savedlab').textContent = !storageOK ? 'not saved — storage blocked' : (dirty ? 'saving…' : 'saved');
  }
  function saveDB() {
    mark(true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(DB));
        storageOK = true;
      } catch (e) { storageOK = false; }
      mark(false);
    }, 250);
  }
  function activate(id) {
    DB.active = id;
    T = DB.trips.filter(function (t) { return t.id === id; })[0] || DB.trips[0];
    saveDB(); fillForm(); refresh();
  }

  /* ---------------- live lookups ---------------- */
  var GEO = {}, LEG = {}, NET = null, Q = [], BUSY = false;

  function setNet(v) {
    NET = v;
    try { diag(); } catch (e) { }
    var e = $('net');
    e.className = 'net ' + (v === true ? 'on' : (v === false ? 'off' : ''));
    $('netlabel').textContent = v === true ? 'lookups live' : (v === false ? 'offline — type distances' : 'checking…');
  }
  function pump() {
    if (BUSY || !Q.length) return;
    BUSY = true;
    var j = Q.shift();
    j().then(function () { BUSY = false; setTimeout(pump, 1100); },
             function () { BUSY = false; setTimeout(pump, 1100); });
  }
  function enq(f) { Q.push(f); pump(); }

  function geocode(n) {
    n = String(n || '').trim();
    if (!n) return Promise.reject();
    if (GEO[n]) return Promise.resolve(GEO[n]);
    return fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(n))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.length) throw 0;
        GEO[n] = { lat: +j[0].lat, lon: +j[0].lon };
        return GEO[n];
      });
  }
  function lk(a, b) { return String(a).trim() + '||' + String(b).trim(); }

  function getLeg(a, b) {
    if (!a || !b || !String(a).trim() || !String(b).trim()) return null;
    var k = lk(a, b);
    if (LEG[k]) return LEG[k];
    LEG[k] = { state: 'pending' };
    enq(function () {
      return Promise.all([geocode(a), geocode(b)]).then(function (p) {
        return fetch('https://router.project-osrm.org/route/v1/driving/' +
          p[0].lon + ',' + p[0].lat + ';' + p[1].lon + ',' + p[1].lat + '?overview=full&geometries=geojson')
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j.routes || !j.routes[0]) throw 0;
            LEG[k] = {
              state: 'ok', km: j.routes[0].distance / 1000, h: j.routes[0].duration / 3600,
              geo: j.routes[0].geometry && j.routes[0].geometry.coordinates
            };
            setNet(true); refresh();
          });
      }).catch(function () {
        LEG[k] = { state: 'fail' };
        if (NET !== true) setNet(false);
        refresh();
      });
    });
    return LEG[k];
  }
  function ok(l) { return l && (l.state === 'ok' || l.state === 'manual') ? l : null; }
  function manual(a, b, km) { LEG[lk(a, b)] = { state: 'manual', km: km, h: km / 85 }; refresh(); }

  function reverseGeocode(lat, lon) {
    return fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&lat=' + lat + '&lon=' + lon)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var a = (j && j.address) || {};
        var town = a.town || a.city || a.village || a.hamlet || a.municipality || a.county;
        var region = a.state || a.province || a.country;
        if (town && region) return town + ', ' + region;
        if (j && j.display_name) return j.display_name.split(',').slice(0, 2).join(',').trim();
        return null;
      });
  }

  var PRESETS = {
    pab:  { a: 'Port aux Basques, NL', b: 'North Sydney, NS', sea: 7, t: '02:45' },
    arg:  { a: 'Argentia, NL', b: 'North Sydney, NS', sea: 16.5, t: '17:00' },
    none: { a: '', b: '', sea: 0, t: '08:00' }
  };

  /* ---------------- the route chain ---------------- */
  function ferryOn() { return !!(T.ferry.portA.trim() && T.ferry.portB.trim() && num(T.ferry.seaH) > 0); }

  function chain() {
    var F = ferryOn(), f = T.ferry;
    var c = [{ name: T.home, kind: 'home', pin: 'A', cls: 'a' }];
    if (F) {
      c.push({ name: f.portA, kind: 'port', pin: '⛴', cls: 'f' });
      c.push({ name: f.portB, kind: 'port', pin: '⛴', cls: 'f', sea: true });
    }
    T.stops.forEach(function (s) {
      if (s.side === 'out') c.push({ name: s.name, kind: 'stop', pin: '●', cls: 's', stop: s });
    });
    c.push({ name: T.dest, kind: 'dest', pin: 'B', cls: 'b' });
    if (T.type === 'return') {
      T.stops.forEach(function (s) {
        if (s.side === 'back') c.push({ name: s.name, kind: 'stop', pin: '●', cls: 's', stop: s });
      });
      if (F) {
        c.push({ name: f.portB, kind: 'port', pin: '⛴', cls: 'f' });
        c.push({ name: f.portA, kind: 'port', pin: '⛴', cls: 'f', sea: true });
      }
      c.push({ name: T.home, kind: 'home', pin: 'A', cls: 'a' });
    }
    for (var k = 1; k < c.length; k++) {
      c[k].leg = c[k].sea ? { sea: true } : getLeg(c[k - 1].name, c[k].name);
      c[k].from = c[k - 1].name;
    }
    return c;
  }

  function model() {
    var C = chain(), F = ferryOn(), f = T.ferry;
    var maxh = Math.max(3, num(T.maxDriveH, 8));
    var seaH = num(f.seaH), seaB = num(f.seaHB) || seaH, ci = num(f.ciH);
    var od = pd(f.outDate) || new Date();
    var ot = String(f.outTime || '08:00').split(':');
    var sail = new Date(od); sail.setHours(num(ot[0]), num(ot[1]), 0, 0);
    var checkin = addH(sail, -ci);
    var toPort = F ? ok(getLeg(T.home, f.portA)) : null;
    var mustLeave = addH(checkin, -(toPort ? toPort.h : 0));
    var land = addH(sail, seaH);
    var rsail = null, backLand = null;
    if (T.type === 'return') {
      var rd = pd(f.retDate), rt = String(f.retTime || '14:30').split(':');
      if (rd) { rsail = new Date(rd); rsail.setHours(num(rt[0]), num(rt[1]), 0, 0); backLand = addH(rsail, seaB); }
    }
    var totKm = 0, totH = 0, pending = false, unrouted = 0;
    for (var i = 1; i < C.length; i++) {
      var l = C[i].leg;
      if (!l || l.sea) continue;
      if (l.state === 'pending') pending = true;
      if (l.state === 'fail') unrouted++;
      var t = ok(l);
      if (t) { totKm += t.km; totH += t.h; }
    }
    return {
      C: C, F: F, maxh: maxh, seaH: seaH, seaB: seaB, ci: ci, sail: sail, checkin: checkin,
      mustLeave: mustLeave, land: land, rsail: rsail, backLand: backLand, toPort: toPort,
      totKm: totKm, totH: totH, pending: pending, unrouted: unrouted,
      tstart: pd(T.start), tend: pd(T.end), destN: num(T.destNights)
    };
  }

  /* ---------------- budget maths ---------------- */
  function tripDays(M) {
    if (!M.tstart || !M.tend) return 0;
    var n = nd(M.tstart, M.tend) + 1;
    return n > 0 ? Math.min(n, 400) : 0;
  }
  function fuelCost(M) {
    var l = num(T.l100), p = num(T.fuelPrice);
    if (!l || !p || M.pending) return 0;
    return M.totKm / 100 * l * p;
  }
  function lodgingPlanned() {
    var t = num(T.destNights) * num(T.destRate), unpriced = 0;
    T.stops.forEach(function (s) {
      var n = num(s.nights);
      if (!n) return;
      if (s.rate == null || s.rate === '') unpriced++;
      else t += n * num(s.rate);
    });
    return { total: t, unpriced: unpriced };
  }
  function itemsByCat(cat) {
    var t = 0;
    T.items.forEach(function (i) { if ((i.cat || 'misc') === cat) t += num(i.cost); });
    return t;
  }
  function linesByCat(cat) {
    var t = 0;
    T.budget.lines.forEach(function (l) { if (l.cat === cat) t += num(l.planned); });
    return t;
  }
  function plannedByCat(cat, M) {
    var base = 0;
    if (cat === 'lodging') base = lodgingPlanned().total;
    else if (cat === 'fuel') base = fuelCost(M);
    else if (cat === 'ferry') base = ferryOn() ? num(T.ferry.cost) : 0;
    return base + linesByCat(cat) + itemsByCat(cat);
  }
  function budgetRows(M) {
    // One row per auto category, then every custom line, then itinerary-item roll-ups.
    var rows = [];
    CATS.forEach(function (c) {
      if (!c.auto) return;
      var base = c.k === 'lodging' ? lodgingPlanned().total
               : c.k === 'fuel' ? fuelCost(M)
               : (ferryOn() ? num(T.ferry.cost) : 0);
      var note = c.k === 'lodging' ? 'from nights × rates'
               : c.k === 'fuel' ? (num(T.l100) && num(T.fuelPrice)
                   ? Math.round(M.totKm).toLocaleString() + ' km · ' + num(T.l100) + ' L/100'
                   : 'set L/100 km and $/L')
               : 'as entered';
      var a = T.budget.actual[c.k];
      rows.push({ key: c.k, cat: c.k, label: c.n, planned: base, actual: (a == null ? null : num(a)),
                  auto: true, note: note });
    });
    T.budget.lines.forEach(function (l) {
      rows.push({ key: l.id, id: l.id, cat: l.cat, label: l.label, planned: num(l.planned),
                  actual: (l.actual == null || l.actual === '' ? null : num(l.actual)), auto: false });
    });
    // Itinerary items become one read-only row per category so they are visible in the table.
    CATS.forEach(function (c) {
      var v = itemsByCat(c.k);
      if (v > 0) rows.push({ key: 'it-' + c.k, cat: c.k, label: 'Itinerary items · ' + c.n,
                             planned: v, actual: null, items: true, note: 'from the itinerary' });
    });
    return rows;
  }
  function budgetTotals(M) {
    var rows = budgetRows(M), planned = 0, actual = 0, anyActual = false;
    // plannedSoFar only counts lines that have an actual, so the headline
    // difference is like-for-like instead of the whole trip against one receipt.
    var plannedSoFar = 0, withActual = 0, costed = 0;
    rows.forEach(function (r) {
      planned += r.planned;
      if (r.planned > 0 || r.actual != null) costed++;
      if (r.actual != null) {
        actual += r.actual; plannedSoFar += r.planned; withActual++; anyActual = true;
      }
    });
    var cont = planned * num(T.budget.conting) / 100;
    return { rows: rows, planned: planned, actual: actual, anyActual: anyActual,
             plannedSoFar: plannedSoFar, withActual: withActual, costed: costed,
             conting: cont, withCont: planned + cont };
  }

  /* ---------------- schedule ---------------- */
  function schedule(M) {
    var ev = {}, bands = [];
    function push(d, o) { var k = iso(d); (ev[k] = ev[k] || []).push(o); }

    var cur;
    if (M.F) {
      push(M.mustLeave, { k: 'drive', t: hhmm(M.mustLeave), l: 'Drive to ' + String(T.ferry.portA).split(',')[0], auto: 1 });
      push(M.sail, { k: 'ferry', t: hhmm(M.sail), l: 'Crossing', auto: 1 });
      if (nd(M.sail, M.land) !== 0) push(M.land, { k: 'ferry', t: hhmm(M.land), l: 'Docks', auto: 1 });
      cur = day0(M.land);
    } else {
      cur = M.tstart ? day0(M.tstart) : day0(new Date());
      push(cur, { k: 'drive', t: '', l: 'Set off', auto: 1 });
    }

    T.stops.forEach(function (st) {
      if (st.side !== 'out') return;
      var n = num(st.nights);
      push(cur, { k: 'drive', t: '', l: 'Drive to ' + (st.name || 'stop'), auto: 1 });
      if (n > 0) { bands.push({ name: st.name || 'Stop', from: new Date(cur), to: addD(cur, n), mine: true }); cur = addD(cur, n); }
    });
    push(cur, { k: 'drive', t: '', l: 'Arrive ' + String(T.dest).split(',')[0], auto: 1 });
    if (M.destN > 0) { bands.push({ name: T.dest, from: new Date(cur), to: addD(cur, M.destN), mine: false }); cur = addD(cur, M.destN); }

    if (T.type === 'return') {
      push(cur, { k: 'drive', t: '', l: 'Leave ' + String(T.dest).split(',')[0], auto: 1 });
      T.stops.forEach(function (sb) {
        if (sb.side !== 'back') return;
        var nb = num(sb.nights);
        push(cur, { k: 'drive', t: '', l: 'Drive to ' + (sb.name || 'stop'), auto: 1 });
        if (nb > 0) { bands.push({ name: sb.name || 'Stop', from: new Date(cur), to: addD(cur, nb), mine: true }); cur = addD(cur, nb); }
      });
      if (M.F && M.rsail) {
        push(M.rsail, { k: 'ferry', t: hhmm(M.rsail), l: 'Crossing home', auto: 1 });
        if (M.backLand && nd(M.rsail, M.backLand) !== 0)
          push(M.backLand, { k: 'ferry', t: hhmm(M.backLand), l: 'Docks', auto: 1 });
      }
      if (M.tend) push(M.tend, { k: 'drive', t: '', l: 'Home', auto: 1 });
    }

    // user items
    T.items.forEach(function (i) {
      if (!i.date) return;
      var d = pd(i.date);
      if (d) push(d, { k: 'item', t: i.time || '', l: i.title || '(untitled)', cost: num(i.cost), item: i });
    });
    Object.keys(ev).forEach(function (k) {
      ev[k].sort(function (a, b) { return String(a.t || '99:99').localeCompare(String(b.t || '99:99')); });
    });
    return { ev: ev, bands: bands };
  }

  function bandFor(SC, d) {
    for (var q = 0; q < SC.bands.length; q++) {
      var B = SC.bands[q];
      if (d >= day0(B.from) && d < day0(B.to)) return B;
    }
    return null;
  }

  /* ---------------- per-day money ---------------- */
  function dailySpend(M, SC) {
    var days = [], n = tripDays(M);
    if (!n) return days;
    var start = day0(M.tstart);
    for (var i = 0; i < n; i++) days.push({ d: addD(start, i), v: 0 });
    function idx(d) { var i = nd(start, day0(d)); return (i >= 0 && i < n) ? i : -1; }

    // lodging: the rate lands on each night of each band
    SC.bands.forEach(function (B) {
      var nights = nd(day0(B.from), day0(B.to));
      var rate = B.mine ? null : num(T.destRate);
      if (B.mine) {
        var st = T.stops.filter(function (s) { return (s.name || 'Stop') === B.name; })[0];
        rate = st && st.rate != null && st.rate !== '' ? num(st.rate) : 0;
      }
      for (var j = 0; j < nights; j++) {
        var i = idx(addD(day0(B.from), j));
        if (i >= 0) days[i].v += rate;
      }
    });
    // fuel: spread across the days that have a drive event
    var driveDays = [];
    Object.keys(SC.ev).forEach(function (k) {
      if (SC.ev[k].some(function (e) { return e.k === 'drive'; })) {
        var i = idx(pd(k)); if (i >= 0) driveDays.push(i);
      }
    });
    var fc = fuelCost(M);
    if (fc && driveDays.length) driveDays.forEach(function (i) { days[i].v += fc / driveDays.length; });
    // ferry: split across the sailings that exist
    if (ferryOn()) {
      var sails = [idx(M.sail)];
      if (T.type === 'return' && M.rsail) sails.push(idx(M.rsail));
      sails = sails.filter(function (i) { return i >= 0; });
      var per = num(T.ferry.cost) / (sails.length || 1);
      sails.forEach(function (i) { days[i].v += per; });
    }
    // itinerary items on their own date
    T.items.forEach(function (it) {
      var i = it.date ? idx(pd(it.date)) : -1;
      if (i >= 0) days[i].v += num(it.cost);
    });
    // undated custom lines spread evenly
    var undated = 0;
    T.budget.lines.forEach(function (l) { undated += num(l.planned); });
    if (undated && n) days.forEach(function (x) { x.v += undated / n; });

    return days;
  }

  /* ---------------- render: stats ---------------- */
  function renderStats(M, B) {
    var nights = M.destN;
    T.stops.forEach(function (s) { nights += num(s.nights); });
    var sea = M.F ? (M.seaH + (T.type === 'return' ? M.seaB : 0)) : 0;
    var days = tripDays(M);
    var per = num(T.travellers, 1) || 1;
    var diff = B.plannedSoFar - B.actual;

    var h = '';
    h += '<div class="stat"><div class="k">Days</div><div class="v">' + (days || '—') + '</div>' +
         '<div class="s">' + (M.tstart ? fmt(M.tstart) : '—') + '</div></div>';
    h += '<div class="stat"><div class="k">Distance</div><div class="v">' +
         (M.pending ? '…' : Math.round(M.totKm).toLocaleString() + ' km') + '</div>' +
         '<div class="s">' + (M.pending ? 'looking up' : hh(M.totH) + ' driving') + '</div></div>';
    if (sea) h += '<div class="stat"><div class="k">At sea</div><div class="v">' + hh(sea) + '</div>' +
                  '<div class="s">' + (T.type === 'return' ? 'both ways' : 'one way') + '</div></div>';
    h += '<div class="stat"><div class="k">Nights</div><div class="v">' + nights + '</div>' +
         '<div class="s">' + M.destN + ' at the destination</div></div>';
    h += '<div class="stat"><div class="k">Planned</div><div class="v">' + money(B.planned) + '</div>' +
         '<div class="s">' + money(B.planned / per) + ' each · ' +
         (days ? money(B.planned / days) + '/day' : '—') + '</div></div>';
    if (B.anyActual)
      h += '<div class="stat"><div class="k">Actual so far</div><div class="v">' + money(B.actual) + '</div>' +
           '<div class="s"><span class="' + (diff >= 0 ? 'diff under' : 'diff over') + '">' +
           (diff >= 0 ? money(diff) + ' under' : money(-diff) + ' over') + '</span> on ' +
           B.withActual + ' of ' + B.costed + ' lines</div></div>';
    else
      h += '<div class="stat"><div class="k">With ' + num(T.budget.conting) + '% buffer</div><div class="v">' +
           money(B.withCont) + '</div><div class="s">' + money(B.conting) + ' set aside</div></div>';
    $('stats').innerHTML = h;
  }

  /* ---------------- render: stops ---------------- */
  function legHTML(l, a, b) {
    if (!l) return '';
    if (l.sea) return '<div class="leg"><span>⛴ <b>' + hh(num(T.ferry.seaH)) + '</b> at sea</span></div>';
    if (l.state === 'pending') return '<div class="leg"><span class="pend">looking up…</span></div>';
    if (l.state === 'fail') return '<div class="leg"><span class="fail">no route found</span>' +
      '<input type="number" placeholder="km" data-a="' + esc(a) + '" data-b="' + esc(b) + '"></div>';
    var l100 = num(T.l100), fp = num(T.fuelPrice);
    var cost = (l100 && fp) ? ' · <b>' + money(l.km / 100 * l100 * fp) + '</b> fuel' : '';
    return '<div class="leg"><span>🚗 <b>' + Math.round(l.km).toLocaleString() + ' km</b></span>' +
      '<span><b>' + hh(l.h) + '</b></span>' + (l.state === 'manual' ? '<span class="pend">yours</span>' : '') +
      '<span>' + cost + '</span></div>';
  }

  function renderSteps(M) {
    var h = '', outN = T.stops.filter(function (s) { return s.side === 'out'; }).length;
    var backN = T.stops.filter(function (s) { return s.side === 'back'; }).length;
    for (var i = 0; i < M.C.length; i++) {
      var c = M.C[i];
      if (c.leg) h += legHTML(c.leg, c.from, c.name);
      if (c.stop) {
        var s = c.stop;
        var sameSide = T.stops.filter(function (x) { return x.side === s.side; });
        var pos = sameSide.indexOf(s), last = sameSide.length - 1;
        h += '<div class="node" data-id="' + s.id + '">' +
          '<div class="hd"><div class="pin ' + c.cls + '">' + i + '</div>' +
          '<input class="nm" data-f="name" type="text" value="' + esc(s.name) + '" placeholder="Town or city">' +
          '<span class="ctl">' +
            '<button class="iconbtn" data-mv="up" title="Move earlier"' + (pos === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="iconbtn" data-mv="down" title="Move later"' + (pos === last ? ' disabled' : '') + '>↓</button>' +
            '<button class="iconbtn del" data-del="1" title="Remove">×</button>' +
          '</span></div>' +
          '<div class="fields">' +
            '<input data-f="notes" type="text" value="' + esc(s.notes || '') + '" placeholder="Note — booking, who to see, why stop">' +
            '<input data-f="nights" type="number" min="0" max="60" value="' + num(s.nights) + '" title="Nights" aria-label="Nights">' +
            '<input data-f="rate" type="number" min="0" step="5" value="' + (s.rate == null ? '' : s.rate) + '" placeholder="$/night" aria-label="Cost per night">' +
          '</div></div>';
      } else {
        var extra = c.kind === 'dest' ? num(T.destNights) + ' nights · ' + money(num(T.destRate)) + '/night'
                  : (c.kind === 'home' ? 'start / end' : 'ferry terminal');
        h += '<div class="node"><div class="hd"><div class="pin ' + c.cls + '">' + c.pin + '</div>' +
          '<div class="nm">' + esc(c.name || '—') + '</div>' +
          '<div class="fixed">' + extra + '</div></div></div>';
      }
    }
    if (!outN && !backN) h += '<p class="hint">No stops yet — add one, or click the map.</p>';
    $('steps').innerHTML = h;
  }

  /* ---------------- render: map ---------------- */
  var MAP = null, LAYER = null, TILES_OK = null, LEAFLET = (typeof L !== 'undefined');

  function diag() {
    function dot(v) { return '<i class="' + (v === true ? 'y' : (v === false ? 'n' : '')) + '"></i>'; }
    $('diag').innerHTML =
      '<span>' + dot(LEAFLET) + 'map library ' + (LEAFLET ? 'loaded' : 'blocked') + '</span>' +
      '<span>' + dot(NET) + 'lookups ' + (NET === true ? 'working' : (NET === false ? 'blocked' : '…')) + '</span>' +
      '<span>' + dot(TILES_OK) + 'map tiles ' + (TILES_OK === true ? 'loading' : (TILES_OK === false ? 'blocked' : '…')) + '</span>';
  }

  function renderSchematic(M) {
    var h = '<div class="schem"><div class="schem-t">Route</div>';
    for (var i = 0; i < M.C.length; i++) {
      var c = M.C[i], l = c.leg;
      if (l) {
        var txt = l.sea ? '⛴ ' + hh(num(T.ferry.seaH)) + ' at sea'
          : (l.state === 'ok' || l.state === 'manual') ? Math.round(l.km).toLocaleString() + ' km · ' + hh(l.h)
          : (l.state === 'pending' ? 'looking up…' : 'distance not set');
        h += '<div class="sbar' + (l.sea ? ' sea' : '') + '">' + txt + '</div>';
      }
      h += '<div class="srow"><div class="sdot ' + (c.cls || '') + '">' + (c.stop ? i : c.pin) + '</div>' +
        '<div class="sname">' + esc(c.name || '—') + '</div></div>';
    }
    $('schematic').innerHTML = h + '</div>';
  }

  function renderMap(M) {
    LEAFLET = (typeof L !== 'undefined');
    renderSchematic(M);
    if (!LEAFLET) {
      $('map').style.display = 'none';
      $('schematic').style.display = 'block';
      $('mapmsg').style.display = 'block';
      $('mapmsg').textContent = 'Map library is blocked here — showing the route as a list instead.';
      $('maphint').style.display = 'none';
      diag(); return;
    }
    $('map').style.display = '';
    $('mapmsg').style.display = 'none';

    if (!MAP) {
      try {
        MAP = L.map('map', { scrollWheelZoom: false }).setView([47.5, -60], 5);
        var tl = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          { maxZoom: 18, attribution: '© OpenStreetMap' });
        tl.on('tileload', function () { if (TILES_OK !== true) { TILES_OK = true; diag(); } });
        tl.on('tileerror', function () {
          if (TILES_OK === null) {
            TILES_OK = false; diag();
            $('schematic').style.display = 'block';
            $('mapmsg').style.display = 'block';
            $('mapmsg').textContent = 'Map tiles are blocked here — the route list below still works.';
          }
        });
        tl.addTo(MAP);
        MAP.on('click', onMapClick);
        setTimeout(function () { if (TILES_OK === null) { TILES_OK = false; diag(); $('schematic').style.display = 'block'; } }, 6000);
      } catch (err) { MAP = null; }
    }
    if (!MAP) { diag(); return; }

    if (LAYER) MAP.removeLayer(LAYER);
    LAYER = L.layerGroup().addTo(MAP);
    var bounds = [];
    for (var i = 0; i < M.C.length; i++) {
      var c = M.C[i], g = GEO[String(c.name || '').trim()];
      if (g) {
        bounds.push([g.lat, g.lon]);
        L.marker([g.lat, g.lon], {
          icon: L.divIcon({
            className: '', html: '<div class="marker ' + (c.cls || '') + '">' + (c.stop ? i : c.pin) + '</div>',
            iconSize: [24, 24], iconAnchor: [12, 12]
          })
        }).addTo(LAYER).bindPopup(esc(c.name));
      }
      var l = c.leg;
      if (l && l.geo && l.geo.length) {
        var line = l.geo.map(function (pt) { return [pt[1], pt[0]]; });
        L.polyline(line, { color: cssVar('--drive'), weight: 4, opacity: .85 }).addTo(LAYER);
        bounds = bounds.concat(line);
      } else if (l && l.sea) {
        var a = GEO[String(M.C[i - 1].name || '').trim()], b2 = GEO[String(c.name || '').trim()];
        if (a && b2) L.polyline([[a.lat, a.lon], [b2.lat, b2.lon]],
          { color: cssVar('--ferry'), weight: 3, dashArray: '6 6', opacity: .9 }).addTo(LAYER);
      }
    }
    if (bounds.length > 1) { try { MAP.fitBounds(bounds, { padding: [24, 24] }); } catch (e) { } }
    if (!bounds.length) {
      $('schematic').style.display = 'block';
      $('mapmsg').style.display = 'block';
      $('mapmsg').textContent = 'No coordinates yet — place lookups are ' + (NET === false ? 'blocked' : 'still running') + '.';
    } else {
      $('schematic').style.display = TILES_OK === false ? 'block' : 'none';
    }
    diag();
  }

  function cssVar(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#eb6834';
  }

  var pendingClick = false;
  function onMapClick(e) {
    if (pendingClick) return;
    pendingClick = true;
    var lat = e.latlng.lat.toFixed(5), lon = e.latlng.lng.toFixed(5);
    $('maphint').textContent = 'Looking up what is at that spot…';
    enq(function () {
      return reverseGeocode(lat, lon).then(function (name) {
        pendingClick = false;
        if (!name) { $('maphint').textContent = 'Nothing found there — try nearer a town.'; return; }
        GEO[name] = { lat: +lat, lon: +lon };
        var side = (T.type === 'return' && T.stops.filter(function (s) { return s.side === 'out'; }).length >= 1
                    && T.stops.filter(function (s) { return s.side === 'back'; }).length === 0) ? 'out' : 'out';
        T.stops.push({ id: uid(), name: name, side: side, nights: 1, rate: null, notes: '' });
        $('maphint').textContent = 'Added ' + name + '. Click the map again for another.';
        saveDB(); refresh();
      }).catch(function () {
        pendingClick = false;
        $('maphint').textContent = 'That lookup failed — add the stop with the button instead.';
      });
    });
  }

  /* ---------------- render: derived + checks ---------------- */
  function renderDerived(M) {
    var h = '';
    if (M.F) {
      h += '<div class="dv"><div class="k">Set off</div><div class="v">' + (M.toPort ? hhmm(M.mustLeave) : '—') + '</div>' +
        '<div class="s">' + (M.toPort ? fmt(M.mustLeave) + ' · ' + Math.round(M.toPort.km) + ' km · ' + hh(M.toPort.h)
          : 'waiting on the lookup') + '</div></div>' +
        '<div class="dv f"><div class="k">Checked in by</div><div class="v">' + hhmm(M.checkin) + '</div>' +
        '<div class="s">' + fmt(M.checkin) + ' · ' + M.ci + 'h before</div></div>' +
        '<div class="dv f"><div class="k">Docks</div><div class="v">' + hhmm(M.land) + '</div>' +
        '<div class="s">' + fmt(M.land) + ' · ' + hh(M.seaH) + ' at sea</div></div>';
    }
    var need = M.pending ? null : Math.ceil(M.totH / M.maxh);
    h += '<div class="dv"><div class="k">Driving days needed</div><div class="v">' + (need == null ? '…' : need) + '</div>' +
      '<div class="s">' + (M.pending ? 'still looking up' : Math.round(M.totH) + 'h total at ' + M.maxh + 'h a day') + '</div></div>';
    $('derived').innerHTML = h;
  }

  function renderChecks(M) {
    var m = [];
    if (M.tstart && M.tend && M.tend <= M.tstart) m.push('Trip end is before the start.');
    var span = (M.tstart && M.tend) ? nd(M.tstart, M.tend) : 0;
    var nights = M.destN;
    T.stops.forEach(function (s) { nights += num(s.nights); });
    var need = M.pending ? 0 : Math.ceil(M.totH / M.maxh);
    var used = nights + need;
    if (M.unrouted) m.push(M.unrouted + ' leg' + (M.unrouted === 1 ? '' : 's') +
      ' could not be routed — type the distance in, or check the spelling.');
    if (span && used > span)
      m.push('Your stops and driving need about <b>' + used + '</b> days but the trip window is <b>' + span +
        '</b> — trim a stop, or move the end date.');
    if (m.length) { $('checks').innerHTML = '<div class="warn">' + m.join('<br>') + '</div>'; return; }
    $('checks').innerHTML = '<div class="okline">' + (M.pending ? 'Looking up distances…' :
      'About <b>' + used + '</b> days used of a <b>' + span + '</b>-day window — <b>' +
      Math.max(0, span - used) + '</b> spare.') + '</div>';
  }

  /* ---------------- render: itinerary ---------------- */
  function renderDays(M, SC) {
    if (!M.tstart || !M.tend || tripDays(M) < 1) {
      $('days').innerHTML = '<p class="empty">Set a start and end date to lay the days out.</p>';
      return;
    }
    var n = tripDays(M), start = day0(M.tstart), h = '';
    for (var i = 0; i < n; i++) {
      var d = addD(start, i), k = iso(d), evs = SC.ev[k] || [], B = bandFor(SC, d);
      var body = '';
      evs.forEach(function (e) {
        if (e.k === 'item') {
          var it = e.item;
          body += '<div class="itrow" data-item="' + it.id + '">' +
            '<input data-f="time" type="time" value="' + esc(it.time || '') + '" aria-label="Time">' +
            '<input data-f="title" type="text" value="' + esc(it.title || '') + '" placeholder="What is happening" aria-label="Title">' +
            '<select data-f="cat" aria-label="Category">' + catOptions(it.cat || 'misc') + '</select>' +
            '<input data-f="cost" type="number" min="0" step="5" value="' + (it.cost == null ? '' : it.cost) + '" placeholder="$" aria-label="Cost">' +
            '<button class="iconbtn del" data-delitem="' + it.id + '" title="Remove">×</button>' +
            '</div>';
        } else {
          body += '<div class="ev"><span class="tm">' + esc(e.t || '') + '</span>' +
            '<span class="tag ' + e.k + '"></span><span class="lb">' + esc(e.l) + '</span>' +
            '<span class="auto">auto</span></div>';
        }
      });
      body += '<div class="addit"><button class="btn sm" data-add="' + k + '">+ Add to this day</button></div>';

      h += '<div class="day' + (evs.length ? '' : ' rest') + '">' +
        '<div class="dhd"><span class="dnum">Day ' + (i + 1) + '</span>' +
        '<span class="ddate">' + fmtLong(d) + '</span>' +
        (B ? '<span class="dsleep"><i class="' + (B.mine ? 'mine' : '') + '"></i>' + esc(B.name) + '</span>' : '') +
        '</div><div class="dbody">' + body + '</div></div>';
    }
    $('days').innerHTML = h;
  }

  function renderCal(M, SC) {
    var a = M.tstart ? day0(M.tstart) : day0(new Date());
    var b = M.tend ? day0(M.tend) : addD(a, 14);
    if (b < a) b = addD(a, 1);
    if (nd(a, b) > 200) b = addD(a, 200);
    var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], out = '', g = 0;
    var m = new Date(a.getFullYear(), a.getMonth(), 1), lastM = new Date(b.getFullYear(), b.getMonth(), 1);
    while (m <= lastM && g++ < 8) {
      var y = m.getFullYear(), mo = m.getMonth(), dim = new Date(y, mo + 1, 0).getDate();
      out += '<div class="mname">' + m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + '</div><div class="cal">';
      for (var i = 0; i < 7; i++) out += '<div class="dow">' + DOW[i] + '</div>';
      var lead = new Date(y, mo, 1).getDay();
      for (var p = 0; p < lead; p++) out += '<div class="cd out"></div>';
      for (var dd = 1; dd <= dim; dd++) {
        var d = new Date(y, mo, dd), k = iso(d);
        var inTrip = (d >= a && d <= b), evs = SC.ev[k] || [], cell = '';
        for (var e = 0; e < evs.length && e < 3; e++)
          cell += '<div class="cev ' + evs[e].k + '">' + (evs[e].t ? '<span class="tm">' + esc(evs[e].t) + '</span> ' : '') +
            esc(evs[e].l) + '</div>';
        if (evs.length > 3) cell += '<div class="cev item">+' + (evs.length - 3) + ' more</div>';
        var band = '', B = bandFor(SC, d);
        if (B) {
          var isStart = (nd(day0(B.from), d) === 0), isEnd = (nd(d, day0(B.to)) === 1);
          var pos = isStart && isEnd ? 'solo' : (isStart ? 'start' : (isEnd ? 'end' : 'mid'));
          band = '<div class="band' + (B.mine ? ' mine' : '') + ' ' + pos + (isStart ? '' : ' cont') + '">' + esc(B.name) + '</div>';
        }
        out += '<div class="cd' + (inTrip ? ' act' : '') + '"><div class="num">' + dd + '</div>' + cell + band + '</div>';
      }
      var tail = (7 - ((lead + dim) % 7)) % 7;
      for (var t2 = 0; t2 < tail; t2++) out += '<div class="cd out"></div>';
      out += '</div>';
      m = new Date(y, mo + 1, 1);
    }
    $('cal').innerHTML = out;
  }

  /* ---------------- render: budget table ---------------- */
  function renderBudget(M, B) {
    var h = '';
    B.rows.forEach(function (r) {
      var diff = r.actual == null ? null : r.planned - r.actual;
      h += '<tr' + (r.items ? ' class="sub"' : '') + ' data-row="' + esc(r.key) + '">' +
        '<td class="lbl"><span class="catdot" style="background:' + catColor(r.cat) + '"></span>' +
          esc(r.label) + (r.note ? '<span class="auto">' + esc(r.note) + '</span>' : '') + '</td>';
      if (r.auto || r.items) {
        h += '<td class="r">' + money(r.planned) + '</td>';
      } else {
        h += '<td class="r"><input data-line="' + r.id + '" data-f="planned" type="number" min="0" step="5" value="' +
          (r.planned === 0 ? '' : r.planned) + '" placeholder="0" aria-label="Planned"></td>';
      }
      if (r.items) {
        h += '<td class="r">—</td><td class="r">—</td><td></td>';
      } else if (r.auto) {
        h += '<td class="r"><input data-actual="' + r.cat + '" type="number" min="0" step="5" value="' +
          (r.actual == null ? '' : r.actual) + '" placeholder="—" aria-label="Actual"></td>';
        h += '<td class="r ' + (diff == null ? '' : (diff >= 0 ? 'diff under' : 'diff over')) + '">' +
          (diff == null ? '—' : money(diff)) + '</td><td></td>';
      } else {
        h += '<td class="r"><input data-line="' + r.id + '" data-f="actual" type="number" min="0" step="5" value="' +
          (r.actual == null ? '' : r.actual) + '" placeholder="—" aria-label="Actual"></td>';
        h += '<td class="r ' + (diff == null ? '' : (diff >= 0 ? 'diff under' : 'diff over')) + '">' +
          (diff == null ? '—' : money(diff)) + '</td>' +
          '<td class="r"><button class="iconbtn del" data-delline="' + r.id + '" title="Remove line">×</button></td>';
      }
      h += '</tr>';
    });

    var cont = num(T.budget.conting);
    if (cont) h += '<tr class="sub"><td class="lbl"><span class="catdot"></span>Contingency ' + cont + '%</td>' +
      '<td class="r">' + money(B.conting) + '</td><td class="r">—</td><td class="r">—</td><td></td></tr>';

    var tdiff = B.plannedSoFar - B.actual;
    h += '<tr class="tot"><td>Total</td><td class="r">' + money(B.withCont) + '</td>' +
      '<td class="r">' + (B.anyActual ? money(B.actual) : '—') + '</td>' +
      '<td class="r ' + (B.anyActual ? (tdiff >= 0 ? 'diff under' : 'diff over') : '') + '">' +
      (B.anyActual ? money(tdiff) : '—') + '</td><td></td></tr>';
    if (B.anyActual && B.withActual < B.costed)
      h += '<tr class="sub"><td colspan="5" style="border:none;padding-top:6px">' +
        '<span class="hint">Difference covers only the ' + B.withActual + ' line' +
        (B.withActual === 1 ? '' : 's') + ' with an actual entered (of ' + B.costed +
        ' costed) — against ' + money(B.plannedSoFar) + ' planned on those lines.</span></td></tr>';
    $('budgetbody').innerHTML = h;

    var lp = lodgingPlanned(), per = num(T.travellers, 1) || 1, days = tripDays(M);
    var bits = [];
    bits.push('<b>' + money(B.withCont / per) + '</b> a head for ' + per + ' traveller' + (per === 1 ? '' : 's'));
    if (days) bits.push('<b>' + money(B.withCont / days) + '</b> a day over ' + days + ' days');
    if (lp.unpriced) bits.push('<span class="q">' + lp.unpriced + ' stop' + (lp.unpriced === 1 ? '' : 's') +
      ' with no nightly rate</span> — counted, not guessed');
    if (!num(T.l100) || !num(T.fuelPrice)) bits.push('<span class="q">fuel not costed</span> — set L/100 km and $/litre');
    $('bnote').innerHTML = bits.join(' · ');
  }

  function catColor(k) {
    var m = { lodging: '--stay', fuel: '--drive', ferry: '--ferry', food: '--free',
              activities: '--series-1', tolls: '--ink3', misc: '--ink3' };
    return 'var(' + (m[k] || '--ink3') + ')';
  }

  /* ---------------- charts ---------------- */
  function svgOpen(w, h) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" preserveAspectRatio="xMinYMin meet">';
  }
  function niceMax(v) {
    if (v <= 0) return 100;
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    var s = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return s * e;
  }

  /* Chart 1 — planned vs actual by category, horizontal grouped bars. */
  function renderChart1(M, B) {
    var agg = {};
    B.rows.forEach(function (r) {
      var a = agg[r.cat] || (agg[r.cat] = { p: 0, a: 0, hasA: false });
      a.p += r.planned;
      if (r.actual != null) { a.a += r.actual; a.hasA = true; }
    });
    var data = CATS.map(function (c) {
      var a = agg[c.k] || { p: 0, a: 0, hasA: false };
      return { k: c.k, n: c.n, p: a.p, a: a.a, hasA: a.hasA };
    }).filter(function (d) { return d.p > 0 || d.hasA; });

    if (!data.length) { $('chart1').innerHTML = '<p class="empty">Nothing costed yet.</p>'; return; }

    var showActual = data.some(function (d) { return d.hasA; });
    $('c1sub').textContent = showActual ? 'Planned against actual, by category'
                                       : 'Planned by category — actuals appear as you enter them';

    var W = 560, gut = 116, right = 62, bh = showActual ? 11 : 14, gap = 2, grp = showActual ? 16 : 12;
    var rowH = showActual ? bh * 2 + gap + grp : bh + grp;
    var H = data.length * rowH + 26;
    var max = niceMax(Math.max.apply(null, data.map(function (d) { return Math.max(d.p, d.a); })));
    var plotW = W - gut - right;
    var x = function (v) { return gut + (v / max) * plotW; };

    var s = svgOpen(W, H);
    // gridlines + ticks
    for (var t = 0; t <= 4; t++) {
      var gv = max * t / 4, gx = x(gv);
      s += '<line class="gridline" x1="' + gx + '" y1="14" x2="' + gx + '" y2="' + (H - 12) + '"></line>';
      s += '<text class="tick" x="' + gx + '" y="' + (H - 2) + '" text-anchor="middle">' +
        (gv >= 1000 ? Math.round(gv / 1000) + 'k' : Math.round(gv)) + '</text>';
    }
    s += '<line class="axisline" x1="' + gut + '" y1="14" x2="' + gut + '" y2="' + (H - 12) + '"></line>';

    data.forEach(function (d, i) {
      var y0 = 14 + i * rowH;
      s += '<text class="catlab" x="' + (gut - 10) + '" y="' + (y0 + (showActual ? bh + 1 : bh - 3)) +
        '" text-anchor="end">' + esc(d.n) + '</text>';
      // planned
      s += bar(gut, y0, x(d.p) - gut, bh, 'var(--series-1)',
        d.n + ' · planned ' + money(d.p));
      s += '<text class="vlab" x="' + (x(d.p) + 6) + '" y="' + (y0 + bh - 2) + '">' + money(d.p) + '</text>';
      if (showActual) {
        var y1 = y0 + bh + gap;
        if (d.hasA) {
          s += bar(gut, y1, x(d.a) - gut, bh, 'var(--series-2)', d.n + ' · actual ' + money(d.a));
          s += '<text class="vlab" x="' + (x(d.a) + 6) + '" y="' + (y1 + bh - 2) + '">' + money(d.a) + '</text>';
        } else {
          s += '<text class="tick" x="' + (gut + 6) + '" y="' + (y1 + bh - 2) + '">no actual yet</text>';
        }
      }
    });
    $('chart1').innerHTML = s + '</svg>';
  }

  // A bar with a 4px rounded data-end, anchored to the baseline.
  function bar(x0, y0, w, h, fill, tip) {
    w = Math.max(0, w);
    var r = Math.min(4, w);
    if (w < 0.5) return '';
    var d = 'M' + x0 + ' ' + y0 + 'H' + (x0 + w - r) +
      'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r +
      'V' + (y0 + h - r) + 'a' + r + ' ' + r + ' 0 0 1 ' + (-r) + ' ' + r + 'H' + x0 + 'Z';
    return '<path class="mk" d="' + d + '" fill="' + fill + '"></path>' +
      '<rect class="hit" x="' + x0 + '" y="' + (y0 - 2) + '" width="' + Math.max(w, 3) + '" height="' + (h + 4) +
      '" data-tip="' + esc(tip) + '"></rect>';
  }

  /* Chart 2 — spend per day, vertical bars. */
  function renderChart2(days) {
    if (!days.length) { $('chart2').innerHTML = '<p class="empty">Set the trip dates to see this.</p>'; return; }
    var W = 560, H = 210, left = 46, bottom = 30, top = 12;
    var plotW = W - left - 12, plotH = H - top - bottom;
    var max = niceMax(Math.max.apply(null, days.map(function (d) { return d.v; })));
    var bw = Math.max(3, plotW / days.length - 2);
    var s = svgOpen(W, H);
    for (var t = 0; t <= 4; t++) {
      var gv = max * t / 4, gy = top + plotH - (gv / max) * plotH;
      s += '<line class="gridline" x1="' + left + '" y1="' + gy + '" x2="' + (W - 12) + '" y2="' + gy + '"></line>';
      s += '<text class="tick" x="' + (left - 8) + '" y="' + (gy + 3) + '" text-anchor="end">' +
        (gv >= 1000 ? Math.round(gv / 1000) + 'k' : Math.round(gv)) + '</text>';
    }
    days.forEach(function (d, i) {
      var bx = left + i * (plotW / days.length) + 1;
      var bh2 = (d.v / max) * plotH;
      var by = top + plotH - bh2;
      var r = Math.min(4, bw / 2, bh2);
      if (bh2 > 0.5) {
        var path = 'M' + bx + ' ' + (top + plotH) + 'V' + (by + r) +
          'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + (-r) + 'H' + (bx + bw - r) +
          'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'V' + (top + plotH) + 'Z';
        s += '<path class="mk" d="' + path + '" fill="var(--series-1)"></path>';
      }
      s += '<rect class="hit" x="' + bx + '" y="' + top + '" width="' + Math.max(bw, 8) + '" height="' + plotH +
        '" data-tip="' + esc(fmt(d.d) + ' · ' + money(d.v)) + '"></rect>';
      if (i === 0 || i === days.length - 1 || (days.length > 6 && i === Math.floor(days.length / 2)))
        s += '<text class="tick" x="' + (bx + bw / 2) + '" y="' + (H - 12) + '" text-anchor="middle">' +
          d.d.getDate() + ' ' + d.d.toLocaleDateString('en-US', { month: 'short' }) + '</text>';
    });
    s += '<line class="axisline" x1="' + left + '" y1="' + (top + plotH) + '" x2="' + (W - 12) + '" y2="' + (top + plotH) + '"></line>';
    var undated = 0;
    T.budget.lines.forEach(function (l) { undated += num(l.planned); });
    var note = undated ? '<p class="hint">' + money(undated) + ' of undated budget lines spread evenly across the days.</p>' : '';
    $('chart2').innerHTML = s + '</svg>' + note + tableView(days, 'Day', function (d) { return fmt(d.d); });
  }

  /* Chart 3 — cumulative planned spend. */
  function renderChart3(days) {
    if (days.length < 2) { $('chart3').innerHTML = '<p class="empty">Set the trip dates to see this.</p>'; return; }
    var run = 0, cum = days.map(function (d) { run += d.v; return { d: d.d, v: run }; });
    var W = 560, H = 200, left = 46, bottom = 30, top = 12;
    var plotW = W - left - 12, plotH = H - top - bottom;
    var max = niceMax(run);
    var x = function (i) { return left + (cum.length === 1 ? 0 : i * plotW / (cum.length - 1)); };
    var y = function (v) { return top + plotH - (v / max) * plotH; };

    var s = svgOpen(W, H);
    for (var t = 0; t <= 4; t++) {
      var gv = max * t / 4, gy = y(gv);
      s += '<line class="gridline" x1="' + left + '" y1="' + gy + '" x2="' + (W - 12) + '" y2="' + gy + '"></line>';
      s += '<text class="tick" x="' + (left - 8) + '" y="' + (gy + 3) + '" text-anchor="end">' +
        (gv >= 1000 ? Math.round(gv / 1000) + 'k' : Math.round(gv)) + '</text>';
    }
    var dpath = cum.map(function (p, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(p.v); }).join(' ');
    var area = dpath + 'L' + x(cum.length - 1) + ' ' + (top + plotH) + 'L' + left + ' ' + (top + plotH) + 'Z';
    s += '<path d="' + area + '" fill="var(--series-1)" opacity=".10"></path>';
    s += '<path d="' + dpath + '" fill="none" stroke="var(--series-1)" stroke-width="2" ' +
      'stroke-linejoin="round" stroke-linecap="round"></path>';
    // endpoint marker + direct label (the one value worth labelling)
    var lastX = x(cum.length - 1), lastY = y(run);
    s += '<circle cx="' + lastX + '" cy="' + lastY + '" r="4" fill="var(--series-1)" stroke="var(--card)" stroke-width="2"></circle>';
    s += '<text class="vlab" x="' + (lastX - 4) + '" y="' + (lastY - 9) + '" text-anchor="end">' + money(run) + '</text>';
    cum.forEach(function (p, i) {
      var hw = plotW / cum.length;
      s += '<rect class="hit" x="' + (x(i) - hw / 2) + '" y="' + top + '" width="' + Math.max(hw, 10) +
        '" height="' + plotH + '" data-tip="' + esc(fmt(p.d) + ' · ' + money(p.v) + ' spent so far') + '"></rect>';
    });
    s += '<line class="axisline" x1="' + left + '" y1="' + (top + plotH) + '" x2="' + (W - 12) + '" y2="' + (top + plotH) + '"></line>';
    s += '<text class="tick" x="' + left + '" y="' + (H - 12) + '">' + fmt(cum[0].d) + '</text>';
    s += '<text class="tick" x="' + (W - 12) + '" y="' + (H - 12) + '" text-anchor="end">' + fmt(cum[cum.length - 1].d) + '</text>';
    $('chart3').innerHTML = s + '</svg>' + tableView(cum, 'Day', function (d) { return fmt(d.d); });
  }

  // Every chart carries a table twin, so no value is reachable only by hovering.
  function tableView(rows, label, fmtRow) {
    var body = rows.map(function (r) {
      return '<tr><td>' + esc(fmtRow(r)) + '</td><td class="r">' + money(r.v) + '</td></tr>';
    }).join('');
    return '<details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Table view</summary>' +
      '<table style="margin-top:8px"><thead><tr><th>' + label + '</th><th class="r">Amount</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></details>';
  }

  /* ---------------- tooltips ---------------- */
  (function wireTips() {
    var tip = $('tip');
    document.addEventListener('mousemove', function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains('hit')) {
        tip.textContent = t.getAttribute('data-tip') || '';
        tip.classList.add('on');
        var pad = 14;
        var x = e.clientX + pad, y = e.clientY - 30;
        if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - pad;
        if (y < 4) y = e.clientY + 20;
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      } else tip.classList.remove('on');
    }, { passive: true });
    document.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
  })();

  /* ---------------- the render pass ---------------- */
  function refresh() {
    if (!T) return;
    var M = model(), SC = schedule(M), B = budgetTotals(M);
    renderStats(M, B);
    renderSteps(M);
    renderDerived(M);
    renderChecks(M);
    renderDays(M, SC);
    renderCal(M, SC);
    renderBudget(M, B);
    var days = dailySpend(M, SC);
    renderChart1(M, B);
    renderChart2(days);
    renderChart3(days);
    renderMap(M);
    $('retblock').style.display = T.type === 'return' ? '' : 'none';
    segState('ttype', T.type);
    var pk = 'none';
    Object.keys(PRESETS).forEach(function (k) {
      if (PRESETS[k].a === T.ferry.portA && PRESETS[k].b === T.ferry.portB) pk = k;
    });
    segState('presets', pk, 'p');
  }
  function segState(id, val, attr) {
    var a = attr || 't';
    [].slice.call($(id).children).forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-' + a) === val);
    });
  }

  /* ---------------- form binding ---------------- */
  var FIELDS = [
    ['home', 'home', 'text'], ['dest', 'dest', 'text'],
    ['tstart', 'start', 'text'], ['tend', 'end', 'text'],
    ['destn', 'destNights', 'num'], ['destrate', 'destRate', 'num'], ['maxh', 'maxDriveH', 'num'],
    ['travellers', 'travellers', 'num'], ['currency', 'currency', 'text'],
    ['l100', 'l100', 'num'], ['fuelprice', 'fuelPrice', 'num'],
    ['portA', 'ferry.portA', 'text'], ['portB', 'ferry.portB', 'text'],
    ['seah', 'ferry.seaH', 'num'], ['seahB', 'ferry.seaHB', 'num'], ['ci', 'ferry.ciH', 'num'],
    ['outdate', 'ferry.outDate', 'text'], ['outtime', 'ferry.outTime', 'text'],
    ['retdate', 'ferry.retDate', 'text'], ['rettime', 'ferry.retTime', 'text'],
    ['ferrycost', 'ferry.cost', 'num'],
    ['conting', 'budget.conting', 'num']
  ];
  function getPath(o, p) {
    var a = p.split('.'), t = o;
    for (var i = 0; i < a.length; i++) { if (t == null) return undefined; t = t[a[i]]; }
    return t;
  }
  function setPath(o, p, v) {
    var a = p.split('.'), t = o;
    for (var i = 0; i < a.length - 1; i++) t = t[a[i]];
    t[a[a.length - 1]] = v;
  }
  function fillForm() {
    FIELDS.forEach(function (f) {
      var v = getPath(T, f[1]);
      $(f[0]).value = v == null ? '' : v;
    });
    $('tripname').value = T.name || '';
    var opts = DB.trips.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (t.id === T.id ? ' selected' : '') + '>' + esc(t.name || 'Untitled') + '</option>';
    }).join('');
    $('tripsel').innerHTML = opts;
  }

  FIELDS.forEach(function (f) {
    var el = $(f[0]), t = null;
    function commit() {
      var v = el.value;
      setPath(T, f[1], f[2] === 'num' ? (v === '' ? 0 : Number(v)) : v);
      saveDB(); refresh();
    }
    el.addEventListener('input', function () { clearTimeout(t); t = setTimeout(commit, 400); });
    el.addEventListener('change', function () { clearTimeout(t); commit(); });
  });

  $('tripname').addEventListener('input', function () {
    T.name = this.value; saveDB();
    var o = $('tripsel').querySelector('option[value="' + T.id + '"]');
    if (o) o.textContent = T.name || 'Untitled';
  });

  /* ---------------- events: stops ---------------- */
  function findStop(id) { return T.stops.filter(function (s) { return s.id === id; })[0]; }

  $('steps').addEventListener('input', function (e) {
    var row = e.target.closest('.node');
    if (!row || !row.getAttribute('data-id')) return;
    var s = findStop(row.getAttribute('data-id')), f = e.target.getAttribute('data-f');
    if (!s || !f) return;
    if (f === 'rate') s.rate = e.target.value === '' ? null : Number(e.target.value) || 0;
    else if (f === 'nights') s.nights = Number(e.target.value) || 0;
    else s[f] = e.target.value;
    saveDB();
    clearTimeout(window.__st);
    window.__st = setTimeout(refresh, 420);
  });
  $('steps').addEventListener('change', function (e) {
    var i = e.target.closest('input[data-a]');
    if (i) { var km = Number(i.value) || 0; if (km > 0) manual(i.getAttribute('data-a'), i.getAttribute('data-b'), km); }
  });
  $('steps').addEventListener('click', function (e) {
    var row = e.target.closest('.node');
    if (!row) return;
    var id = row.getAttribute('data-id');
    if (!id) return;
    if (e.target.closest('[data-del]')) {
      T.stops = T.stops.filter(function (x) { return x.id !== id; });
      saveDB(); refresh(); return;
    }
    var mv = e.target.closest('[data-mv]');
    if (mv) {
      var dir = mv.getAttribute('data-mv') === 'up' ? -1 : 1;
      var s = findStop(id);
      var side = T.stops.filter(function (x) { return x.side === s.side; });
      var pos = side.indexOf(s), swap = side[pos + dir];
      if (!swap) return;
      var i1 = T.stops.indexOf(s), i2 = T.stops.indexOf(swap);
      T.stops[i1] = swap; T.stops[i2] = s;
      saveDB(); refresh();
    }
  });
  $('addOut').addEventListener('click', function () {
    T.stops.push({ id: uid(), name: '', side: 'out', nights: 1, rate: null, notes: '' });
    saveDB(); refresh();
  });
  $('addBack').addEventListener('click', function () {
    T.stops.push({ id: uid(), name: '', side: 'back', nights: 1, rate: null, notes: '' });
    saveDB(); refresh();
  });

  /* ---------------- events: itinerary ---------------- */
  $('days').addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) {
      T.items.push({ id: uid(), date: add.getAttribute('data-add'), time: '', title: '', cat: 'activities', cost: null });
      saveDB(); refresh(); return;
    }
    var del = e.target.closest('[data-delitem]');
    if (del) {
      var id = del.getAttribute('data-delitem');
      T.items = T.items.filter(function (x) { return x.id !== id; });
      saveDB(); refresh();
    }
  });
  function itemEdit(e) {
    var row = e.target.closest('[data-item]');
    if (!row) return;
    var id = row.getAttribute('data-item'), f = e.target.getAttribute('data-f');
    var it = T.items.filter(function (x) { return x.id === id; })[0];
    if (!it || !f) return;
    it[f] = (f === 'cost') ? (e.target.value === '' ? null : Number(e.target.value) || 0) : e.target.value;
    saveDB();
    clearTimeout(window.__it);
    window.__it = setTimeout(refresh, 450);
  }
  $('days').addEventListener('input', itemEdit);
  $('days').addEventListener('change', itemEdit);

  /* ---------------- events: budget ---------------- */
  function budgetEdit(e) {
    var t = e.target;
    if (t.hasAttribute('data-actual')) {
      var c = t.getAttribute('data-actual');
      if (t.value === '') delete T.budget.actual[c];
      else T.budget.actual[c] = Number(t.value) || 0;
    } else if (t.hasAttribute('data-line')) {
      var l = T.budget.lines.filter(function (x) { return x.id === t.getAttribute('data-line'); })[0];
      if (!l) return;
      var f = t.getAttribute('data-f');
      l[f] = t.value === '' ? (f === 'actual' ? null : 0) : Number(t.value) || 0;
    } else if (t.hasAttribute('data-label')) {
      var l2 = T.budget.lines.filter(function (x) { return x.id === t.getAttribute('data-label'); })[0];
      if (l2) l2.label = t.value;
    } else if (t.hasAttribute('data-cat')) {
      var l3 = T.budget.lines.filter(function (x) { return x.id === t.getAttribute('data-cat'); })[0];
      if (l3) l3.cat = t.value;
    } else return;
    saveDB();
    clearTimeout(window.__bt);
    window.__bt = setTimeout(refresh, 500);
  }
  $('budgetbody').addEventListener('input', budgetEdit);
  $('budgetbody').addEventListener('change', budgetEdit);
  $('budgetbody').addEventListener('click', function (e) {
    var d = e.target.closest('[data-delline]');
    if (!d) return;
    var id = d.getAttribute('data-delline');
    T.budget.lines = T.budget.lines.filter(function (x) { return x.id !== id; });
    saveDB(); refresh();
  });
  $('addline').addEventListener('click', function () {
    var label = prompt('What is the line called?', 'New line');
    if (label == null) return;
    T.budget.lines.push({ id: uid(), cat: 'misc', label: label || 'New line', planned: 0, actual: null });
    saveDB(); refresh();
  });

  /* ---------------- events: segments + tabs ---------------- */
  $('ttype').addEventListener('click', function (e) {
    var b = e.target.closest('[data-t]');
    if (!b) return;
    T.type = b.getAttribute('data-t');
    saveDB(); refresh();
  });
  $('presets').addEventListener('click', function (e) {
    var b = e.target.closest('[data-p]');
    if (!b) return;
    var p = PRESETS[b.getAttribute('data-p')];
    T.ferry.portA = p.a; T.ferry.portB = p.b;
    T.ferry.seaH = p.sea; T.ferry.seaHB = p.sea; T.ferry.outTime = p.t;
    saveDB(); fillForm(); refresh();
  });
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    var tab = b.getAttribute('data-tab');
    [].slice.call(this.children).forEach(function (x) { x.classList.toggle('on', x === b); });
    ['route', 'itin', 'budget', 'data'].forEach(function (p) {
      $('pane-' + p).classList.toggle('on', p === tab);
    });
    if (tab === 'route' && MAP) setTimeout(function () { try { MAP.invalidateSize(); } catch (e) { } }, 60);
  });
  $('itview').addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]');
    if (!b) return;
    var v = b.getAttribute('data-v');
    segState('itview', v, 'v');
    $('days').style.display = v === 'days' ? '' : 'none';
    $('cal').style.display = v === 'cal' ? '' : 'none';
  });

  /* ---------------- trips ---------------- */
  $('tripsel').addEventListener('change', function () { activate(this.value); });
  $('newtrip').addEventListener('click', function () {
    var t = defTrip('New trip');
    t.stops = []; t.items = [];
    DB.trips.push(t); activate(t.id);
  });
  $('duptrip').addEventListener('click', function () {
    var c = JSON.parse(JSON.stringify(T));
    c.id = uid();
    c.name = (T.name || 'Trip') + ' (copy)';
    c.stops.forEach(function (s) { s.id = uid(); });
    c.items.forEach(function (i) { i.id = uid(); });
    c.budget.lines.forEach(function (l) { l.id = uid(); });
    DB.trips.push(c); activate(c.id);
  });
  $('deltrip').addEventListener('click', function () {
    if (DB.trips.length === 1) { alert('This is the only trip. Use "Reset this trip" instead.'); return; }
    if (!confirm('Delete "' + (T.name || 'this trip') + '"? This cannot be undone.')) return;
    DB.trips = DB.trips.filter(function (t) { return t.id !== T.id; });
    activate(DB.trips[0].id);
  });
  $('resettrip').addEventListener('click', function () {
    if (!confirm('Reset this trip back to the defaults? This cannot be undone.')) return;
    var d = defTrip(T.name);
    d.id = T.id;
    DB.trips[DB.trips.indexOf(T)] = d;
    activate(d.id);
  });
  $('wipeall').addEventListener('click', function () {
    if (!confirm('Delete every trip stored in this browser? This cannot be undone.')) return;
    try { localStorage.removeItem(KEY); } catch (e) { }
    loadDB(); activate(DB.active);
  });

  /* ---------------- export / import / share ---------------- */
  function download(name, mime, text) {
    var b = new Blob([text], { type: mime }), u = URL.createObjectURL(b);
    var a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
  }
  function slug(s) { return String(s || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip'; }

  $('exportjson').addEventListener('click', function () {
    download(slug(T.name) + '.json', 'application/json', JSON.stringify(T, null, 2));
    note('Exported ' + slug(T.name) + '.json');
  });
  $('exportcsv').addEventListener('click', function () {
    var M = model(), B = budgetTotals(M);
    var rows = [['Line', 'Category', 'Planned', 'Actual', 'Difference']];
    B.rows.forEach(function (r) {
      rows.push([r.label, catName(r.cat), r.planned.toFixed(2),
                 r.actual == null ? '' : r.actual.toFixed(2),
                 r.actual == null ? '' : (r.planned - r.actual).toFixed(2)]);
    });
    rows.push(['Contingency ' + num(T.budget.conting) + '%', '', B.conting.toFixed(2), '', '']);
    rows.push(['Total', '', B.withCont.toFixed(2), B.anyActual ? B.actual.toFixed(2) : '',
               B.anyActual ? (B.planned - B.actual).toFixed(2) : '']);
    var csv = rows.map(function (r) {
      return r.map(function (c) { return /[",\n]/.test(c) ? '"' + String(c).replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\n');
    download(slug(T.name) + '-budget.csv', 'text/csv', csv);
    note('Exported the budget as CSV.');
  });
  $('importbtn').addEventListener('click', function () { $('importfile').click(); });
  $('importfile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var t = migrate(JSON.parse(r.result));
        t.id = uid();
        t.name = (t.name || 'Imported trip');
        DB.trips.push(t); activate(t.id);
        note('Imported "' + t.name + '".');
      } catch (e) { note('That file did not read as a trip export.'); }
    };
    r.readAsText(f);
    this.value = '';
  });

  function b64e(str) {
    var b = new TextEncoder().encode(str), s = '';
    b.forEach(function (c) { s += String.fromCharCode(c); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64d(a) {
    a = a.replace(/-/g, '+').replace(/_/g, '/');
    var s = atob(a), b = Uint8Array.from(s, function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(b);
  }
  $('sharebtn').addEventListener('click', function () {
    var url = location.origin + location.pathname + '#t=' + b64e(JSON.stringify(T));
    if (url.length > 8000) { note('This trip is too big for a link — export the .json instead.'); return; }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); note('Link copied.'); }
      catch (e) { note('Copy failed — the link is in the address bar.'); location.hash = 't=' + b64e(JSON.stringify(T)); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { note('Link copied — anyone opening it gets a copy of this trip.'); }, fallback);
    } else fallback();
  });
  $('printbtn').addEventListener('click', function () { window.print(); });
  function note(s) { $('datanote').textContent = s; }

  /* ---------------- boot ---------------- */
  loadDB();

  // A shared link carries a whole trip in the hash — take it, then clean the URL.
  function takeSharedTrip() {
    if (location.hash.indexOf('#t=') !== 0) return false;
    try {
      var shared = migrate(JSON.parse(b64d(location.hash.slice(3))));
      shared.id = uid();
      shared.name = (shared.name || 'Trip') + ' (shared)';
      shared.stops.forEach(function (s) { s.id = uid(); });
      shared.items.forEach(function (i) { i.id = uid(); });
      shared.budget.lines.forEach(function (l) { l.id = uid(); });
      DB.trips.push(shared);
      DB.active = shared.id;
      history.replaceState(null, '', location.pathname);
      return true;
    } catch (e) { return false; }   // not a valid share link — leave it alone
  }
  takeSharedTrip();

  // Pasting a share link into an already-open tab only changes the hash, which
  // would otherwise do nothing at all.
  window.addEventListener('hashchange', function () {
    if (takeSharedTrip()) { activate(DB.active); note('Loaded the shared trip.'); }
  });

  T = DB.trips.filter(function (t) { return t.id === DB.active; })[0] || DB.trips[0];
  fillForm();
  segState('itview', 'days', 'v');
  $('cal').style.display = 'none';
  setNet(null);
  mark(false);
  refresh();
  saveDB();
})();
