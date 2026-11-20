/* Rinveta free tool: merge CSV/Excel files with the same columns. Everything runs in this browser tab; files are never uploaded. */
(function () {
  "use strict";
  var D = window.RinvetaDedupe, M = window.RinvetaMerge, $ = function (id) { return document.getElementById(id); };
  var st = { files: [], res: null };

  function track(ev) { // aggregate usage counter only: never any file content or file name
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "/tool/merge/" + ev, title: "tool-merge-" + ev, event: true }); } catch (e) {}
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cell(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : (v === null || v === undefined ? "" : String(v)); }
  function msg(t, bad) { var m = $("tl-msg"); m.textContent = t; m.className = bad ? "note tl-bad" : "note"; }

  function readFile(f, done) {
    var ext = (f.name.split(".").pop() || "").toLowerCase(), rd = new FileReader();
    rd.onerror = function () { done(null, f.name); };
    rd.onload = function () {
      try {
        var rows, info;
        if (ext === "xlsx" || ext === "xls") {
          var wb = XLSX.read(rd.result, { type: "array", cellDates: true }), sn = wb.SheetNames[0];
          rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "", blankrows: false });
          info = { kind: "xlsx", delim: ",", note: "Excel, first sheet “" + sn + "”" };
        } else {
          var dec = D.decodeBytes(rd.result), delim = D.detectDelimiter(dec.text);
          rows = D.parseCSV(dec.text, delim);
          info = { kind: "csv", delim: delim, note: ({ ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" }[delim]) + "-separated CSV, " + dec.encoding };
        }
        done(rows.length ? { name: f.name, rows: rows, kind: info.kind, delim: info.delim, note: info.note } : null, f.name);
      } catch (e) { done(null, f.name); }
    };
    rd.readAsArrayBuffer(f);
  }

  function list() {
    $("tl-opts").hidden = !st.files.length; $("tl-out").hidden = true;
    $("tl-files").innerHTML = st.files.map(function (f, i) {
      return "<li>" + esc(f.name) + " — " + (f.rows.length - ($("tl-header").checked ? 1 : 0)) + " data rows, " + esc(f.note) +
        ' <button type="button" class="btn" data-rm="' + i + '" style="padding:2px 10px;min-height:0">Remove</button></li>';
    }).join("");
    msg(st.files.length ? st.files.length + " file(s) loaded. Add more, or press Merge." : "No file chosen yet. Nothing is uploaded.");
  }

  function handle(fl) {
    var arr = Array.prototype.slice.call(fl || []), pending = arr.length, bad = [];
    if (!pending) return;
    arr.forEach(function (f) {
      readFile(f, function (r, name) {
        if (r) { st.files.push(r); track("file-" + r.kind); } else bad.push(name);
        if (--pending === 0) { list(); if (bad.length) msg("Could not read: " + bad.join(", ") + ". Are they valid CSV or Excel files?", true); }
      });
    });
  }

  function table(header, rows, max) {
    var h = "<thead><tr>" + header.map(function (c) { return "<th>" + esc(cell(c)) + "</th>"; }).join("") + "</tr></thead>";
    var b = rows.slice(0, max).map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + esc(cell(c)) + "</td>"; }).join("") + "</tr>"; }).join("");
    return '<div class="tl-scroll"><table class="tl-table">' + h + "<tbody>" + b + "</tbody></table></div>" +
      (rows.length > max ? '<p class="note">Showing the first ' + max + " of " + rows.length + " rows.</p>" : "");
  }

  function run() {
    if (!st.files.length) { msg("Choose at least one file first.", true); return; }
    var r = M.merge(st.files, { hasHeader: $("tl-header").checked, addSource: $("tl-source").checked });
    st.res = r; $("tl-out").hidden = false;
    $("tl-sum").innerHTML = "<li><strong>" + st.files.length + "</strong> files</li><li><strong>" + r.total + "</strong> rows in the result</li><li><strong>" + r.columns + "</strong> columns</li>" +
      r.perFile.map(function (p) { return "<li>" + esc(p.name) + ": <strong>" + p.rows + "</strong> rows</li>"; }).join("");
    $("tl-warn").innerHTML = r.mismatch.length && $("tl-header").checked
      ? '<p class="note tl-bad">These columns are not present in every file (left empty where missing): ' + r.mismatch.map(esc).join(", ") + ".</p>" : "";
    $("tl-prev").innerHTML = "<h3>Result (preview)</h3>" + table(r.header, r.rows, 10);
    $("tl-out").scrollIntoView({ behavior: "smooth", block: "nearest" }); track("run");
  }

  function save(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  function dl(kind) {
    var r = st.res; if (!r) return; var all = [r.header].concat(r.rows);
    if (kind === "csv") {
      var delim = st.files[0].kind === "csv" ? st.files[0].delim : ",";
      save(new Blob(["" + D.toCSV(all, delim)], { type: "text/csv;charset=utf-8" }), "merged.csv"); track("download-csv");
    } else {
      var ws = XLSX.utils.aoa_to_sheet(all, { cellDates: true }), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Merged");
      save(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array", cellDates: true })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "merged.xlsx"); track("download-xlsx");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var inp = $("tl-file"), drop = $("tl-drop");
    inp.addEventListener("change", function () { handle(inp.files); inp.value = ""; });
    ["dragover", "dragenter"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (ev) { handle(ev.dataTransfer.files); });
    $("tl-files").addEventListener("click", function (ev) { var i = ev.target.getAttribute && ev.target.getAttribute("data-rm"); if (i !== null && i !== undefined) { st.files.splice(+i, 1); list(); } });
    $("tl-header").addEventListener("change", list);
    $("tl-run").addEventListener("click", run);
    $("tl-dl-xlsx").addEventListener("click", function () { dl("xlsx"); });
    $("tl-dl-csv").addEventListener("click", function () { dl("csv"); });
  });
})();
