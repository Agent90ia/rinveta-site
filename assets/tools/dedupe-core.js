/* Rinveta free tool core: CSV parsing and duplicate removal. Runs in the browser only. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RinvetaDedupe = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function decodeBytes(buf) {
    var u8 = new Uint8Array(buf), enc = "utf-8", text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(u8); }
    catch (e) { enc = "windows-1252"; text = new TextDecoder("windows-1252").decode(u8); }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return { text: text, encoding: enc };
  }

  function detectDelimiter(text) {
    var sample = text.slice(0, 20000), best = ",", bestScore = -1;
    [",", ";", "\t", "|"].forEach(function (d) {
      var inq = false, counts = [], c = 0, lines = 0;
      for (var i = 0; i < sample.length && lines < 20; i++) {
        var ch = sample[i];
        if (ch === '"') inq = !inq;
        else if (!inq && ch === d) c++;
        else if (!inq && ch === "\n") { counts.push(c); c = 0; lines++; }
      }
      if (!counts.length) counts.push(c);
      var first = counts[0], consistent = counts.filter(function (x) { return x === first; }).length;
      var score = first > 0 ? consistent * 1000 + first : 0;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function parseCSV(text, delim) {
    var rows = [], row = [], field = "", inq = false, i = 0, n = text.length;
    while (i < n) {
      var ch = text[i];
      if (inq) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inq = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === "") { inq = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ""; i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
    return rows;
  }

  function toCSV(rows, delim) {
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = v === null || v === undefined ? "" : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
        return (s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0 || s.indexOf("\r") >= 0)
          ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(delim);
    }).join("\r\n") + "\r\n";
  }

  function norm(v, opt) {
    var s = v === null || v === undefined ? "" : (v instanceof Date ? v.toISOString() : String(v));
    if (opt.trim) s = s.replace(/\s+/g, " ").trim();
    if (opt.ignoreCase) s = s.toLowerCase();
    return s;
  }

  /* rows: array of arrays. opt: {hasHeader, keyCols:[indexes]|null(all), ignoreCase, trim, keep:"first"|"last", skipEmpty} */
  function dedupe(rows, opt) {
    var start = opt.hasHeader ? 1 : 0, header = opt.hasHeader ? [rows[0] || []] : [];
    var data = rows.slice(start), width = 0;
    rows.forEach(function (r) { if (r.length > width) width = r.length; });
    var cols = opt.keyCols && opt.keyCols.length ? opt.keyCols : Array.from({ length: width }, function (_, i) { return i; });
    var seen = Object.create(null), keepIdx = [], removed = [], blank = 0;
    var order = opt.keep === "last" ? data.map(function (_, i) { return data.length - 1 - i; }) : data.map(function (_, i) { return i; });
    var drop = new Array(data.length).fill(false);
    order.forEach(function (i) {
      var r = data[i];
      var key = cols.map(function (c) { return norm(r[c], opt); }).join("\u0001");
      if (opt.skipEmpty && cols.every(function (c) { return norm(r[c], opt) === ""; })) { drop[i] = true; blank++; return; }
      if (seen[key]) drop[i] = true; else seen[key] = true;
    });
    var kept = [], rem = [];
    data.forEach(function (r, i) { (drop[i] ? rem : kept).push(r); });
    return { header: header, kept: kept, removed: rem, before: data.length, after: kept.length, removedCount: rem.length, blank: blank };
  }

  return { decodeBytes: decodeBytes, detectDelimiter: detectDelimiter, parseCSV: parseCSV, toCSV: toCSV, dedupe: dedupe };
});
