/* Rinveta free tool core: FatturaPA (XML / P7M / ZIP) to table rows. Runs in the browser only; no network access, no DOM needed. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RinvetaFpa = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_FILES = 20, MAX_ENTRY = 50 * 1024 * 1024, MAX_TOTAL = 200 * 1024 * 1024, MAX_ZIP_ENTRIES = 2000;

  /* ---------- XML: small namespace-agnostic parser (no DOCTYPE/entity expansion, so nothing can blow up) ---------- */
  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function decodeEntities(s) {
    if (s.indexOf("&") < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (m, g) {
      if (g.charAt(0) === "#") {
        var cp = g.charAt(1) === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        try { return String.fromCodePoint(cp); } catch (e) { return m; }
      }
      return Object.prototype.hasOwnProperty.call(ENT, g) ? ENT[g] : m;
    });
  }

  function parseXml(text) {
    var root = { n: "#root", t: "", c: [] }, stack = [root], i = 0, len = text.length, depth = 0;
    while (i < len) {
      var lt = text.indexOf("<", i);
      if (lt < 0) break;
      if (lt > i) { var tx = text.slice(i, lt); if (/\S/.test(tx)) stack[stack.length - 1].t += decodeEntities(tx); }
      if (text.startsWith("<!--", lt)) { var ce = text.indexOf("-->", lt + 4); if (ce < 0) throw new Error("XML non valido (commento non chiuso)"); i = ce + 3; continue; }
      if (text.startsWith("<![CDATA[", lt)) { var de = text.indexOf("]]>", lt + 9); if (de < 0) throw new Error("XML non valido (CDATA non chiuso)"); stack[stack.length - 1].t += text.slice(lt + 9, de); i = de + 3; continue; }
      if (text.startsWith("<?", lt)) { var pe = text.indexOf("?>", lt + 2); if (pe < 0) throw new Error("XML non valido"); i = pe + 2; continue; }
      if (text.startsWith("<!", lt)) { var ge = text.indexOf(">", lt + 2); if (ge < 0) throw new Error("XML non valido"); i = ge + 1; continue; }
      var gt = lt + 1, q = 0;
      while (gt < len) { var ch = text.charCodeAt(gt); if (q) { if (ch === q) q = 0; } else if (ch === 34 || ch === 39) q = ch; else if (ch === 62) break; gt++; }
      if (gt >= len) throw new Error("XML non valido (tag non chiuso)");
      var tag = text.slice(lt + 1, gt);
      if (tag.charAt(0) === "/") {
        if (stack.length < 2) throw new Error("XML non valido (tag di chiusura in eccesso)");
        stack.pop(); depth--;
      } else {
        var self = tag.charAt(tag.length - 1) === "/";
        if (self) tag = tag.slice(0, -1);
        var nm = /^[^\s/>]+/.exec(tag);
        if (!nm) throw new Error("XML non valido (nome tag mancante)");
        var name = nm[0], k = name.indexOf(":"); if (k >= 0) name = name.slice(k + 1);
        var node = { n: name, t: "", c: [] };
        stack[stack.length - 1].c.push(node);
        if (!self) { if (++depth > 200) throw new Error("XML troppo annidato"); stack.push(node); }
      }
      i = gt + 1;
    }
    if (stack.length !== 1) throw new Error("XML non valido (tag non chiusi)");
    return root.c[0] || null;
  }

  function kid(n, name) { if (!n) return null; for (var i = 0; i < n.c.length; i++) if (n.c[i].n === name) return n.c[i]; return null; }
  function kids(n, name) { return n ? n.c.filter(function (x) { return x.n === name; }) : []; }
  function path(n, p) { var cur = n, parts = p.split("/"); for (var i = 0; cur && i < parts.length; i++) cur = kid(cur, parts[i]); return cur; }
  function txt(n, p) { var x = p ? path(n, p) : n; return x ? x.t.trim() : ""; }

  /* ---------- bytes -> text ---------- */
  function decodeXmlBytes(b) {
    var off = 0;
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) off = 3;
    var enc = "utf-8";
    var head = ""; for (var i = off; i < Math.min(b.length, 200); i++) head += String.fromCharCode(b[i]);
    var m = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);
    if (m) { var e = m[1].toLowerCase(); if (e === "iso-8859-1" || e === "latin1" || e === "windows-1252" || e === "iso-8859-15") enc = "windows-1252"; }
    return new TextDecoder(enc).decode(off ? b.subarray(off) : b);
  }

  function indexOfAscii(b, s, from) {
    var n = s.length, c0 = s.charCodeAt(0);
    outer: for (var i = from || 0; i <= b.length - n; i++) {
      if (b[i] !== c0) continue;
      for (var j = 1; j < n; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
      return i;
    }
    return -1;
  }

  /* ---------- P7M (CAdES / CMS SignedData): read the signed XML out of the BER structure ---------- */
  function berNode(b, pos, limit, depth) {
    if (depth > 40 || pos + 2 > limit) throw new Error("struttura P7M non valida");
    var tagByte = b[pos], cls = tagByte >> 6, cons = (tagByte & 0x20) !== 0, tag = tagByte & 0x1f, p = pos + 1;
    if (tag === 0x1f) { tag = 0; while (p < limit && (b[p] & 0x80)) { tag = (tag << 7) | (b[p] & 0x7f); p++; } tag = (tag << 7) | (b[p] & 0x7f); p++; }
    var l = b[p++], indef = false, vlen;
    if (l === 0x80) indef = true;
    else if (l & 0x80) { var nb = l & 0x7f; if (nb > 4 || p + nb > limit) throw new Error("struttura P7M non valida"); vlen = 0; for (var i = 0; i < nb; i++) vlen = vlen * 256 + b[p++]; }
    else vlen = l;
    var node = { cls: cls, cons: cons, tag: tag, start: p, kids: [] };
    if (indef) {
      if (!cons) throw new Error("struttura P7M non valida");
      var q = p;
      while (true) {
        if (q + 2 > limit) throw new Error("struttura P7M non valida");
        if (b[q] === 0 && b[q + 1] === 0) { q += 2; break; }
        var k = berNode(b, q, limit, depth + 1); node.kids.push(k); q = k.end;
      }
      node.end = q; node.vend = q - 2;
    } else {
      if (p + vlen > limit) throw new Error("struttura P7M non valida");
      node.end = p + vlen; node.vend = node.end;
      if (cons) { var r = p; while (r < node.end) { var k2 = berNode(b, r, node.end, depth + 1); node.kids.push(k2); r = k2.end; } }
    }
    return node;
  }

  function octets(b, node) { // OCTET STRING, primitive or constructed (chunked)
    if (!node.cons) return b.subarray(node.start, node.vend);
    var parts = node.kids.map(function (k) { return octets(b, k); }), n = 0, o = 0;
    parts.forEach(function (x) { n += x.length; });
    var out = new Uint8Array(n); parts.forEach(function (x) { out.set(x, o); o += x.length; });
    return out;
  }

  function fromBase64Text(b) { // PEM-like or plain base64 .p7m
    var s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    s = s.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    if (!s || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
    var bin; try { bin = atob(s); } catch (e) { return null; }
    var out = new Uint8Array(bin.length); for (var j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
    return out;
  }

  function looksXml(b) { var i = 0; if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) i = 3; while (i < b.length && (b[i] === 32 || b[i] === 9 || b[i] === 10 || b[i] === 13)) i++; return b[i] === 0x3C; }

  /* Returns the XML bytes inside a P7M; falls back to a plain scan for <?xml ... </FatturaElettronica> when the structure is unusual. */
  function extractP7m(bytes) {
    var cur = bytes, tries = 0;
    while (tries++ < 4) {
      if (looksXml(cur)) return cur;
      if (cur[0] !== 0x30) { var d = fromBase64Text(cur); if (d && d[0] === 0x30) { cur = d; continue; } break; }
      var inner = null;
      try {
        var ci = berNode(cur, 0, cur.length, 0); // ContentInfo
        var ctx = ci.kids[1]; // [0] EXPLICIT
        var sd = ctx && ctx.kids[0]; // SignedData
        var enc = null;
        if (sd) for (var i = 1; i < sd.kids.length; i++) { var k = sd.kids[i]; if (k.tag === 16 && k.cls === 0 && k.kids.length && k.kids[0].tag === 6) { enc = k; break; } } // encapContentInfo
        var c0 = enc && enc.kids[1], os = c0 && c0.kids[0];
        if (os && os.tag === 4) inner = octets(cur, os);
      } catch (e) { inner = null; }
      if (inner && inner.length) { cur = inner; continue; }
      break;
    }
    if (looksXml(cur)) return cur;
    var s = indexOfAscii(bytes, "<?xml", 0); if (s < 0) s = indexOfAscii(bytes, "<p:FatturaElettronica", 0); if (s < 0) s = indexOfAscii(bytes, "<FatturaElettronica", 0);
    if (s >= 0) {
      var end = -1, e0 = 0, lastClose = -1;
      while ((e0 = indexOfAscii(bytes, "FatturaElettronica>", e0)) >= 0) { lastClose = e0 + "FatturaElettronica>".length; e0 = lastClose; }
      end = lastClose;
      if (end > s) return bytes.subarray(s, end);
    }
    throw new Error("impossibile estrarre l'XML dal file P7M");
  }

  /* ---------- ZIP (stored + deflate) with size guards ---------- */
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  async function inflateRaw(data, cap) {
    var ds = new DecompressionStream("deflate-raw");
    var w = ds.writable.getWriter(); w.write(data).catch(function () {}); w.close().catch(function () {});
    var rd = ds.readable.getReader(), chunks = [], total = 0;
    while (true) {
      var r = await rd.read(); if (r.done) break;
      total += r.value.length; if (total > cap) { try { await rd.cancel(); } catch (e) {} throw new Error("file troppo grande dopo la decompressione"); }
      chunks.push(r.value);
    }
    var out = new Uint8Array(total), o = 0; chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return out;
  }

  function zipEntries(b) {
    var eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { eocd = i; break; }
    if (eocd < 0) throw new Error("archivio ZIP non valido");
    var n = u16(b, eocd + 10), cd = u32(b, eocd + 16), out = [], p = cd;
    if (n > MAX_ZIP_ENTRIES) throw new Error("archivio ZIP con troppi file");
    for (var k = 0; k < n; k++) {
      if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Error("archivio ZIP non valido");
      var flags = u16(b, p + 8), method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24), nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), lho = u32(b, p + 42);
      var nameBytes = b.subarray(p + 46, p + 46 + nl), name;
      try { name = new TextDecoder((flags & 0x800) ? "utf-8" : "utf-8", { fatal: true }).decode(nameBytes); } catch (e) { name = new TextDecoder("windows-1252").decode(nameBytes); }
      out.push({ name: name, method: method, csize: csize, usize: usize, lho: lho, enc: (flags & 1) !== 0 });
      p += 46 + nl + el + cl;
    }
    return out;
  }

  async function zipRead(b, ent, budget) {
    if (ent.enc) throw new Error("ZIP protetto da password");
    if (ent.usize > MAX_ENTRY) throw new Error("file troppo grande");
    if (budget.left < ent.usize) throw new Error("archivio troppo grande");
    var p = ent.lho;
    if (u32(b, p) !== 0x04034b50) throw new Error("archivio ZIP non valido");
    var start = p + 30 + u16(b, p + 26) + u16(b, p + 28), data = b.subarray(start, start + ent.csize), out;
    if (ent.method === 0) out = data;
    else if (ent.method === 8) out = await inflateRaw(data, Math.min(MAX_ENTRY, budget.left));
    else throw new Error("metodo di compressione ZIP non supportato");
    budget.left -= out.length;
    return out;
  }

  function kindOf(name) {
    var l = name.toLowerCase();
    if (/\.zip$/.test(l)) return "zip";
    if (/\.p7m$/.test(l)) return "p7m";
    if (/\.xml$/.test(l)) return "xml";
    return "";
  }
  function baseName(n) { return String(n).replace(/\\/g, "/").split("/").pop(); }

  /* Expand a list of {name, bytes} into invoice files [{name, bytes, kind}] (xml|p7m). ZIPs are opened one level deep.
     Returns {files: [...], skipped: [{name, reason}]}. Never throws for a single bad entry. */
  async function expand(inputs) {
    var files = [], skipped = [], budget = { left: MAX_TOTAL };
    for (var i = 0; i < inputs.length; i++) {
      var f = inputs[i], kd = kindOf(f.name);
      if (kd === "zip") {
        try {
          var ents = zipEntries(f.bytes);
          for (var j = 0; j < ents.length; j++) {
            var en = ents[j], nm = baseName(en.name), k2 = kindOf(nm);
            if (/\/$/.test(en.name) || /^__MACOSX\//.test(en.name) || nm.charAt(0) === "." || !nm) continue;
            if (k2 !== "xml" && k2 !== "p7m") { skipped.push({ name: f.name + " > " + nm, reason: "non è un file XML o P7M" }); continue; }
            try { files.push({ name: nm, bytes: await zipRead(f.bytes, en, budget), kind: k2 }); }
            catch (e) { skipped.push({ name: f.name + " > " + nm, reason: e.message }); }
          }
        } catch (e) { skipped.push({ name: f.name, reason: e.message }); }
      } else if (kd) files.push({ name: baseName(f.name), bytes: f.bytes, kind: kd });
      else skipped.push({ name: f.name, reason: "formato non supportato (servono .xml, .p7m o .zip)" });
    }
    return { files: files, skipped: skipped };
  }

  /* ---------- FatturaPA -> rows ---------- */
  function num(s) { if (s === "" || s == null) return null; var v = Number(s); return isFinite(v) ? v : null; }
  function r2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
  function party(n) {
    var da = path(n, "DatiAnagrafici");
    var piva = da ? (txt(da, "IdFiscaleIVA/IdPaese") + txt(da, "IdFiscaleIVA/IdCodice")) : "";
    var den = txt(da, "Anagrafica/Denominazione");
    if (!den) den = (txt(da, "Anagrafica/Nome") + " " + txt(da, "Anagrafica/Cognome")).trim();
    var sd = path(n, "Sede"), sede = sd ? [txt(sd, "Indirizzo") + (txt(sd, "NumeroCivico") ? " " + txt(sd, "NumeroCivico") : ""), (txt(sd, "CAP") + " " + txt(sd, "Comune") + (txt(sd, "Provincia") ? " (" + txt(sd, "Provincia") + ")" : "")).trim(), txt(sd, "Nazione")].filter(Boolean).join(", ") : "";
    return { piva: piva, cf: txt(da, "CodiceFiscale"), den: den, sede: sede };
  }
  function dateCell(s) { return /^\d{4}-\d{2}-\d{2}/.test(s) ? { d: s.slice(0, 10) } : s; }
  function itDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[3] + "/" + m[2] + "/" + m[1] : s; }

  var HEAD = ["File", "Formato", "Tipo documento", "Numero", "Data", "Divisa", "Cedente/prestatore P.IVA", "Cedente/prestatore C.F.", "Cedente/prestatore denominazione",
    "Cessionario/committente P.IVA", "Cessionario/committente C.F.", "Cessionario/committente denominazione", "Imponibile", "IVA", "Totale documento", "Origine totale",
    "Scadenze", "Importo da pagare", "Modalità pagamento", "Causale",
    "Ritenuta tipo", "Ritenuta aliquota %", "Ritenuta importo", "Ritenuta causale pagamento", "Cassa previdenziale tipo", "Cassa aliquota %", "Cassa importo", "Bollo virtuale", "Bollo importo", "IBAN"];
  var LINES = ["File", "Numero fattura", "Data", "Cedente/prestatore", "N. linea", "Codice articolo", "Descrizione", "Quantità", "Unità di misura", "Prezzo unitario", "Prezzo totale", "Aliquota IVA %", "Natura IVA"];
  var RIEP = ["File", "Numero fattura", "Data", "Cedente/prestatore", "Aliquota IVA %", "Natura", "Imponibile", "Imposta", "Esigibilità IVA", "Esigibilità (descrizione)", "Riferimento normativo"];
  var ESIG = { I: "immediata", D: "differita", S: "scissione dei pagamenti (split payment)" };

  /* colonna "uno o piu' valori": numero se unico, testo unito da "; " se piu' di uno, vuoto se assente */
  function oneOrMany(vals) { var v = vals.filter(function (x) { return x !== "" && x !== null; }); if (!v.length) return ""; if (v.length === 1) return v[0]; var u = []; v.forEach(function (x) { if (u.indexOf(x) < 0) u.push(x); }); return u.length === 1 ? u[0] : u.join("; "); }
  function sumOrEmpty(vals) { var v = vals.filter(function (x) { return x !== null; }); return v.length ? r2(v.reduce(function (a, b) { return a + b; }, 0)) : ""; }

  /* Returns {head: [rows], lines: [rows], warnings: [str]}; throws on non-FatturaPA content. */
  function parseInvoice(xmlText, fileName) {
    var rootNode = parseXml(xmlText);
    if (!rootNode) throw new Error("file XML vuoto");
    if (rootNode.n === "FatturaElettronicaSemplificata") throw new Error("fattura semplificata: formato non supportato da questo strumento");
    if (rootNode.n !== "FatturaElettronica") throw new Error("non è una fattura elettronica FatturaPA (elemento radice «" + rootNode.n + "»)");
    var hdr = kid(rootNode, "FatturaElettronicaHeader"), bodies = kids(rootNode, "FatturaElettronicaBody");
    if (!hdr || !bodies.length) throw new Error("fattura incompleta: mancano intestazione o corpo");
    var ced = party(path(hdr, "CedentePrestatore")), ces = party(path(hdr, "CessionarioCommittente"));
    var fmt = txt(hdr, "DatiTrasmissione/FormatoTrasmissione");
    var out = { head: [], lines: [], riep: [], warnings: [], docs: [] };
    bodies.forEach(function (bd, bi) {
      var dg = path(bd, "DatiGenerali/DatiGeneraliDocumento");
      if (!dg) { out.warnings.push("corpo " + (bi + 1) + ": DatiGeneraliDocumento mancante"); return; }
      var imp = 0, iva = 0, riep = kids(path(bd, "DatiBeniServizi"), "DatiRiepilogo");
      riep.forEach(function (r) { imp += num(txt(r, "ImponibileImporto")) || 0; iva += num(txt(r, "Imposta")) || 0; });
      imp = r2(imp); iva = r2(iva);
      var totDoc = num(txt(dg, "ImportoTotaleDocumento")), tot = totDoc, orig = "da documento";
      if (tot === null) { tot = r2(imp + iva); orig = "calcolato (imponibile + IVA)"; }
      var pays = kids(path(bd, "DatiPagamento"), "DettaglioPagamento"), dates = [], modes = [], toPay = 0, anyPay = false;
      kids(bd, "DatiPagamento").forEach(function (dp) { kids(dp, "DettaglioPagamento").forEach(function (p) {
        var d = txt(p, "DataScadenzaPagamento"), m = txt(p, "ModalitaPagamento"), a = num(txt(p, "ImportoPagamento"));
        if (d && dates.indexOf(d) < 0) dates.push(d);
        if (m && modes.indexOf(m) < 0) modes.push(m);
        if (a !== null) { toPay += a; anyPay = true; }
      }); });
      var causale = kids(dg, "Causale").map(function (c) { return c.t.trim(); }).join(" ");
      var numero = txt(dg, "Numero"), data = txt(dg, "Data");
      var rit = kids(dg, "DatiRitenuta"), cas = kids(dg, "DatiCassaPrevidenziale");
      var ibans = []; kids(bd, "DatiPagamento").forEach(function (dp) { kids(dp, "DettaglioPagamento").forEach(function (p) { var ib = txt(p, "IBAN"); if (ib && ibans.indexOf(ib) < 0) ibans.push(ib); }); });
      var bolloImp = num(txt(dg, "DatiBollo/ImportoBollo")), bolloVirt = txt(dg, "DatiBollo/BolloVirtuale");
      var doc = { file: fileName + (bodies.length > 1 ? " (fattura " + (bi + 1) + " di " + bodies.length + ")" : ""), fmt: fmt, tipo: txt(dg, "TipoDocumento"), numero: numero, data: data, divisa: txt(dg, "Divisa"),
        causale: kids(dg, "Causale").map(function (c) { return c.t.trim(); }).filter(Boolean), ced: ced, ces: ces, imp: imp, iva: iva, tot: tot, orig: orig, righe: [], riep: [], pag: [],
        ritenute: rit.map(function (r) { return { tipo: txt(r, "TipoRitenuta"), aliq: num(txt(r, "AliquotaRitenuta")), imp: num(txt(r, "ImportoRitenuta")), causale: txt(r, "CausalePagamento") }; }),
        casse: cas.map(function (c) { return { tipo: txt(c, "TipoCassa"), aliq: num(txt(c, "AlCassa")), imp: num(txt(c, "ImportoContributoCassa")), imponibile: num(txt(c, "ImponibileCassa")), aliqIva: num(txt(c, "AliquotaIVA")) }; }),
        iban: ibans.slice(),
        condPag: txt(path(bd, "DatiPagamento"), "CondizioniPagamento"), bollo: num(txt(dg, "DatiBollo/ImportoBollo")) };
      riep.forEach(function (r) { doc.riep.push({ aliq: num(txt(r, "AliquotaIVA")), nat: txt(r, "Natura"), imp: num(txt(r, "ImponibileImporto")), iva: num(txt(r, "Imposta")), esig: txt(r, "EsigibilitaIVA"), rif: txt(r, "RiferimentoNormativo") }); });
      kids(bd, "DatiPagamento").forEach(function (dp) { kids(dp, "DettaglioPagamento").forEach(function (p) { doc.pag.push({ scad: txt(p, "DataScadenzaPagamento"), mod: txt(p, "ModalitaPagamento"), imp: num(txt(p, "ImportoPagamento")), iban: txt(p, "IBAN"), ben: txt(p, "Beneficiario") }); }); });
      kids(path(bd, "DatiBeniServizi"), "DettaglioLinee").forEach(function (ln) { doc.righe.push({ n: txt(ln, "NumeroLinea"), desc: txt(ln, "Descrizione"), qta: num(txt(ln, "Quantita")), um: txt(ln, "UnitaMisura"), pu: num(txt(ln, "PrezzoUnitario")), pt: num(txt(ln, "PrezzoTotale")), aliq: num(txt(ln, "AliquotaIVA")), nat: txt(ln, "Natura") }); });
      out.docs.push(doc);
      out.head.push([fileName + (bodies.length > 1 ? " (fattura " + (bi + 1) + " di " + bodies.length + ")" : ""), fmt, txt(dg, "TipoDocumento"), numero, dateCell(data), txt(dg, "Divisa"),
        ced.piva, ced.cf, ced.den, ces.piva, ces.cf, ces.den, imp, iva, tot, orig, dates.map(itDate).join("; "), anyPay ? r2(toPay) : "", modes.join("; "), causale,
        oneOrMany(rit.map(function (r) { return txt(r, "TipoRitenuta"); })), oneOrMany(rit.map(function (r) { return num(txt(r, "AliquotaRitenuta")); })), sumOrEmpty(rit.map(function (r) { return num(txt(r, "ImportoRitenuta")); })), oneOrMany(rit.map(function (r) { return txt(r, "CausalePagamento"); })),
        oneOrMany(cas.map(function (c) { return txt(c, "TipoCassa"); })), oneOrMany(cas.map(function (c) { return num(txt(c, "AlCassa")); })), sumOrEmpty(cas.map(function (c) { return num(txt(c, "ImportoContributoCassa")); })),
        bolloVirt, bolloImp === null ? "" : bolloImp, ibans.join("; ")]);
      riep.forEach(function (r) {
        var al = num(txt(r, "AliquotaIVA")), ib = num(txt(r, "ImponibileImporto")), ip = num(txt(r, "Imposta")), es = txt(r, "EsigibilitaIVA");
        out.riep.push([fileName + (bodies.length > 1 ? " (fattura " + (bi + 1) + " di " + bodies.length + ")" : ""), numero, dateCell(data), ced.den, al === null ? "" : al, txt(r, "Natura"), ib === null ? "" : ib, ip === null ? "" : ip, es, ESIG[es] || "", txt(r, "RiferimentoNormativo")]);
      });
      kids(path(bd, "DatiBeniServizi"), "DettaglioLinee").forEach(function (ln) {
        var codes = kids(ln, "CodiceArticolo").map(function (c) { return txt(c, "CodiceValore"); }).filter(Boolean).join("; ");
        out.lines.push([fileName, numero, dateCell(data), ced.den, num(txt(ln, "NumeroLinea")) === null ? txt(ln, "NumeroLinea") : num(txt(ln, "NumeroLinea")), codes, txt(ln, "Descrizione"),
          num(txt(ln, "Quantita")) === null ? "" : num(txt(ln, "Quantita")), txt(ln, "UnitaMisura"), num(txt(ln, "PrezzoUnitario")) === null ? "" : num(txt(ln, "PrezzoUnitario")),
          num(txt(ln, "PrezzoTotale")) === null ? "" : num(txt(ln, "PrezzoTotale")), num(txt(ln, "AliquotaIVA")) === null ? "" : num(txt(ln, "AliquotaIVA")), txt(ln, "Natura")]);
      });
    });
    return out;
  }

  /* inputs: [{name, bytes}] -> {head, lines, files:[{name, ok, invoices, error}], skipped, truncated, total} ; max 20 invoice files per run */
  async function convert(inputs, opt) {
    var limit = (opt && opt.limit) || MAX_FILES;
    var ex = await expand(inputs), res = { head: [HEAD], lines: [LINES], riep: [RIEP], docs: [], files: [], skipped: ex.skipped, truncated: 0, total: ex.files.length, warnings: [] };
    var list = ex.files.slice(0, limit); res.truncated = Math.max(0, ex.files.length - limit);
    list.forEach(function (f) {
      try {
        var inner = f.kind === "p7m" ? extractP7m(f.bytes) : f.bytes;
        var r = parseInvoice(decodeXmlBytes(inner), f.name);
        r.docs.forEach(function (x) { res.docs.push(x); }); r.head.forEach(function (x) { res.head.push(x); }); r.lines.forEach(function (x) { res.lines.push(x); }); r.riep.forEach(function (x) { res.riep.push(x); });
        r.warnings.forEach(function (w) { res.warnings.push(f.name + ": " + w); });
        res.files.push({ name: f.name, ok: true, invoices: r.head.length });
      } catch (e) { res.files.push({ name: f.name, ok: false, error: e.message }); }
    });
    return res;
  }

  /* ---------- writers ---------- */
  function serial(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569 : null; }
  function toSheetRows(rows) { // cells for SheetJS aoa_to_sheet: dates as real Excel dates, numbers as numbers
    return rows.map(function (r) { return r.map(function (c) {
      if (c && typeof c === "object" && c.d) { var s = serial(c.d); return s === null ? c.d : { t: "n", v: s, z: "dd/mm/yyyy" }; }
      if (typeof c === "number") return { t: "n", v: c, z: Number.isInteger(c) ? "0" : "#,##0.00##" };
      return c;
    }); });
  }
  function csvCell(c) {
    var s;
    if (c && typeof c === "object" && c.d) s = itDate(c.d);
    else if (typeof c === "number") s = String(c).replace(".", ","); // Italian Excel reads the decimal comma
    else {
      s = c == null ? "" : String(c);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // never let a text cell run as a spreadsheet formula
    }
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n") + "\r\n"; }

  return { MAX_FILES: MAX_FILES, HEAD: HEAD, LINES: LINES, RIEP: RIEP, parseXml: parseXml, parseInvoice: parseInvoice, extractP7m: extractP7m, decodeXmlBytes: decodeXmlBytes,
    expand: expand, convert: convert, toSheetRows: toSheetRows, toCsv: toCsv, itDate: itDate };
});
