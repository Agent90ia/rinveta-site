/* Rinveta free tool core: CSV to Excel without altering values. Runs in the browser only. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RinvetaCsv2Xlsx = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* A value becomes an Excel number only if it is a plain number: optional minus, no leading zero (except 0 itself),
     optional dot decimals, at most 15 digits, and it must read back identically (1.50 stays text, so nothing is silently reformatted). Anything else (codes like 007, phone numbers, dates, 1,5, 1e5) stays text. */
  var PLAIN = /^-?(0|[1-9]\d*)(\.\d+)?$/;
  function isPlainNumber(s) { return PLAIN.test(s) && s.replace(/[^0-9]/g, "").length <= 15 && String(Number(s)) === s; }

  function sheetName(name) {
    var n = String(name || "").replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
    return n || "Sheet1";
  }

  /* rows: array of arrays of strings. Returns the same rows with plain numbers converted when asked; the rest stays text. */
  function convert(rows, opt) {
    var start = opt.hasHeader ? 1 : 0, converted = 0;
    var out = rows.map(function (r, ri) {
      return r.map(function (v) {
        if (ri >= start && opt.numbers && typeof v === "string" && isPlainNumber(v)) { converted++; return Number(v); }
        return v;
      });
    });
    return { rows: out, converted: converted };
  }

  return { isPlainNumber: isPlainNumber, sheetName: sheetName, convert: convert };
});
