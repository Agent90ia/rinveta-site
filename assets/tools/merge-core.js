/* Rinveta free tool core: merge several tables with the same columns. Runs in the browser only. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RinvetaMerge = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function key(v) { return String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim().toLowerCase(); }
  function label(v) { return v === null || v === undefined ? "" : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)); }

  /* files: [{name, rows}] (rows = array of arrays).
     opt: {hasHeader, addSource}. With a header, columns are matched by header name (ignoring capitals and extra spaces);
     without, by position. Columns missing in a file are left empty; values are never reformatted. */
  function merge(files, opt) {
    var cols = [], index = Object.create(null), perFile = [], out = [], dataRows = 0, mismatch = [];
    files.forEach(function (f) {
      var rows = f.rows || [], start = opt.hasHeader ? 1 : 0, width = 0, map = [];
      rows.forEach(function (r) { if (r.length > width) width = r.length; });
      for (var i = 0; i < width; i++) {
        var name = opt.hasHeader && rows[0] && label(rows[0][i]) !== "" ? label(rows[0][i]) : "Column " + (i + 1);
        var k = opt.hasHeader ? key(name) : "#" + i;
        if (index[k] === undefined) { index[k] = cols.length; cols.push({ name: opt.hasHeader ? name : "Column " + (i + 1), files: 0 }); }
        map.push(index[k]);
      }
      var seenHere = Object.create(null);
      map.forEach(function (c) { if (!seenHere[c]) { seenHere[c] = true; cols[c].files++; } });
      perFile.push({ name: f.name, map: map, data: rows.slice(start), count: Math.max(0, rows.length - start) });
    });
    cols.forEach(function (c) { if (c.files < files.length) mismatch.push(c.name); });
    perFile.forEach(function (pf) {
      pf.data.forEach(function (r) {
        var row = new Array(cols.length).fill("");
        pf.map.forEach(function (c, i) { if (r[i] !== undefined && r[i] !== null) row[c] = r[i]; });
        if (opt.addSource) row.push(pf.name);
        out.push(row); dataRows++;
      });
    });
    var header = cols.map(function (c) { return c.name; });
    if (opt.addSource) header.push("Source file");
    return { header: header, rows: out, total: dataRows, perFile: perFile.map(function (p) { return { name: p.name, rows: p.count }; }), mismatch: mismatch, columns: cols.length };
  }

  return { merge: merge };
});
