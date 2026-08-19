/* rng.js — seeded deterministic randomness so a run can be replayed/saved. */
(function (G) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function RNG(seed) {
    this.state = (seed >>> 0) || 123456789;
    this._f = mulberry32(this.state);
  }

  RNG.prototype.next = function () { return this._f(); };

  RNG.prototype.range = function (lo, hi) { return lo + this.next() * (hi - lo); };

  RNG.prototype.int = function (lo, hi) { return Math.floor(this.range(lo, hi + 1)); };

  RNG.prototype.chance = function (p) { return this.next() < p; };

  RNG.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };

  /* Weighted pick. items: [{w: number, ...}] or (items, weightFn) */
  RNG.prototype.weighted = function (items, weightFn) {
    var fn = weightFn || function (o) { return o.w; };
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += Math.max(0, fn(items[i]));
    if (total <= 0) return items[0];
    var r = this.next() * total;
    for (i = 0; i < items.length; i++) {
      r -= Math.max(0, fn(items[i]));
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  /* Box-Muller normal */
  RNG.prototype.normal = function (mean, sd) {
    var u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /* Poisson draw — Knuth for small lambda, normal approximation for large. */
  RNG.prototype.poisson = function (lambda) {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      var L = Math.exp(-lambda), k = 0, p = 1;
      do { k++; p *= this.next(); } while (p > L);
      return k - 1;
    }
    return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
  };

  G.RNG = RNG;
})(typeof window !== 'undefined' ? window : globalThis);
