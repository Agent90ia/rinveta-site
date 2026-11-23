/* Rinveta strumento gratuito: FatturaPA (XML, P7M, ZIP) -> Excel/CSV. Tutto avviene in questa scheda del browser; i file non vengono mai caricati. */
(function () {
  "use strict";
  var F = window.RinvetaFpa, $ = function (id) { return document.getElementById(id); };
  var st = { res: null, busy: false };

  function track(ev) { // solo contatori aggregati: mai contenuto o nomi dei file
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "/tool/fattura-elettronica-xml-excel/" + ev, title: "tool-fpa-" + ev, event: true }); } catch (e) {}
  }
  var PRO_HREF = "mailto:hello@rinveta.com?subject=%5Bc%3Afpa-pro%5D%20Versione%20Pro%20E-FPA&body=Vorrei%20essere%20avvisato%20quando%20sar%C3%A0%20pronta%20la%20versione%20Pro.%0A%0AOgni%20mese%20ho%20circa%20questo%20numero%20di%20fatture%20(senza%20allegare%20fatture%20reali):%20";
  function ev(name) { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title: name, event: true }); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function msg(t, bad) { var m = $("tl-msg"); m.textContent = t; m.className = bad ? "note tl-bad" : "note"; }
  function money(v) { return typeof v === "number" ? v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : esc(v); }

  function render(res) {
    var ok = res.files.filter(function (f) { return f.ok; }), bad = res.files.filter(function (f) { return !f.ok; });
    var nInv = res.head.length - 1;
    $("tl-out").hidden = false;
    $("tl-sum").innerHTML = "<li><strong>" + nInv + "</strong> " + (nInv === 1 ? "fattura" : "fatture") + "</li><li><strong>" + (res.lines.length - 1) + "</strong> righe di dettaglio</li><li><strong>" + ok.length + "</strong> file letti</li>" +
      (bad.length ? "<li><strong>" + bad.length + "</strong> file con problemi</li>" : "");
    var issues = "";
    if (res.truncated) issues += '<p class="note tl-bad">Hai caricato ' + res.total + " file fattura: la versione gratuita ne elabora " + F.MAX_FILES + " per volta. Elaborati i primi " + F.MAX_FILES + "; gli altri " + res.truncated + " vanno ricaricati in un secondo lotto.</p>";
    if (res.truncated) { issues += '<p class="note">Ti serve convertire più di 20 fatture insieme o ogni mese? Stiamo preparando una versione Pro: <a href="' + PRO_HREF + '" data-fpa-pro>scrivici e ti avvisiamo</a>.</p>'; ev("fpa-limite"); }
    if (bad.length || res.skipped.length || res.warnings.length) {
      issues += "<p><strong>Da controllare:</strong></p><ul>" +
        bad.map(function (f) { return "<li>" + esc(f.name) + ": " + esc(f.error) + "</li>"; }).join("") +
        res.skipped.map(function (s) { return "<li>" + esc(s.name) + ": " + esc(s.reason) + " (saltato)</li>"; }).join("") +
        res.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>";
    }
    $("tl-warn").innerHTML = issues;
    var cols = [3, 4, 8, 11, 12, 13, 14, 16];
    var th = cols.map(function (i) { return "<th>" + esc(F.HEAD[i]) + "</th>"; }).join("");
    var rows = res.head.slice(1, 11).map(function (r) {
      return "<tr>" + cols.map(function (i) { var c = r[i]; return "<td>" + (c && c.d ? esc(F.itDate(c.d)) : money(c)) + "</td>"; }).join("") + "</tr>";
    }).join("");
    $("tl-prev").innerHTML = nInv ? '<div class="tl-scroll"><table class="tl-table"><thead><tr>' + th + "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      (nInv > 10 ? '<p class="note">Anteprima delle prime 10 di ' + nInv + " fatture; il file scaricato le contiene tutte.</p>" : "") : "";
    $("tl-dls").hidden = !nInv;
  }

  async function handleFiles(list) {
    if (!list || !list.length || st.busy) return;
    st.busy = true; msg("Lettura in corso, sul tuo computer…");
    try {
      var inputs = [];
      for (var i = 0; i < list.length; i++) inputs.push({ name: list[i].name, bytes: new Uint8Array(await list[i].arrayBuffer()) });
      var res = await F.convert(inputs);
      st.res = res; render(res);
      var n = res.head.length - 1;
      msg(n ? "Fatto: " + n + (n === 1 ? " fattura letta." : " fatture lette.") + " Nulla è stato caricato." : "Nessuna fattura leggibile in questi file.", !n);
      track("file");
    } catch (e) { msg("Non è stato possibile leggere questi file.", true); }
    st.busy = false;
  }

  function save(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function widths(rows) { return rows[0].map(function (h, i) { var w = String(h).length; rows.slice(1, 60).forEach(function (r) { var c = r[i]; w = Math.max(w, c && c.d ? 10 : String(c == null ? "" : c).length); }); return { wch: Math.min(Math.max(w + 2, 9), 50) }; }); }

  function dlXlsx() {
    if (!st.res) return;
    var wb = XLSX.utils.book_new();
    [["Testata", st.res.head], ["Righe", st.res.lines]].forEach(function (p) { var ws = XLSX.utils.aoa_to_sheet(F.toSheetRows(p[1])); ws["!cols"] = widths(p[1]); XLSX.utils.book_append_sheet(wb, ws, p[0]); });
    save(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "fatture-elettroniche.xlsx"); track("download-xlsx");
  }
  function dlCsv(which) {
    if (!st.res) return;
    save(new Blob(["﻿" + F.toCsv(which === "head" ? st.res.head : st.res.lines)], { type: "text/csv;charset=utf-8" }), which === "head" ? "fatture-testata.csv" : "fatture-righe.csv"); track("download-csv");
  }

  document.addEventListener("click", function (e) { var a = e.target && e.target.closest ? e.target.closest("a[data-fpa-pro]") : null; if (a) ev("fpa-pro-clic"); });

  document.addEventListener("DOMContentLoaded", function () {
    var inp = $("tl-file"), drop = $("tl-drop");
    inp.addEventListener("change", function () { handleFiles(inp.files); });
    ["dragover", "dragenter"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (ev) { handleFiles(ev.dataTransfer.files); });
    $("tl-dl").addEventListener("click", dlXlsx);
    $("tl-dl-csv-h").addEventListener("click", function () { dlCsv("head"); });
    $("tl-dl-csv-l").addEventListener("click", function () { dlCsv("lines"); });
  });
})();
