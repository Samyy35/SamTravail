// Sam'Travail — script de capture de marque, chargé par le favori (bookmarklet) "loader".
// Chargé via <script src> depuis le site d'une entreprise : voir bm-offer.js pour l'explication du principe.
(function () {
  "use strict";

  var APP = (function () {
    try {
      var cs = document.currentScript;
      if (!cs) {
        var all = document.getElementsByTagName("script");
        for (var i = all.length - 1; i >= 0; i--) {
          if ((all[i].src || "").indexOf("/bm-brand.js") >= 0) { cs = all[i]; break; }
        }
      }
      var u = new URL(cs.src);
      return u.protocol + "//" + u.host;
    } catch (e) { return ""; }
  })();
  if (!APP) return;

  function meta(p) {
    var ms = document.getElementsByTagName("meta");
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if ((m.getAttribute("property") || m.getAttribute("name")) === p) return m.content || "";
    }
    return "";
  }
  function strip(h) {
    var t = document.createElement("div");
    t.innerHTML = h || "";
    return (t.textContent || t.innerText || "").replace(/\s+/g, " ").trim();
  }

  var jn = "", jd = "", jc = "", js = "", ji = "", jl = "";

  // ===== 1) JSON-LD Organization =====
  (function () {
    var sc = document.getElementsByTagName("script");
    for (var i = 0; i < sc.length && !jn; i++) {
      if ((sc[i].type || "").indexOf("ld+json") < 0) continue;
      var j;
      try { j = JSON.parse(sc[i].textContent); } catch (e) { continue; }
      var st = [j], g = 0;
      while (st.length && !jn && g < 300) {
        g++;
        var o = st.shift();
        if (!o || typeof o !== "object") continue;
        if (Array.isArray(o)) { for (var z = 0; z < o.length; z++) st.push(o[z]); continue; }
        if (o["@graph"]) st.push(o["@graph"]);
        var ty = "" + (o["@type"] || "");
        if (/Organization|Corporation|LocalBusiness|EducationalOrganization|NewsMediaOrganization|WebSite/i.test(ty) && (o.name || o.legalName)) {
          jn = o.name || o.legalName;
          if (o.description) jd = o.description;
          if (o.numberOfEmployees) js = (typeof o.numberOfEmployees === "object" ? (o.numberOfEmployees.value || o.numberOfEmployees.name || "") : o.numberOfEmployees);
          if (o.address && o.address.addressLocality) jc = o.address.addressLocality;
          if (o.industry) ji = "" + o.industry;
          if (o.logo) jl = (typeof o.logo === "string" ? o.logo : (o.logo.url || ""));
          break;
        }
        for (var k in o) { var v = o[k]; if (v && typeof v === "object") st.push(v); }
      }
    }
  })();

  // ===== 2) blobs d'hydratation (Next.js et autres), si le JSON-LD n'a rien donné =====
  // Beaucoup de sites "carrières"/"à propos" modernes embarquent l'effectif/secteur dans leur
  // état d'hydratation (React/Next.js) sans le refléter dans le JSON-LD ni le DOM visible.
  function isOrg(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    if (!(o.name || o.legalName)) return false;
    return !!(o.numberOfEmployees || o.industry || o.foundingDate || o.founded || o.sameAs || o.legalName);
  }
  function pullOrg(o) {
    var nm = o.name || o.legalName || "";
    var sz = o.numberOfEmployees; if (sz && typeof sz === "object") sz = sz.value || sz.name || "";
    var ind = o.industry; if (ind && typeof ind === "object") ind = ind.name || "";
    var city = "";
    if (o.address) city = (typeof o.address === "string") ? o.address : (o.address.addressLocality || o.address.addressRegion || "");
    var logo = o.logo; if (logo && typeof logo === "object") logo = logo.url || logo.contentUrl || "";
    return { nm: nm, ds: o.description || "", sz: sz ? ("" + sz) : "", ind: ind ? ("" + ind) : "", city: city, logo: logo || "" };
  }
  function walkOrg(root, cb) {
    var stk = [root], g = 0;
    while (stk.length && g < 6000) {
      g++;
      var o = stk.shift();
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) stk.push(o[i]); continue; }
      if (isOrg(o) && cb(o)) return true;
      for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { var v = o[k]; if (v && typeof v === "object") stk.push(v); } }
    }
    return false;
  }
  function extractBalancedObjects(text, maxCount, maxLen) {
    var out = [], n = text.length;
    for (var i = 0; i < n && out.length < maxCount; i++) {
      if (text.charCodeAt(i) !== 123) continue;
      var depth = 0, inStr = false, esc = false;
      for (var j = i; j < n && j - i < maxLen; j++) {
        var ch = text.charAt(j);
        if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) { out.push(text.slice(i, j + 1)); i = j; break; } }
      }
    }
    return out;
  }
  if (!jn) {
    var blobs = [];
    try { if (window.__NUXT__) blobs.push(window.__NUXT__); } catch (e) {}
    try { if (window.__INITIAL_STATE__) blobs.push(window.__INITIAL_STATE__); } catch (e) {}
    try { if (window.__APOLLO_STATE__) blobs.push(window.__APOLLO_STATE__); } catch (e) {}
    try { if (window._initialData) blobs.push(window._initialData); } catch (e) {}
    try {
      var nd = document.getElementById("__NEXT_DATA__");
      if (nd) blobs.push(JSON.parse(nd.textContent));
    } catch (e) {}
    try {
      var nfBuf = "";
      if (window.__next_f && Array.isArray(window.__next_f)) {
        for (var nfi = 0; nfi < window.__next_f.length && nfBuf.length < 400000; nfi++) {
          var tup = window.__next_f[nfi];
          if (Array.isArray(tup) && typeof tup[1] === "string") nfBuf += tup[1];
        }
      }
      if (nfBuf) {
        var cands = extractBalancedObjects(nfBuf, 60, 30000);
        for (var nc = 0; nc < cands.length; nc++) { try { blobs.push(JSON.parse(cands[nc])); } catch (e) {} }
      }
    } catch (e) {}
    for (var bi = 0; bi < blobs.length && !jn; bi++) {
      walkOrg(blobs[bi], function (o) {
        var p = pullOrg(o);
        if (!p.nm || p.nm.length > 100) return false;
        jn = p.nm;
        if (p.ds) jd = p.ds;
        if (p.sz) js = p.sz;
        if (p.ind) ji = p.ind;
        if (p.city) jc = p.city;
        if (p.logo) jl = p.logo;
        return true;
      });
    }
  }

  var raw = jn || meta("og:site_name") || meta("application-name") || meta("twitter:title") || document.title || location.hostname;
  var name = ("" + raw).split(/[|\-–—:•·]/)[0].trim();
  name = name.replace(/\b(careers?|carri[eè]res?|jobs?|emplois?|recrutement|recruitment|talents?|hiring)\b/gi, " ").replace(/\s{2,}/g, " ").trim().slice(0, 60);
  if (!name) name = location.hostname.replace(/^www\./, "").split(".")[0];

  var ATS = /workday|myworkdayjobs|greenhouse|lever[.]co|taleo|icims|smartrecruiters|teamtailor|brassring|successfactors|recruitee|workable|jobvite|ashbyhq|breezy/i;
  var site = "";
  if (ATS.test(location.hostname)) {
    var rf = document.referrer || "";
    if (rf && !ATS.test(rf)) site = rf.split("/").slice(0, 3).join("/");
  } else {
    site = location.origin;
    if (!site || site === "null") {
      var cu = ((document.querySelector("link[rel=canonical]") || {}).href) || meta("og:url") || "";
      site = cu ? cu.split("/").slice(0, 3).join("/") : (location.protocol + "//" + location.hostname);
    }
  }
  var desc = (jd || meta("og:description") || meta("description") || meta("keywords") || "").slice(0, 400);
  var blogo = "";
  if (!ATS.test(location.hostname)) blogo = jl || meta("og:image") || meta("twitter:image") || meta("og:logo") || "";

  function buildUrl() {
    return APP + "/?addBrand=" + encodeURIComponent(name) + "&brandSite=" + encodeURIComponent(site) +
      "&brandDesc=" + encodeURIComponent(desc) + "&brandLogo=" + encodeURIComponent(blogo) +
      "&brandCity=" + encodeURIComponent(jc) + "&brandSize=" + encodeURIComponent(js) +
      "&brandSectorHint=" + encodeURIComponent(ji) + "&capture=1";
  }
  var w;
  try { window.addEventListener("message", function (ev) { if (ev && ev.data === "st-close" && w) { try { w.close(); } catch (e) {} } }); } catch (e) {}
  w = window.open(buildUrl(), "samtravail_capture", "width=680,height=840,scrollbars=yes");
  if (w) w.focus(); else window.open(buildUrl(), "_blank");
})();
