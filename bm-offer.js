// Sam'Travail — script de capture d'offre, chargé par le favori (bookmarklet) "loader".
// Chargé via <script src> depuis n'importe quel site : s'exécute dans le contexte de CETTE page.
// Le favori lui-même ne contient plus que 3 lignes (voir bookmarklet-loader dans index.html) :
// ça permet d'améliorer cette extraction sans jamais avoir à réinstaller le favori.
(function () {
  "use strict";

  // ---- origine de l'appli (Sam'Travail), déduite de l'URL depuis laquelle CE script a été chargé ----
  var APP = (function () {
    try {
      var cs = document.currentScript;
      if (!cs) {
        var all = document.getElementsByTagName("script");
        for (var i = all.length - 1; i >= 0; i--) {
          if ((all[i].src || "").indexOf("/bm-offer.js") >= 0) { cs = all[i]; break; }
        }
      }
      var u = new URL(cs.src);
      return u.protocol + "//" + u.host;
    } catch (e) { return ""; }
  })();
  if (!APP) return;

  var LIM = 5000;
  var WS = /\s+/g;

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
    return (t.textContent || t.innerText || "").replace(WS, " ").trim();
  }
  function clean(t, hard) {
    t = ("" + (t || "")).replace(WS, " ").trim();
    var low = t.toLowerCase(), cut = t.length;
    var seps = [" | ", " – ", " — ", " • ", " · ", " chez ", " at ", "| "];
    if (hard) seps.push(" - ");
    for (var i = 0; i < seps.length; i++) { var p = low.indexOf(seps[i]); if (p > 2 && p < cut) cut = p; }
    return t.substring(0, cut).trim();
  }
  function gx(n) {
    var e = document.querySelector("[itemtype$=JobPosting] [itemprop=" + n + "],[itemprop=" + n + "]");
    return e ? (e.getAttribute("content") || e.innerText || e.textContent || "").trim() : "";
  }
  function Q(sels) {
    for (var i = 0; i < sels.length; i++) {
      var e = document.querySelector(sels[i]);
      if (e) { var t = (e.innerText || e.textContent || "").replace(WS, " ").trim(); if (t) return t; }
    }
    return "";
  }

  var d = { t: "", e: "", l: "", c: "", ds: "", dt: "", x: "", sal: "", lg: "", cu: "" };
  var FL = ""; // lien canonique (si trouvé), sinon location.href

  // ===== 1) JSON-LD JobPosting =====
  (function () {
    var sc = document.getElementsByTagName("script");
    for (var i = 0; i < sc.length && !d.t; i++) {
      if ((sc[i].type || "").indexOf("ld+json") < 0) continue;
      var j;
      try { j = JSON.parse(sc[i].textContent); } catch (e) { continue; }
      var st = [j], guard = 0;
      while (st.length && !d.t && guard < 400) {
        guard++;
        var o = st.shift();
        if (!o || typeof o !== "object") continue;
        if (Array.isArray(o)) { for (var z = 0; z < o.length; z++) st.push(o[z]); continue; }
        if (o["@graph"]) st.push(o["@graph"]);
        var ty = o["@type"];
        if (ty === "JobPosting" || (Array.isArray(ty) && ty.indexOf("JobPosting") >= 0)) {
          d.t = (o.title || o.name || "").toString().trim();
          var hg = o.hiringOrganization;
          d.e = typeof hg === "string" ? hg : (hg && hg.name ? hg.name : "");
          if (hg && typeof hg === "object") {
            if (hg.logo && !d.lg) d.lg = typeof hg.logo === "string" ? hg.logo : (hg.logo.url || hg.logo.contentUrl || "");
            if (hg.url && !d.cu) d.cu = "" + hg.url;
            if (hg.sameAs && !d.cu) d.cu = "" + (Array.isArray(hg.sameAs) ? hg.sameAs[0] : hg.sameAs);
          }
          var L = o.jobLocation; if (Array.isArray(L)) L = L[0];
          if (L && L.address) d.l = L.address.addressLocality || L.address.addressRegion || "";
          if (o.jobLocationType && ("" + o.jobLocationType).toUpperCase().indexOf("TELE") >= 0) d.l = (d.l ? d.l + " - " : "") + "Télétravail";
          if (o.employmentType) d.c = "" + (Array.isArray(o.employmentType) ? o.employmentType[0] : o.employmentType);
          if (o.description) d.ds = strip(o.description).slice(0, LIM);
          if (o.datePosted) d.dt = ("" + o.datePosted).slice(0, 10);
          if (o.experienceRequirements) {
            var xr = o.experienceRequirements;
            d.x = typeof xr === "string" ? xr : (xr && xr.monthsOfExperience ? (Math.round(xr.monthsOfExperience / 12) + " an(s)") : "");
          }
          if (o.baseSalary) {
            var b = o.baseSalary, v = (b && b.value) ? b.value : b;
            var mn = v && v.minValue, mx = v && v.maxValue, va = v && v.value;
            var ut = ((v && v.unitText) || "").toUpperCase();
            var us = ut.indexOf("HOUR") >= 0 ? "/h" : ut.indexOf("MONTH") >= 0 ? "/mois" : ut.indexOf("YEAR") >= 0 ? "/an" : "";
            if (mn && mx) d.sal = mn + "-" + mx + us; else if (va) d.sal = "" + va + us;
          }
        }
        for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { var v = o[k]; if (v && typeof v === "object" && k !== "@graph") st.push(v); } }
      }
    }
  })();

  // ===== 2) microdata =====
  if (!d.t && document.querySelector("[itemtype$=JobPosting]")) {
    d.t = gx("title");
    if (!d.e) d.e = gx("hiringOrganization") || gx("name");
    if (!d.l) d.l = gx("addressLocality");
    if (!d.ds) d.ds = strip(gx("description")).slice(0, LIM);
    if (!d.dt) d.dt = gx("datePosted").slice(0, 10);
  }

  // ===== 3) sélecteurs par site (repli quand le JSON-LD est absent/incomplet) =====
  (function () {
    var HOST = location.hostname;
    if (HOST.indexOf("indeed") >= 0) {
      var it = Q(["h2[data-testid=jobsearch-JobInfoHeader-title]", "[data-testid=jobsearch-JobInfoHeader-title]",
        "[data-testid=jobsearch-JobInfoHeader-title] span", "[data-testid=simpler-jobTitle]", ".jobsearch-JobInfoHeader-title",
        "h1.jobsearch-JobInfoHeader-title", "[data-testid=jobsearch-ViewjobPaneWrapper] h1", "[data-testid=jobsearch-ViewjobPaneWrapper] h2",
        "[data-testid=viewJobTitle]"]);
      if (it && !/security check|v[eé]rification|just a moment|captcha|cloudflare/i.test(it)) d.t = it;
      var ie = Q(["[data-testid=inlineHeader-companyName] a", "[data-testid=inlineHeader-companyName]", "[data-company-name=true]",
        ".jobsearch-CompanyInfoContainer a", "[data-testid=jobsearch-CompanyInfoContainer] a"]);
      if (ie) d.e = ie;
      var il = Q(["[data-testid=inlineHeader-companyLocation] div", "[data-testid=inlineHeader-companyLocation]",
        "[data-testid=jobsearch-JobInfoHeader-companyLocation]", "[data-testid=job-location]"]);
      if (il) d.l = il;
      var idd = document.querySelector("#jobDescriptionText,.jobsearch-JobComponent-description");
      if (idd) { var idt = (idd.innerText || idd.textContent || "").replace(WS, " ").trim(); if (idt.length > d.ds.length) d.ds = idt.slice(0, LIM); }
      try { var ip = new URLSearchParams(location.search); var jk = ip.get("vjk") || ip.get("jk"); if (jk) FL = location.protocol + "//" + HOST + "/viewjob?jk=" + jk; } catch (e) {}
    } else if (HOST.indexOf("linkedin") >= 0) {
      var lt = Q([".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title",
        ".t-24.job-details-jobs-unified-top-card__job-title", ".topcard__title"]);
      if (lt) d.t = lt;
      var lc = Q([".job-details-jobs-unified-top-card__company-name a", ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name a", ".jobs-unified-top-card__company-name", ".topcard__org-name-link"]);
      if (lc) d.e = lc;
      var ll = Q([".job-details-jobs-unified-top-card__primary-description-container .tvm__text",
        ".job-details-jobs-unified-top-card__bullet", ".jobs-unified-top-card__bullet", ".topcard__flavor--bullet"]);
      if (ll) d.l = ll;
      var ldd = document.querySelector(".jobs-description__content,.jobs-box__html-content,.jobs-description-content__text,#job-details");
      if (ldd) { var ldt = (ldd.innerText || ldd.textContent || "").replace(WS, " ").trim(); if (ldt.length > d.ds.length) d.ds = ldt.slice(0, LIM); }
      try { var lp = new URLSearchParams(location.search); var cj = lp.get("currentJobId"); if (cj) FL = "https://www.linkedin.com/jobs/view/" + cj; } catch (e) {}
    } else if (HOST.indexOf("glassdoor") >= 0) {
      var gt = Q(["[data-test=job-title]", "[id^=jd-job-title]", "[class*=JobDetails_jobTitle]"]);
      if (gt) d.t = gt;
      var gc = Q(["[data-test=employerName]", "[class*=EmployerProfile_employerName]", "[data-test=detailsHeader] a"]);
      if (gc) d.e = gc;
      var gl = Q(["[data-test=location]", "[data-test=emp-location]", "[class*=JobDetails_location]"]);
      if (gl) d.l = gl;
      var gd = document.querySelector("[class*=JobDetails_jobDescription],#JobDescriptionContainer,[class*=jobDescriptionContent]");
      if (gd) { var gdt = (gd.innerText || gd.textContent || "").replace(WS, " ").trim(); if (gdt.length > d.ds.length) d.ds = gdt.slice(0, LIM); }
    } else if (HOST.indexOf("francetravail") >= 0 || HOST.indexOf("pole-emploi") >= 0) {
      var ftt = Q(["h1.t4", ".media-heading-title", "[class*=titre-offre]", "main h1"]);
      if (ftt && ftt.length < 140) d.t = ftt;
      var ftc = Q(["[class*=entreprise] a", "[class*=Entreprise]", ".coordonnees-entreprise", "[itemprop=hiringOrganization]"]);
      if (ftc) d.e = ftc;
      var ftl = Q(["[class*=localisation]", "[class*=lieu-travail]", "[itemprop=jobLocation]"]);
      if (ftl) d.l = ftl;
    }
  })();

  // ===== 4) blobs d'hydratation (état des frameworks) =====
  function isJob(o) {
    return o && typeof o === "object" && !Array.isArray(o) &&
      (o.jobInfoHeaderModel || (o.jobTitle && (o.companyName || o.company)) || (o.title && (o.hiringOrganization || o.company || o.employer || o.companyName)));
  }
  function pull(o) {
    if (o.jobInfoHeaderModel) {
      var h = o.jobInfoHeaderModel;
      return { t: h.jobTitle || "", e: h.companyName || "", l: h.formattedLocation || h.location || "", ds: o.sanitizedJobDescription || o.jobDescriptionText || o.jobDescription || "" };
    }
    var hg = o.hiringOrganization;
    var e = o.companyName || o.company || o.employer || (typeof hg === "string" ? hg : (hg && hg.name) || "");
    var l = o.formattedLocation || o.location || o.jobLocationCity || o.jobLocation || "";
    if (l && typeof l === "object") l = l.city || l.name || l.formattedLocation || l.addressLocality || (l.address && (l.address.addressLocality || l.address.addressRegion)) || "";
    return { t: o.jobTitle || o.title || "", e: e, l: l, ds: o.jobDescription || o.description || o.sanitizedJobDescription || "" };
  }
  function walkJob(root, cb) {
    var stk = [root], g = 0;
    while (stk.length && g < 6000) {
      g++;
      var o = stk.shift();
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o)) { for (var ai = 0; ai < o.length; ai++) stk.push(o[ai]); continue; }
      if (isJob(o) && cb(o)) return true;
      for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { var v = o[k]; if (v && typeof v === "object") stk.push(v); } }
    }
    return false;
  }
  // extrait des sous-chaînes JSON équilibrées en accolades (utile pour les flux RSC __next_f qui ne sont PAS du JSON pur)
  function extractBalancedObjects(text, maxCount, maxLen) {
    var out = [], n = text.length;
    for (var i = 0; i < n && out.length < maxCount; i++) {
      if (text.charCodeAt(i) !== 123) continue; // '{'
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

  if (!d.t || !d.e || !d.ds || d.ds.length < 200) {
    var blobs = [];
    try { if (window._initialData) blobs.push(window._initialData); } catch (e) {}
    try { if (window.mosaic && window.mosaic.providerData) blobs.push(window.mosaic.providerData); } catch (e) {}
    try { if (window.__INITIAL_STATE__) blobs.push(window.__INITIAL_STATE__); } catch (e) {}
    try { if (window.__NUXT__) blobs.push(window.__NUXT__); } catch (e) {}
    try { if (window.__APOLLO_STATE__) blobs.push(window.__APOLLO_STATE__); } catch (e) {}
    // Next.js Pages Router : JSON d'hydratation direct
    try {
      var nd = document.getElementById("__NEXT_DATA__");
      if (nd) blobs.push(JSON.parse(nd.textContent));
    } catch (e) {}
    // Next.js App Router : self.__next_f est le tableau-file (déjà décodé par le navigateur, contrairement
    // au texte source des <script> qui contient des guillemets échappés impossibles à re-parser fiablement).
    try {
      if (window.__next_f && Array.isArray(window.__next_f)) {
        var nfBuf = "";
        for (var nfi = 0; nfi < window.__next_f.length && nfBuf.length < 400000; nfi++) {
          var tup = window.__next_f[nfi];
          if (Array.isArray(tup) && typeof tup[1] === "string") nfBuf += tup[1];
        }
        if (nfBuf) {
          var cands = extractBalancedObjects(nfBuf, 60, 30000);
          for (var nc = 0; nc < cands.length; nc++) { try { blobs.push(JSON.parse(cands[nc])); } catch (e) {} }
        }
      }
    } catch (e) {}
    // scan générique des <script type=json> (hors ld+json, déjà traité)
    var asc = document.getElementsByTagName("script"), cnt = 0;
    for (var si = 0; si < asc.length && cnt < 14; si++) {
      var ty = (asc[si].type || "");
      if (ty.indexOf("json") < 0 || ty.indexOf("ld+json") >= 0) continue;
      var tc = asc[si].textContent || "";
      if (tc.length < 20 || tc.length > 3000000) continue;
      cnt++;
      try { blobs.push(JSON.parse(tc)); } catch (e) {}
    }
    var known = d.t ? d.t.toLowerCase().slice(0, 18) : "";
    for (var bi = 0; bi < blobs.length; bi++) {
      walkJob(blobs[bi], function (o) {
        var p = pull(o);
        if (!p.t || p.t.length > 160) return false;
        var pl = ("" + p.t).toLowerCase();
        if (known && pl.indexOf(known) < 0 && known.indexOf(pl.slice(0, 18)) < 0) return false;
        if (!d.t) d.t = p.t;
        if (!d.e && p.e) d.e = ("" + p.e).slice(0, 80);
        if (!d.l && p.l) d.l = ("" + p.l).slice(0, 80);
        if (p.ds && ("" + p.ds).length > d.ds.length) d.ds = strip("" + p.ds).slice(0, LIM);
        return true;
      });
      if (d.t && d.e && d.ds.length > 200) break;
    }
  }

  // ===== 5) repli titre =====
  if (!d.t) {
    var h1 = document.querySelector("h1");
    var ht = h1 ? clean(h1.innerText || h1.textContent || "", false) : "";
    if (ht.length > 120 || ht.length < 2) ht = "";
    d.t = ht || clean(meta("og:title"), true) || clean(meta("twitter:title"), true) || clean(document.title, true) || "";
  }

  // ===== 6) repli description =====
  if (d.ds.length < 300) {
    var sels = ["[class*=description i]", "[id*=description i]", "[class*=job-description i]", "[class*=offer-content i]", "[class*=jobdesc i]", "[class*=vacancy i]", "article"];
    var best = d.ds;
    for (var q = 0; q < sels.length; q++) {
      var el = document.querySelector(sels[q]);
      if (el) { var tx = (el.innerText || el.textContent || "").replace(WS, " ").trim(); if (tx.length > best.length && tx.length < 12000) best = tx; }
    }
    if (best.length > d.ds.length) d.ds = best.slice(0, LIM);
  }
  if (!d.ds) d.ds = (meta("og:description") || meta("twitter:description") || meta("description") || "").slice(0, LIM);

  // ===== 7) repli entreprise / lieu =====
  if (!d.e) { var ce = document.querySelector("[class*=company i],[class*=employer i],[class*=entreprise i],[data-testid*=company i]"); if (ce) d.e = (ce.innerText || ce.textContent || "").replace(WS, " ").trim().slice(0, 60); }
  if (!d.l) { var le = document.querySelector("[class*=location i],[class*=lieu i],[class*=ville i]"); if (le) d.l = (le.innerText || le.textContent || "").replace(WS, " ").trim().slice(0, 60); }

  // ===== 8) garde-fou captcha / vérification =====
  if (/security check|v[eé]rification de s|just a moment|verify you are human|captcha|cloudflare|attention required|acc[eè]s refus/i.test(d.t)) d.t = "";

  var JB = /indeed|linkedin|glassdoor|welcometothejungle|hellowork|apec|francetravail|pole-emploi|monster|jobteaser|meteojob|cadremploi|jobijoba|stepstone|talent[.]com/i;
  var ATSh = /workday|myworkdayjobs|greenhouse|lever[.]co|taleo|icims|smartrecruiters|teamtailor|brassring|successfactors|recruitee|workable|jobvite|ashbyhq|breezy/i;
  if (!d.lg && !JB.test(location.hostname)) d.lg = meta("og:image") || meta("twitter:image") || "";
  if (!d.cu && !JB.test(location.hostname) && !ATSh.test(location.hostname)) d.cu = location.protocol + "//" + location.hostname;

  // ===== 9) ATS publiques (Greenhouse / Lever / Ashby / SmartRecruiters / Recruitee) =====
  // Ces API sont conçues pour être appelées publiquement depuis le navigateur (widgets carrière officiels) :
  // aucune authentification, données structurées bien plus fiables que le scraping DOM sur ces plateformes.
  function detectAts() {
    var h = location.hostname, p = location.pathname, m;
    if (/(^|\.)greenhouse\.io$/.test(h)) {
      m = p.match(/\/([\w-]+)\/jobs\/(\d+)/);
      if (m) return { type: "greenhouse", board: m[1], id: m[2] };
    }
    if (/(^|\.)lever\.co$/.test(h)) {
      m = p.match(/\/([\w-]+)\/([0-9a-f-]{30,})/i);
      if (m) return { type: "lever", company: m[1], id: m[2] };
    }
    if (/(^|\.)ashbyhq\.com$/.test(h)) {
      m = p.match(/\/([\w-]+)\/([0-9a-f-]{30,})/i);
      if (m) return { type: "ashby", org: m[1], id: m[2] };
    }
    if (/smartrecruiters\.com$/.test(h)) {
      var segs = p.split("/").filter(Boolean);
      var idm = p.match(/(\d{6,})(?:[/?]|$)/);
      if (segs.length && idm) return { type: "smartrecruiters", company: segs[0], id: idm[1] };
    }
    m = h.match(/^([\w-]+)\.recruitee\.com$/);
    if (m) {
      var sm = p.match(/\/o\/([\w-]+)/);
      if (sm) return { type: "recruitee", company: m[1], slug: sm[1] };
    }
    return null;
  }
  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
      promise.then(
        function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
      );
    });
  }
  function empLabel(code) {
    var m = { fulltime_permanent: "CDI", parttime_permanent: "CDI temps partiel", fulltime_fixedterm: "CDD", parttime_fixedterm: "CDD temps partiel", internship: "Stage", apprenticeship: "Alternance" };
    return m[code] || (code ? ("" + code).replace(/_/g, " ") : "");
  }
  function fetchAtsData(info) {
    var req;
    if (info.type === "greenhouse") {
      req = fetch("https://boards-api.greenhouse.io/v1/boards/" + encodeURIComponent(info.board) + "/jobs/" + encodeURIComponent(info.id) + "?content=true")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) return null;
          var dept = (j.departments && j.departments[0] && j.departments[0].name) || "";
          return {
            t: j.title || "", e: j.company_name || info.board, l: (j.location && j.location.name) || "", c: "",
            ds: strip(j.content || ""), dt: (j.first_published || j.updated_at || "").slice(0, 10), x: "", sal: "", dept: dept
          };
        });
    } else if (info.type === "lever") {
      req = fetch("https://api.lever.co/v0/postings/" + encodeURIComponent(info.company) + "/" + encodeURIComponent(info.id) + "?mode=json")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.text) return null;
          var cat = j.categories || {};
          var loc = cat.location || (cat.allLocations && cat.allLocations[0]) || "";
          if (j.workplaceType && /remote/i.test(j.workplaceType)) loc = (loc ? loc + " - " : "") + "Télétravail";
          var extra = "";
          if (j.lists && j.lists.length) extra = "\n\n" + j.lists.map(function (sec) { return (sec.text ? sec.text + "\n" : "") + strip(sec.content || ""); }).join("\n\n");
          var sal = "";
          if (j.salaryRange && (j.salaryRange.min || j.salaryRange.max)) {
            var cur = j.salaryRange.currency === "USD" ? "$" : (j.salaryRange.currency === "EUR" ? "€" : (j.salaryRange.currency || ""));
            sal = (j.salaryRange.min && j.salaryRange.max) ? (j.salaryRange.min + "-" + j.salaryRange.max + cur) : ((j.salaryRange.min || j.salaryRange.max) + cur);
          }
          return {
            t: j.text || "", e: info.company, l: loc, c: cat.commitment || "",
            ds: strip(j.descriptionPlain || j.description || "") + extra,
            dt: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : "", x: "", sal: sal, dept: cat.team || cat.department || ""
          };
        });
    } else if (info.type === "ashby") {
      req = fetch("https://api.ashbyhq.com/posting-api/job-board/" + encodeURIComponent(info.org))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.jobs) return null;
          var job = null;
          for (var i = 0; i < j.jobs.length; i++) { if (j.jobs[i].id === info.id || (j.jobs[i].jobUrl || "").indexOf(info.id) >= 0) { job = j.jobs[i]; break; } }
          if (!job) return null;
          var loc = job.location || "";
          if (job.workplaceType && /remote/i.test(job.workplaceType)) loc = (loc ? loc + " - " : "") + "Télétravail";
          return {
            t: job.title || "", e: info.org, l: loc, c: job.employmentType || "",
            ds: strip(job.descriptionHtml || job.descriptionPlain || ""), dt: (job.publishedAt || "").slice(0, 10), x: "", sal: "", dept: job.department || job.team || ""
          };
        });
    } else if (info.type === "smartrecruiters") {
      req = fetch("https://api.smartrecruiters.com/v1/companies/" + encodeURIComponent(info.company) + "/postings/" + encodeURIComponent(info.id))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) return null;
          var loc = (j.location && (j.location.fullLocation || j.location.city)) || "";
          if (j.location && j.location.remote) loc = (loc ? loc + " - " : "") + "Télétravail";
          var secs = (j.jobAd && j.jobAd.sections) || {}, parts = [];
          ["jobDescription", "qualifications", "additionalInformation"].forEach(function (k) {
            if (secs[k] && secs[k].text) parts.push((secs[k].title ? secs[k].title + "\n" : "") + strip(secs[k].text));
          });
          return {
            t: j.name || "", e: (j.company && j.company.name) || info.company, l: loc,
            c: (j.typeOfEmployment && j.typeOfEmployment.label) || "", ds: parts.join("\n\n"),
            dt: (j.releasedDate || "").slice(0, 10), x: (j.experienceLevel && j.experienceLevel.label) || "", sal: "", dept: (j.department && j.department.label) || ""
          };
        });
    } else if (info.type === "recruitee") {
      req = fetch("https://" + info.company + ".recruitee.com/api/offers/" + encodeURIComponent(info.slug))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var o = j && j.offer; if (!o) return null;
          var loc = [o.city, o.location].filter(Boolean).join(", ") || o.location || "";
          if (o.remote) loc = (loc ? loc + " - " : "") + "Télétravail";
          var sal = "";
          if (o.salary && (o.salary.min || o.salary.max)) sal = (o.salary.min || "") + (o.salary.max ? "-" + o.salary.max : "");
          return {
            t: o.title || "", e: o.company_name || info.company, l: loc, c: empLabel(o.employment_type_code),
            ds: strip(o.description || ""), dt: (o.created_at || "").slice(0, 10), x: "", sal: sal, dept: o.department || ""
          };
        });
    } else return Promise.resolve(null);
    return withTimeout(req["catch"](function () { return null; }), 4500);
  }
  function mergeAts(atsData) {
    if (!atsData) return;
    if (atsData.t) d.t = atsData.t;
    if (atsData.e) d.e = atsData.e;
    if (atsData.l) d.l = atsData.l;
    if (atsData.c) d.c = atsData.c;
    if (atsData.ds && atsData.ds.length > d.ds.length) d.ds = atsData.ds.slice(0, LIM);
    if (atsData.dt) d.dt = atsData.dt;
    if (atsData.x) d.x = atsData.x;
    if (atsData.sal) d.sal = atsData.sal;
    if (atsData.dept) d.ds = (d.ds ? d.ds + "\n\n" : "") + "Équipe : " + atsData.dept;
  }

  function buildUrl() {
    return APP + "/?addUrl=" + encodeURIComponent(FL || location.href) +
      "&addTitle=" + encodeURIComponent(d.t) + "&addEnt=" + encodeURIComponent(d.e) + "&addLieu=" + encodeURIComponent(d.l) +
      "&addCt=" + encodeURIComponent(d.c) + "&addDesc=" + encodeURIComponent(d.ds) + "&addDate=" + encodeURIComponent(d.dt) +
      "&addXp=" + encodeURIComponent(d.x) + "&addSal=" + encodeURIComponent(d.sal) + "&addLogo=" + encodeURIComponent(d.lg) +
      "&addCompUrl=" + encodeURIComponent(d.cu) + "&capture=1";
  }
  function openPopup(url, w) {
    try { window.addEventListener("message", function (ev) { if (ev && ev.data === "st-close" && w) { try { w.close(); } catch (e) {} } }); } catch (e) {}
    var win = w;
    if (!win) {
      win = window.open(url, "samtravail_capture", "width=500,height=680,scrollbars=yes");
      if (win) win.focus(); else window.open(url, "_blank");
    } else {
      try { win.location.href = url; win.focus(); } catch (e) { window.open(url, "_blank"); }
    }
    return win;
  }

  var ats = (typeof fetch === "function" && typeof Promise === "function") ? detectAts() : null;
  if (ats) {
    // Le popup s'ouvre TOUT DE SUITE (dans le geste de clic, sinon le navigateur le bloque) ;
    // on le navigue ensuite vers l'URL finale une fois l'API ATS interrogée (best-effort, 4.5s max).
    var w = openPopup(APP + "/?capture=1&bmwait=1");
    fetchAtsData(ats).then(function (atsData) {
      mergeAts(atsData);
      openPopup(buildUrl(), w);
    });
  } else {
    openPopup(buildUrl());
  }
})();
