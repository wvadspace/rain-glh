/*
 * Deterministic pseudo-random number generation.
 * Every simulated day draws from a seeded stream so a given save file always
 * replays identically -- important for debugging balance and for the tests.
 */
var AutoShop = globalThis.AutoShop || (globalThis.AutoShop = {});

(function (NS) {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** Random stream with the distributions the simulation needs. */
  function Rng(seed) {
    this.seed = typeof seed === 'number' ? seed : hashString(String(seed));
    this.next = mulberry32(this.seed);
  }

  Rng.prototype.float = function (min, max) {
    if (min === undefined) return this.next();
    if (max === undefined) { max = min; min = 0; }
    return min + this.next() * (max - min);
  };

  Rng.prototype.int = function (min, max) {
    return Math.floor(this.float(min, max + 1));
  };

  Rng.prototype.chance = function (p) {
    return this.next() < p;
  };

  /** Box-Muller, clamped to +/- 3 sigma so a single draw can't wreck a day. */
  Rng.prototype.normal = function (mean, sd) {
    var u = 1 - this.next();
    var v = this.next();
    var z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    z = Math.max(-3, Math.min(3, z));
    return mean + z * sd;
  };

  /** Knuth for small lambda, normal approximation once that gets slow. */
  Rng.prototype.poisson = function (lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) {
      return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    }
    var L = Math.exp(-lambda);
    var k = 0;
    var p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  };

  Rng.prototype.pick = function (arr) {
    return arr[Math.floor(this.next() * arr.length)];
  };

  /** items: array, weightFn: item -> non-negative number. */
  Rng.prototype.weighted = function (items, weightFn) {
    var total = 0;
    var i;
    var weights = new Array(items.length);
    for (i = 0; i < items.length; i++) {
      var w = Math.max(0, weightFn(items[i]));
      weights[i] = w;
      total += w;
    }
    if (total <= 0) return items[0];
    var roll = this.next() * total;
    for (i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  Rng.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  };

  NS.Rng = Rng;
  NS.hashString = hashString;
})(AutoShop);
