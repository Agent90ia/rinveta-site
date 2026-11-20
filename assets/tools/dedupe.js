/* Rinveta free tool: remove duplicates from CSV/Excel. Everything runs in this browser tab; files are never uploaded. */
(function () {
  "use strict";
  var D = window.RinvetaDedupe, $ = function (id) { return document.getElementById(id); };
  var st = { rows: null, name: "", kind: "", delim: ",", wb: null, sheet: "", res: null };

  function track(ev) { // aggregate usage counter only: never any file content or file name
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "/tool/remove-duplicates/" + ev, title: "tool-dedupe-" + ev, event: true }); } catch (e) {}
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cell(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : (v === null || v === undefined ? "" : String(v)); }
  function msg(t, bad) { var m = $("tl-msg"); m.textContent = t; m.className = bad ? "note tl-bad" : "note"; }

  function table(header, rows, max) {
    var h = header.length ? "<thead><tr>" + header[0].map(function (c) { return "<th>" + esc(cell(c)) + "</th>"; }).join("") + "</tr></thead>" : "";
    var b = rows.slice(0, max).map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + esc(cell(c)) + "</td>"; }).join("") + "</tr>"; }).join("");
    return '<div class="tl-scroll"><table class="tl-table">' + h + "<tbody>" + b + "</tbody></table></div>" +
      (rows.length > max ? '<p class="note">Showing the first ' + max + " of " + rows.length + " rows.</p>" : "");
  }

  function loadRows(rows, label) {
    st.rows = rows; $("tl-opts").hidden = false; $("tl-out").hidden = true;
    var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    st.width = width; buildCols(); msg(label + ": " + rows.length + " rows, " + width + " columns.");
  }

  function buildCols() {
    var rows = st.rows, hdr = $("tl-header").checked, box = $("tl-cols"); box.innerHTML = "";
    for (var i = 0; i < st.width; i++) {
      var name = hdr && rows[0] && rows[0][i] !== undefined && cell(rows[0][i]) !== "" ? cell(rows[0][i]) : "Column " + (i + 1);
      var l = document.createElement("label"); l.className = "tl-chk";
      l.innerHTML = '<input type="checkbox" checked data-c="' + i + '"> ' + esc(name);
      box.appendChild(l);
    }
  }

  function handleFile(f) {
    if (!f) return;
    st.name = f.name.replace(/\.[^.]+$/, ""); $("tl-out").hidden = true;
    var ext = (f.name.split(".").pop() || "").toLowerCase();
    var rd = new FileReader();
    rd.onerror = function () { msg("Could not read this file.", true); };
    rd.onload = function () {
      try {
        if (ext === "xlsx" || ext === "xls") {
          st.kind = "xlsx"; st.wb = XLSX.read(rd.result, { type: "array", cellDates: true });
          var sel = $("tl-sheet"); sel.innerHTML = st.wb.SheetNames.map(function (n, i) { return '<option value="' + i + '">' + esc(n) + "</option>"; }).join("");
          $("tl-sheetrow").hidden = st.wb.SheetNames.length < 2; useSheet(0); track("file-xlsx");
        } else {
          st.kind = "csv"; $("tl-sheetrow").hidden = true;
          var dec = D.decodeBytes(rd.result); st.delim = D.detectDelimiter(dec.text);
          var rows = D.parseCSV(dec.text, st.delim);
          if (!rows.length) { msg("This file looks empty.", true); return; }
          loadRows(rows, "Loaded (" + ({ ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" }[st.delim]) + "-separated, " + dec.encoding + ")"); track("file-csv");
        }
      } catch (e) { msg("This file could not be read. Is it a valid CSV or Excel file?", true); }
    };
    rd.readAsArrayBuffer(f);
  }

  function useSheet(i) {
    st.sheet = st.wb.SheetNames[i];
    var rows = XLSX.utils.sheet_to_json(st.wb.Sheets[st.sheet], { header: 1, raw: true, defval: "", blankrows: false });
    if (!rows.length) { msg("This sheet is empty.", true); return; }
    loadRows(rows, "Sheet “" + st.sheet + "”");
  }

  function run() {
    var keys = Array.prototype.slice.call(document.querySelectorAll("#tl-cols input:checked")).map(function (x) { return +x.getAttribute("data-c"); });
    if (!keys.length) { msg("Select at least one column to compare.", true); return; }
    var r = D.dedupe(st.rows, { hasHeader: $("tl-header").checked, keyCols: keys, ignoreCase: $("tl-case").checked, trim: $("tl-trim").checked, keep: $("tl-keep").value, skipEmpty: $("tl-empty").checked });
    st.res = r; $("tl-out").hidden = false;
    $("tl-sum").innerHTML = "<li><strong>" + r.before + "</strong> rows before</li><li><strong>" + r.after + "</strong> rows after</li><li><strong>" + r.removedCount + "</strong> removed</li>";
    $("tl-prev").innerHTML = "<h3>Result (preview)</h3>" + table(r.header, r.kept, 10) +
      (r.removedCount ? "<h3>Removed rows (preview)</h3>" + table(r.header, r.removed, 10) : "<p>No duplicates found with these settings.</p>");
    $("tl-out").scrollIntoView({ behavior: "smooth", block: "nearest" }); track("run");
  }

  function save(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  function dl(kind) {
    var r = st.res; if (!r) return; var all = r.header.concat(r.kept);
    if (kind === "csv") {
      save(new Blob(["﻿" + D.toCSV(all, st.kind === "csv" ? st.delim : ",")], { type: "text/csv;charset=utf-8" }), st.name + "-no-duplicates.csv"); track("download-csv");
    } else {
      var ws = XLSX.utils.aoa_to_sheet(all, { cellDates: true }), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, (st.sheet || "Sheet1").slice(0, 31));
      var out = XLSX.write(wb, { bookType: "xlsx", type: "array", cellDates: true });
      save(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), st.name + "-no-duplicates.xlsx"); track("download-xlsx");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var inp = $("tl-file"), drop = $("tl-drop");
    inp.addEventListener("change", function () { handleFile(inp.files[0]); });
    ["dragover", "dragenter"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (ev) { handleFile(ev.dataTransfer.files[0]); });
    $("tl-header").addEventListener("change", function () { if (st.rows) buildCols(); });
    $("tl-sheet").addEventListener("change", function () { useSheet(+this.value); });
    $("tl-run").addEventListener("click", run);
    $("tl-dl-xlsx").addEventListener("click", function () { dl("xlsx"); });
    $("tl-dl-csv").addEventListener("click", function () { dl("csv"); });
    $("tl-all").addEventListener("click", function () { document.querySelectorAll("#tl-cols input").forEach(function (x) { x.checked = true; }); });
    $("tl-none").addEventListener("click", function () { document.querySelectorAll("#tl-cols input").forEach(function (x) { x.checked = false; }); });
  });
})();
