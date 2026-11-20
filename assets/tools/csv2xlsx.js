/* Rinveta free tool: CSV to Excel. Everything runs in this browser tab; files are never uploaded. */
(function () {
  "use strict";
  var D = window.RinvetaDedupe, C = window.RinvetaCsv2Xlsx, $ = function (id) { return document.getElementById(id); };
  var st = { rows: null, name: "", delim: ",", enc: "utf-8" };

  function track(ev) { // aggregate usage counter only: never any file content or file name
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "/tool/csv-to-excel/" + ev, title: "tool-csv2xlsx-" + ev, event: true }); } catch (e) {}
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function msg(t, bad) { var m = $("tl-msg"); m.textContent = t; m.className = bad ? "note tl-bad" : "note"; }
  var NAMES = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };

  function preview() {
    if (!st.rows) return;
    var res = C.convert(st.rows, { hasHeader: $("tl-header").checked, numbers: $("tl-num").checked });
    st.res = res;
    var body = res.rows.slice(0, 11).map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("");
    $("tl-prev").innerHTML = '<div class="tl-scroll"><table class="tl-table"><tbody>' + body + "</tbody></table></div>" +
      (st.rows.length > 11 ? '<p class="note">Showing the first 11 of ' + st.rows.length + " rows.</p>" : "");
    $("tl-sum").innerHTML = "<li><strong>" + st.rows.length + "</strong> rows</li><li><strong>" + st.width + "</strong> columns</li><li>" + NAMES[st.delim] + "-separated, " + esc(st.enc) + "</li>" +
      "<li><strong>" + res.converted + "</strong> values turned into Excel numbers</li>";
  }

  function handleFile(f) {
    if (!f) return;
    st.name = f.name.replace(/\.[^.]+$/, "");
    var rd = new FileReader();
    rd.onerror = function () { msg("Could not read this file.", true); };
    rd.onload = function () {
      try {
        var dec = D.decodeBytes(rd.result); st.delim = D.detectDelimiter(dec.text); st.enc = dec.encoding;
        var rows = D.parseCSV(dec.text, st.delim);
        if (!rows.length) { msg("This file looks empty.", true); return; }
        st.rows = rows; st.width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
        $("tl-out").hidden = false; msg("Loaded: " + rows.length + " rows, " + st.width + " columns."); preview(); track("file");
      } catch (e) { msg("This file could not be read. Is it a valid CSV file?", true); }
    };
    rd.readAsArrayBuffer(f);
  }

  function save(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  function download() {
    if (!st.res) return;
    var ws = XLSX.utils.aoa_to_sheet(st.res.rows), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, C.sheetName(st.name));
    save(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), st.name + ".xlsx"); track("download");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var inp = $("tl-file"), drop = $("tl-drop");
    inp.addEventListener("change", function () { handleFile(inp.files[0]); });
    ["dragover", "dragenter"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (ev) { handleFile(ev.dataTransfer.files[0]); });
    $("tl-header").addEventListener("change", preview); $("tl-num").addEventListener("change", preview);
    $("tl-dl").addEventListener("click", download);
  });
})();
