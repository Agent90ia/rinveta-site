/* Rinveta: apri P7M / leggi fattura elettronica XML. Tutto avviene in questa scheda del browser; i file non vengono mai caricati. Usa fpa-core.js. */
(function () {
  "use strict";
  var F = window.RinvetaFpa, $ = function (id) { return document.getElementById(id); };
  var busy = false;
  var TIPI = { TD01: "Fattura", TD02: "Acconto/anticipo su fattura", TD03: "Acconto/anticipo su parcella", TD04: "Nota di credito", TD05: "Nota di debito", TD06: "Parcella", TD16: "Integrazione fattura reverse charge interno", TD17: "Integrazione/autofattura acquisto servizi dall'estero", TD18: "Integrazione acquisto beni intra UE", TD19: "Integrazione/autofattura acquisto beni ex art. 17 c.2", TD20: "Autofattura/regolarizzazione", TD24: "Fattura differita", TD25: "Fattura differita (art. 36 c.4)", TD26: "Cessione beni ammortizzabili / passaggi interni", TD27: "Autofattura per autoconsumo o cessioni gratuite", TD28: "Acquisti da San Marino con IVA" };
  var MP = { MP01: "Contanti", MP02: "Assegno", MP03: "Assegno circolare", MP05: "Bonifico", MP08: "Carta di pagamento", MP12: "RIBA", MP19: "SEPA Direct Debit", MP23: "PagoPA" };
  function track(ev) { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "/tool/apri-file-p7m-fattura-xml/" + ev, title: "tool-fpv-" + ev, event: true }); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(v) { return typeof v === "number" ? v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
  function qty(v) { return typeof v === "number" ? v.toLocaleString("it-IT", { maximumFractionDigits: 4 }) : ""; }
  function msg(t, bad) { var m = $("fv-msg"); m.textContent = t; m.className = bad ? "note tl-bad" : "note"; }
  function party(p) { return "<p><strong>" + esc(p.den || "(denominazione non indicata)") + "</strong><br>" + (p.piva ? "P.IVA " + esc(p.piva) + "<br>" : "") + (p.cf ? "C.F. " + esc(p.cf) + "<br>" : "") + (p.sede ? esc(p.sede) : "") + "</p>"; }

  function invoice(d) {
    var cur = d.divisa && d.divisa !== "EUR" ? " " + esc(d.divisa) : "";
    var tipo = (TIPI[d.tipo] ? TIPI[d.tipo] + " (" + esc(d.tipo) + ")" : esc(d.tipo || "Documento"));
    var h = '<article class="fv-doc"><h3>' + tipo + " n. " + esc(d.numero) + " del " + esc(F.itDate(d.data)) + '</h3><p class="note">File: ' + esc(d.file) + (d.fmt ? " · formato " + esc(d.fmt) : "") + "</p>";
    h += '<div class="fv-parties"><div><h4>Cedente/prestatore (chi emette)</h4>' + party(d.ced) + '</div><div><h4>Cessionario/committente (chi riceve)</h4>' + party(d.ces) + "</div></div>";
    if (d.causale.length) h += "<p><strong>Causale:</strong> " + esc(d.causale.join(" ")) + "</p>";
    h += '<div class="tl-scroll fv-scroll"><table class="tl-table fv-table"><thead><tr><th>N.</th><th>Descrizione</th><th class="r">Quantità</th><th>U.m.</th><th class="r">Prezzo unit.</th><th class="r">IVA %</th><th class="r">Totale riga</th></tr></thead><tbody>";
    h += d.righe.map(function (r) { return "<tr><td>" + esc(r.n) + "</td><td class=\"w\">" + esc(r.desc) + "</td><td class=\"r\">" + qty(r.qta) + "</td><td>" + esc(r.um) + "</td><td class=\"r\">" + money(r.pu) + '</td><td class="r">' + (r.aliq === null ? "" : qty(r.aliq)) + (r.nat ? " " + esc(r.nat) : "") + '</td><td class="r">' + money(r.pt) + "</td></tr>"; }).join("");
    h += "</tbody></table></div>";
    if (d.riep.length) {
      h += "<h4>Riepilogo IVA</h4>" + '<div class="tl-scroll fv-scroll"><table class="tl-table fv-table"><thead><tr><th class="r">Aliquota %</th><th>Natura</th><th class="r">Imponibile</th><th class="r">Imposta</th><th>Esigibilità</th></tr></thead><tbody>' +
        d.riep.map(function (r) { return '<tr><td class="r">' + (r.aliq === null ? "" : qty(r.aliq)) + "</td><td>" + esc(r.nat) + '</td><td class="r">' + money(r.imp) + '</td><td class="r">' + money(r.iva) + "</td><td>" + esc(r.esig) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    h += '<table class="fv-tot"><tbody><tr><th>Imponibile</th><td>' + money(d.imp) + cur + "</td></tr><tr><th>IVA</th><td>" + money(d.iva) + cur + "</td></tr>" +
      (typeof d.bollo === "number" ? "<tr><th>Bollo</th><td>" + money(d.bollo) + cur + "</td></tr>" : "") +
      '<tr class="g"><th>Totale documento</th><td>' + money(d.tot) + cur + "</td></tr></tbody></table>" +
      '<p class="note">' + (d.orig === "da documento" ? "Totale dichiarato nel documento." : "Totale non indicato nel documento: calcolato come imponibile + IVA.") + "</p>";
    if (d.pag.length) {
      h += "<h4>Pagamento e scadenze</h4>" + (d.condPag ? '<p class="note">Condizioni: ' + esc({ TP01: "pagamento a rate", TP02: "pagamento completo", TP03: "anticipo" }[d.condPag] || d.condPag) + "</p>" : "") +
        '<div class="tl-scroll fv-scroll"><table class="tl-table fv-table"><thead><tr><th>Scadenza</th><th>Modalità</th><th class="r">Importo</th><th>IBAN</th></tr></thead><tbody>' +
        d.pag.map(function (p) { return "<tr><td>" + (p.scad ? esc(F.itDate(p.scad)) : "") + "</td><td>" + esc(MP[p.mod] ? MP[p.mod] + " (" + p.mod + ")" : p.mod) + '</td><td class="r">' + money(p.imp) + "</td><td>" + esc(p.iban) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    return h + "</article>";
  }

  function render(res) {
    var bad = res.files.filter(function (f) { return !f.ok; });
    $("fv-out").hidden = false;
    var issues = "";
    if (res.truncated) issues += '<p class="note tl-bad">Hai caricato ' + res.total + " file fattura: ne vengono mostrati " + F.MAX_FILES + ". Ricarica gli altri " + res.truncated + " in un secondo momento.</p>";
    if (bad.length || res.skipped.length || res.warnings.length) {
      issues += "<p><strong>Da controllare:</strong></p><ul>" + bad.map(function (f) { return "<li>" + esc(f.name) + ": " + esc(f.error) + "</li>"; }).join("") +
        res.skipped.map(function (s) { return "<li>" + esc(s.name) + ": " + esc(s.reason) + " (saltato)</li>"; }).join("") + res.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>";
    }
    $("fv-warn").innerHTML = issues;
    $("fv-docs").innerHTML = res.docs.map(invoice).join("");
    $("fv-acts").hidden = !res.docs.length;
  }

  async function handleFiles(list) {
    if (!list || !list.length || busy) return;
    busy = true; msg("Lettura in corso, sul tuo computer…");
    try {
      var inputs = [];
      for (var i = 0; i < list.length; i++) inputs.push({ name: list[i].name, bytes: new Uint8Array(await list[i].arrayBuffer()) });
      var res = await F.convert(inputs);
      render(res);
      var n = res.docs.length;
      msg(n ? "Fatto: " + n + (n === 1 ? " fattura letta." : " fatture lette.") + " Nulla è stato caricato." : "Nessuna fattura leggibile in questi file.", !n);
      track("file");
    } catch (e) { msg("Non è stato possibile leggere questi file.", true); }
    busy = false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var inp = $("fv-file"), drop = $("fv-drop");
    inp.addEventListener("change", function () { handleFiles(inp.files); });
    ["dragover", "dragenter"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (ev) { handleFiles(ev.dataTransfer.files); });
    $("fv-print").addEventListener("click", function () { track("stampa"); window.print(); });
  });
})();
