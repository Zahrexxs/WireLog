/**
 * Daily Task Logger — Hostname Autocomplete & Fuzzy Matching
 * Matches user input against cached device inventory and past entries.
 * e.g., typing "branch" matches "SW1_BRANCH_A"
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Autocomplete = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  /**
   * Simple score-based fuzzy match
   * @param {string} query 
   * @param {string} target 
   * @returns {number|null} Score (higher is better) or null if no match
   */
  function scoreMatch(query, target) {
    var q = query.trim().toLowerCase();
    var t = target.trim().toLowerCase();

    if (!q) return 1;
    if (t === q) return 1000;

    // Exact prefix match
    if (t.indexOf(q) === 0) return 500 - (t.length - q.length);

    // Exact substring match
    var subIdx = t.indexOf(q);
    if (subIdx > -1) return 300 - subIdx;

    // Word token match
    var words = t.split(/[\s_\-\.]+/);
    for (var w = 0; w < words.length; w++) {
      if (words[w].indexOf(q) === 0) return 250;
    }

    // Fuzzy subsequence match
    var qIdx = 0;
    var consecutive = 0;
    var score = 0;

    for (var i = 0; i < t.length && qIdx < q.length; i++) {
      if (t[i] === q[qIdx]) {
        score += 10 + (consecutive * 5);
        consecutive++;
        qIdx++;
      } else {
        consecutive = 0;
      }
    }

    if (qIdx === q.length) {
      return score - (t.length - q.length);
    }

    return null;
  }

  /**
   * Filter and sort device suggestions
   * @param {string} query
   * @param {Array<string>} deviceList
   * @param {number} maxResults
   * @returns {Array<{ hostname: string, score: number, isExact: boolean }>}
   */
  function search(query, list, maxResults) {
    maxResults = maxResults || 8;
    if (!list || list.length === 0) return [];
    var q = (query || '').trim();
    if (!q) return list.slice(0, maxResults).map(function(d) {
      return { value: d, text: d, hostname: d, score: 0, isExact: false };
    });

    var results = [];
    var qUpper = q.toUpperCase();

    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      var score = scoreMatch(q, d);
      if (score !== null) {
        results.push({
          value: d,
          text: d,
          hostname: d,
          score: score,
          isExact: d.toUpperCase() === qUpper
        });
      }
    }

    // Sort descending by score
    results.sort(function(a, b) {
      return b.score - a.score;
    });

    return results.slice(0, maxResults);
  }

  return {
    scoreMatch: scoreMatch,
    search: search
  };
}));
