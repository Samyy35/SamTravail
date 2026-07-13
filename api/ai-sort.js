// =============================================================
//  Sam'Travail — /api/ai-sort   (version avec MODE TEST)
//  Repli "mini-IA" : nettoie une offre d'emploi (texte brut -> JSON propre)
//  via une IA GRATUITE compatible OpenAI (Gemini, Groq, Mistral...).
//
//  >>> À placer dans ton dépôt à :  api/ai-sort.js  <<<
//
//  ---------------------------------------------------------------
//  COMMENT TESTER (voir si la facturation/clé bloque) :
//  Ouvre dans ton navigateur :   https://TON-APP.vercel.app/api/ai-sort
//  -> il fait un mini-appel à l'IA et t'affiche en clair le résultat :
//     • "ok": true   => tout marche, la facturation ne bloque pas.
//     • message "facturation/billing" => active le billing (cas UE)
//       OU bascule sur Groq.
//     • "cle invalide" => revérifie AI_KEY.
//     • "quota" => ça marche, mais limite gratuite atteinte.
//  ---------------------------------------------------------------
//
//  Variables d'environnement Vercel (Settings > Environment Variables) :
//    AI_KEY       = ta cle API gratuite           (OBLIGATOIRE)
//    AI_BASE_URL  = endpoint compatible OpenAI
//    AI_MODEL     = nom du modele
//
//   • Google Gemini :
//       AI_BASE_URL = https://generativelanguage.googleapis.com/v1beta/openai
//       AI_MODEL    = gemini-2.5-flash
//   • Groq (sans carte, simple en UE) :
//       AI_BASE_URL = https://api.groq.com/openai/v1
//       AI_MODEL    = llama-3.3-70b-versatile
//   • Mistral :
//       AI_BASE_URL = https://api.mistral.ai/v1
//       AI_MODEL    = mistral-small-latest
//
//  IMPORTANT : apres avoir ajoute/modifie les variables, REDEPLOIE
//  (Vercel ne les prend pas en compte tant que tu n'as pas redeploye).
// =============================================================

// Regles de style communes a toutes les redactions IA (relance, accroche, etc.) — version compacte (moins de tokens en entree).
const STYLE_RULES =
  "STYLE (doit sembler ecrit par le candidat, pas par une IA) : phrases simples et directes, ton sobre. " +
  "INTERDIT : 'dynamique', 'passionne par', 'relever des defis', 'fort de', 'dote de', 'mettre a profit', " +
  "'au sein de votre structure', 'n'hesitez pas', superlatifs, listes de qualites, formules de motivation generiques, " +
  "tirets longs, puces, emojis. N'invente AUCUN fait : utilise uniquement les infos fournies.\n";

function diagnose(status, errMsg) {
  const m = ("" + (errMsg || "")).toLowerCase();
  if (status === 0) return "Erreur reseau : l'endpoint n'a pas pu etre joint.";
  if (m.includes("billing") || m.includes("facturation") || status === 402 ||
      m.includes("failed_precondition") || m.includes("free tier is not available") ||
      m.includes("free quota tier is not available")) {
    return "FACTURATION requise (cas frequent dans l'UE). Active le billing sur le projet Google Cloud lie a la cle, OU bascule sur Groq (pas de carte).";
  }
  if (m.includes("api key not valid") || m.includes("api_key_invalid") ||
      m.includes("invalid api key") || m.includes("permission_denied") || status === 401) {
    return "CLE invalide ou mal restreinte. Reverifie AI_KEY (Gemini commence par 'AIza') et que la cle est bien restreinte a l'API Gemini dans AI Studio.";
  }
  if (status === 429 || m.includes("resource_exhausted") || m.includes("quota") || m.includes("rate limit")) {
    return "Ca MARCHE, mais quota gratuit atteint pour l'instant. Reessaie dans 1 minute.";
  }
  if (status === 404 || (m.includes("model") && m.includes("not found"))) {
    return "Modele ou endpoint introuvable : verifie AI_MODEL et AI_BASE_URL.";
  }
  return "Reponse inattendue du fournisseur (voir 'detail').";
}

async function callAI(base, key, model, messages, maxTokens, opts) {
  opts = opts || {};
  const payload = {
    model: model,
    temperature: (opts.temperature != null ? opts.temperature : 0),
    max_tokens: maxTokens,
    messages: messages,
  };
  if (opts.json !== false) payload.response_format = { type: "json_object" };
  // Gemini 2.5 est un modele "reflechissant" : sa reflexion consomme le max_tokens
  // et peut tronquer la reponse. On la desactive pour ces taches simples.
  if (base.indexOf("generativelanguage") >= 0) payload.reasoning_effort = "none";
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(payload),
  });
  const raw = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) {}
  // Consommation de tokens (jauge) : l'objet usage renvoye par l'API + les en-tetes de quota restant de Groq
  // (x-ratelimit-remaining-* = valeur AUTORITATIVE, pas une estimation).
  const u = parsed && parsed.usage;
  const usage = u ? {
    prompt: u.prompt_tokens || 0,
    completion: u.completion_tokens || 0,
    total: u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0)),
  } : null;
  const num = (h) => { const v = r.headers.get(h); const n = v == null ? NaN : parseFloat(v); return isNaN(n) ? null : n; };
  const rl = {
    remTokens: num("x-ratelimit-remaining-tokens"), remRequests: num("x-ratelimit-remaining-requests"),
    limTokens: num("x-ratelimit-limit-tokens"), limRequests: num("x-ratelimit-limit-requests"),
  };
  return { status: r.status, ok: r.ok, raw: raw, parsed: parsed, usage: usage, rl: rl };
}
// Fusionne les infos de consommation dans la reponse JSON (jauge cote client), sans casser la forme existante.
function withUsage(obj, out) {
  if (out) { if (out.usage) obj.usage = out.usage; if (out.rl) obj.rl = out.rl; }
  return obj;
}

// Extraction ROBUSTE d'une liste d'entreprises depuis la reponse IA
// (tolere les ```fences```, la prose autour, et un JSON TRONQUE par max_tokens).
function parseCompanies(content) {
  let s = ("" + (content || "")).replace(/```json|```/gi, "").trim();
  const i = s.indexOf("{"); if (i > 0) s = s.slice(i);
  const safe = (x) => { try { return JSON.parse(x); } catch (e) { return null; } };
  // 1) parse direct
  let d = safe(s);
  if (d && Array.isArray(d.companies)) return d.companies;
  // 2) reparation d'un tableau tronque : on coupe au dernier "}" complet puis on referme
  const a = s.indexOf("[");
  if (a >= 0) {
    const frag = s.slice(a);
    const last = frag.lastIndexOf("}");
    if (last > 0) {
      d = safe('{"companies":' + frag.slice(0, last + 1) + "]}");
      if (d && Array.isArray(d.companies)) return d.companies;
    }
  }
  // 3) dernier recours : on recupere chaque objet contenant "nom"
  const out = []; const re = /\{[^{}]*?"nom"\s*:\s*"[^"]+"[^{}]*?\}/g; let m;
  while ((m = re.exec(s))) { const o = safe(m[0]); if (o && o.nom) out.push(o); }
  return out;
}

// Meme robustesse que parseCompanies, pour la liste {titres:[{intitule,pourquoi}]} du mode "titles".
function parseTitles(content) {
  let s = ("" + (content || "")).replace(/```json|```/gi, "").trim();
  const i = s.indexOf("{"); if (i > 0) s = s.slice(i);
  const safe = (x) => { try { return JSON.parse(x); } catch (e) { return null; } };
  let d = safe(s);
  if (d && Array.isArray(d.titres)) return d.titres;
  const a = s.indexOf("[");
  if (a >= 0) {
    const frag = s.slice(a);
    const last = frag.lastIndexOf("}");
    if (last > 0) {
      d = safe('{"titres":' + frag.slice(0, last + 1) + "]}");
      if (d && Array.isArray(d.titres)) return d.titres;
    }
  }
  const out = []; const re = /\{[^{}]*?"intitule"\s*:\s*"[^"]+"[^{}]*?\}/g; let m;
  while ((m = re.exec(s))) { const o = safe(m[0]); if (o && o.intitule) out.push(o); }
  return out;
}

// Verification d'identite SANS aucune dependance npm (pas de package.json dans ce repo) : un simple
// fetch vers l'endpoint Auth de Supabase. SUPABASE_URL/ANON_KEY sont les memes valeurs PUBLIQUES que
// celles deja visibles dans index.html (l'anon key est concue pour etre publique) — rien de secret ici.
const SUPABASE_URL = "https://vjvidltlrqxssigxboqy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yMT8GmHQ_ooUC1wxHtv-dQ_TMjEz3JL";
function bearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
}
async function verifyUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (e) { return null; }
}

// BYOK : lit la cle Groq PERSONNELLE de l'utilisateur dans sa ligne parametres (cle="groqKey"), via SON JWT.
// La RLS (Pilier 2) garantit qu'un utilisateur ne peut lire QUE sa propre cle — jamais celle d'un autre.
// La cle n'est jamais renvoyee au client : le serveur la lit ici et l'utilise directement pour appeler Groq.
async function getUserAiKey(token) {
  if (!token) return "";
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/parametres?cle=eq.groqKey&select=valeur", {
      headers: { Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return "";
    const rows = await r.json();
    const v = rows && rows[0] && rows[0].valeur;
    const k = v && (typeof v === "string" ? v : v.key);
    return k ? ("" + k).trim() : "";
  } catch (e) { return ""; }
}

module.exports = async function handler(req, res) {
  let key = process.env.AI_KEY;   // cle de BASE (fallback) ; ecrasee par la cle perso de l'utilisateur si presente (POST)
  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL || "llama-3.3-70b-versatile";

  // ---------- MODE TEST (visite l'URL dans le navigateur) ----------
  if (req.method === "GET") {
    if (!key) {
      res.status(200).json({
        selftest: true, ok: false,
        message: "AI_KEY absente. La variable n'est pas definie dans Vercel, ou tu n'as pas redeploye apres l'avoir ajoutee.",
      });
      return;
    }
    try {
      const out = await callAI(base, key, model,
        [{ role: "user", content: 'Reponds en JSON: {"ping":"ok"}' }], 60);
      const errMsg = (out.parsed && out.parsed.error &&
        (out.parsed.error.message || out.parsed.error.status || out.parsed.error.code)) || "";
      res.status(200).json({
        selftest: true,
        ok: out.ok,
        httpStatus: out.status,
        provider: base,
        model: model,
        message: out.ok
          ? "OK — tout fonctionne, la facturation ne bloque pas. Le tri par IA est actif."
          : diagnose(out.status, errMsg || out.raw),
        detail: out.ok ? undefined : ("" + (errMsg || out.raw)).slice(0, 400),
      });
    } catch (e) {
      res.status(200).json({ selftest: true, ok: false, message: diagnose(0, ""), detail: ("" + e.message).slice(0, 200) });
    }
    return;
  }

  // ---------- MODE NORMAL (appele par l'app) ----------
  if (req.method !== "POST") { res.status(405).json({ ok: false, reason: "method" }); return; }
  // Empeche un curl/script direct (hors navigateur, donc CORS n'aide pas) de consommer le quota IA :
  // le mode GET selftest ci-dessus reste ouvert (diagnostic manuel via l'URL dans un navigateur).
  const token = bearerToken(req);
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ ok: false, reason: "unauthorized" }); return; }
  // BYOK : si l'utilisateur a renseigne SA cle Groq, on l'utilise IMPERATIVEMENT ; sinon la cle de base.
  const userKey = await getUserAiKey(token);
  if (userKey) key = userKey;
  if (!key) { res.status(200).json({ ok: false, reason: "no_key" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const text = ("" + (body.text || "")).slice(0, 6000);
  const url = "" + (body.url || "");
  const mode = "" + (body.mode || "offer");
  // le mode "draft" travaille à partir de "context", "format" de "description", "sourcing" de secteur/ville/poste,
  // "titles" de "titres" (pas de "text" pour aucun de ces 4 modes)
  if (mode !== "draft" && mode !== "format" && mode !== "sourcing" && mode !== "titles" && !text.trim()) { res.status(200).json({ ok: false, reason: "no_text" }); return; }

  const clean = (v) => ("" + (v == null ? "" : v)).replace(/\s+/g, " ").trim().slice(0, 200);

  // ----- MODE FORMAT : restructure une description d'offre en texte lisible (sections + puces) -----
  if (mode === "format") {
    const desc = ("" + (body.description || text || "")).slice(0, 6000);
    if (!desc.trim()) { res.status(200).json({ ok: false, reason: "no_text" }); return; }
    const sysF =
      "Reformate la DESCRIPTION d'une offre d'emploi (texte brut mal structure) en texte clair et aere, en francais. " +
      "Regroupe en sections pertinentes (titre seul sur sa ligne suivi de ':', ex: 'Missions :', 'Profil recherche :', 'Avantages :'). " +
      "Puces en '- ' pour les listes. N'INVENTE ni ne SUPPRIME aucune info (garde chiffres, lieux, technos, contrat, salaire) : tu REORGANISES seulement. " +
      "Pas de markdown ni de gras, aucune phrase d'intro (ne commence pas par 'Voici'). Reponds UNIQUEMENT par le texte reformate.";
    try {
      const out = await callAI(base, key, model,
        [{ role: "system", content: sysF },
         { role: "user", content: "DESCRIPTION A REFORMATER :\n" + desc }],
        1800, { json: false, temperature: 0.2 });
      if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
      let txt = (out.parsed && out.parsed.choices && out.parsed.choices[0] &&
        out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
      txt = ("" + txt).replace(/```/g, "").trim();
      res.status(200).json(withUsage({ ok: !!txt, text: txt.slice(0, 4000) }, out));
    } catch (e) {
      res.status(200).json({ ok: false, reason: "ai_error" });
    }
    return;
  }

  // ----- MODE MARQUE : identifier une entreprise -----
  if (mode === "brand") {
    const SECTORS = "Automobile / Mobilité, Aéronautique / Spatial, Pharma / Santé, " +
      "Nautisme / Naval, Luxe / Cosmétique, Agroalimentaire, Énergie, Défense, " +
      "Transport / Logistique, Conseil / Tech, Industrie";
    const sysB =
      "Tu identifies une ENTREPRISE a partir d'un texte (nom, site, description). " +
      "Reponds UNIQUEMENT par un objet JSON valide avec ces cles (chaine vide si absent) : " +
      '{"entreprise":"","secteur":"","ville":"","description":""}. ' +
      "'entreprise' = le nom courant de la marque (ex: 'BMW Group', pas la raison sociale complete). " +
      "'secteur' DOIT etre EXACTEMENT l'un de : " + SECTORS + " — ou \"\" si aucun ne correspond. " +
      "'ville' = ville du siege social si tu la connais, sinon \"\". " +
      "'description' = une phrase courte (max 180 caracteres) de ce que fait l'entreprise.";
    try {
      const out = await callAI(base, key, model,
        [{ role: "system", content: sysB },
         { role: "user", content: "SITE: " + url + "\n\nTEXTE :\n" + text }], 800);
      if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
      let c = (out.parsed && out.parsed.choices && out.parsed.choices[0] &&
        out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
      c = ("" + c).replace(/```json|```/g, "").trim();
      let d = {};
      try { d = JSON.parse(c); } catch (e) {}
      res.status(200).json(withUsage({
        ok: true,
        brand: {
          entreprise: clean(d.entreprise),
          secteur: clean(d.secteur),
          ville: clean(d.ville),
          description: clean(d.description),
        },
      }, out));
    } catch (e) {
      res.status(200).json({ ok: false, reason: "ai_error" });
    }
    return;
  }

  // ----- MODE SOURCING : liste d'entreprises pertinentes (découverte), token-efficient + anti-doublons -----
  if (mode === "sourcing") {
    const secteur = clean(body.secteur), ville = clean(body.ville), poste = clean(body.poste);
    const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, 60).map(x => ("" + x).slice(0, 40)).filter(Boolean).join(", ") : "";
    const sysS =
      "Tu es un expert du sourcing d'entreprises pour la recherche d'emploi (France/Europe). " +
      'Reponds UNIQUEMENT par un objet JSON valide et COMPACT, sans aucun texte autour : {"companies":[{"nom":"","ville":"","site":"","contexte":""}]}. ' +
      "Propose EXACTEMENT 12 entreprises PERTINENTES et VARIEES (PME, ETI, scale-ups, filiales en croissance ou qui recrutent), PAS seulement les grands groupes connus. " +
      "'site' = domaine officiel probable (ex: entreprise.com), jamais d'URL inventee farfelue. " +
      "'contexte' = UNE phrase courte (12 mots max : activite + pourquoi pertinent). N'invente aucun fait.";
    const usrS = "Secteur: " + secteur + "\nVille/region: " + ville + "\nType de poste: " + poste +
      (exclude ? ("\n\nNe propose AUCUNE de ces entreprises deja proposees: " + exclude) : "");
    try {
      const out = await callAI(base, key, model,
        [{ role: "system", content: sysS }, { role: "user", content: usrS }], 2400);
      if (!out.ok) {
        res.status(200).json({ ok: false, reason: "ai_error", status: out.status,
          detail: diagnose(out.status, (out.parsed && out.parsed.error && out.parsed.error.message) || out.raw) });
        return;
      }
      const content = (out.parsed && out.parsed.choices && out.parsed.choices[0] && out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
      const list = parseCompanies(content).map(x => ({
        nom: clean(x && x.nom), ville: clean(x && x.ville), site: clean(x && x.site),
        contexte: ("" + ((x && x.contexte) || "")).replace(/\s+/g, " ").trim().slice(0, 180),
      })).filter(x => x.nom).slice(0, 20);
      if (!list.length) { res.status(200).json({ ok: false, reason: "empty", got: ("" + content).slice(0, 140) }); return; }
      res.status(200).json(withUsage({ ok: true, companies: list }, out));
    } catch (e) { res.status(200).json({ ok: false, reason: "ai_error", detail: ("" + (e && e.message || e)).slice(0, 140) }); }
    return;
  }

  // ----- MODE TITLES : suggere des intitules de poste adjacents a partir des candidatures deja envoyees -----
  if (mode === "titles") {
    const titres = Array.isArray(body.titres) ? body.titres.slice(0, 40).map(x => clean(x)).filter(Boolean) : [];
    if (!titres.length) { res.status(200).json({ ok: false, reason: "no_text" }); return; }
    const secteurs = Array.isArray(body.secteurs) ? body.secteurs.slice(0, 10).map(x => clean(x)).filter(Boolean) : [];
    const sysT =
      "Tu es un expert du marche de l'emploi francais. A partir d'intitules de postes deja postules par un " +
      "candidat, tu suggeres des intitules ADJACENTS a chercher en plus (memes competences transferables, " +
      "secteurs proches), sans denaturer son projet professionnel. " +
      'Reponds UNIQUEMENT par un objet JSON valide et COMPACT : {"titres":[{"intitule":"","pourquoi":""}]}. ' +
      "Propose EXACTEMENT 6 suggestions, jamais un intitule deja fourni. 'pourquoi' = une phrase courte (10 mots max). N'invente aucun fait.";
    const usrT = "Intitules deja postules: " + titres.join(", ") +
      (secteurs.length ? ("\nSecteurs concernes: " + secteurs.join(", ")) : "");
    try {
      const out = await callAI(base, key, model,
        [{ role: "system", content: sysT }, { role: "user", content: usrT }], 900);
      if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
      const content = (out.parsed && out.parsed.choices && out.parsed.choices[0] && out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
      const list = parseTitles(content).map(x => ({
        intitule: clean(x && x.intitule),
        pourquoi: ("" + ((x && x.pourquoi) || "")).replace(/\s+/g, " ").trim().slice(0, 120),
      })).filter(x => x.intitule).slice(0, 8);
      if (!list.length) { res.status(200).json({ ok: false, reason: "empty", got: ("" + content).slice(0, 140) }); return; }
      res.status(200).json(withUsage({ ok: true, titres: list }, out));
    } catch (e) { res.status(200).json({ ok: false, reason: "ai_error", detail: ("" + (e && e.message || e)).slice(0, 140) }); }
    return;
  }

  // ----- MODE ARBRE : génère les options du quiz de compatibilité (industrie -> type de poste -> fiche de poste) -----
  // Chaque niveau est généré à partir du choix du niveau précédent, pour un arbre de décision personnalisé.
  if (mode === "tree") {
    const level = "" + (body.level || "industrie");           // industrie | type | fiche
    const parents = Array.isArray(body.parents) ? body.parents.slice(0, 8).map(x => clean(x)).filter(Boolean) : [];
    const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, 40).map(x => clean(x)).filter(Boolean) : [];
    // Prompt volontairement court (moins de tokens en entree = latence de prefill plus faible) + max_tokens serre
    // (6 options compactes tiennent largement sous 380 tokens en sortie) : la vitesse perçue du quiz depend
    // directement de ces deux leviers, le frontend affichant deja un repli instantane pendant l'appel.
    let sysT, usrT;
    const common =
      'JSON UNIQUEMENT, compact, sans texte autour : {"options":[{"label":"","kw":["",""]}]}. ' +
      "6 options courtes, concretes, distinctes. label = 2 a 5 mots. kw = 3 a 5 mots-cles FR minuscules " +
      "(termes d'annonce d'emploi). Aucun label deja dans 'exclure'.";
    if (level === "industrie") {
      sysT = "Liste d'INDUSTRIES/SECTEURS d'activite pour une recherche d'emploi (France/Europe), du plus courant au plus specialise. " + common;
      usrT = "Niveau: industries." + (exclude.length ? ("\nExclure: " + exclude.join(", ")) : "");
    } else if (level === "type") {
      sysT = "Pour la/les INDUSTRIE(S) donnee(s), des TYPES DE POSTE (familles de metiers) reellement specifiques a ce secteur " +
        "(ex: Finance -> M&A, Private Equity, Controle de gestion ; Industrie -> Supply chain, Methodes, Qualite). " + common;
      usrT = "Industrie(s): " + (parents.join(", ") || "(non precise)") +
        (exclude.length ? ("\nExclure: " + exclude.join(", ")) : "");
    } else {
      sysT = "Pour le TYPE DE POSTE donne, des FICHES DE POSTE precises (intitules concrets d'annonces), avec des niveaux " +
        "de seniorite pertinents (stage/alternance, junior, confirme, manager). " + common;
      usrT = "Industrie/type: " + (parents.join(" > ") || "(non precise)") +
        (exclude.length ? ("\nExclure: " + exclude.join(", ")) : "");
    }
    try {
      const out = await callAI(base, key, model,
        [{ role: "system", content: sysT }, { role: "user", content: usrT }], 380);
      if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
      const content = (out.parsed && out.parsed.choices && out.parsed.choices[0] &&
        out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
      let parsed = {};
      try { parsed = JSON.parse(("" + content).replace(/```json|```/g, "").trim()); } catch (e) {
        const m = ("" + content).match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
      }
      const seen = new Set(exclude.map(x => x.toLowerCase()));
      const list = (Array.isArray(parsed.options) ? parsed.options : []).map(o => ({
        label: clean(o && o.label),
        kw: (Array.isArray(o && o.kw) ? o.kw : []).map(k => ("" + k).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 6),
      })).filter(o => o.label && !seen.has(o.label.toLowerCase()) && (seen.add(o.label.toLowerCase()) || true)).slice(0, 8);
      if (!list.length) { res.status(200).json({ ok: false, reason: "empty", got: ("" + content).slice(0, 140) }); return; }
      res.status(200).json(withUsage({ ok: true, options: list }, out));
    } catch (e) { res.status(200).json({ ok: false, reason: "ai_error", detail: ("" + (e && e.message || e)).slice(0, 140) }); }
    return;
  }

  // ----- MODE BROUILLON : rédige un court message (relance, etc.) -----
  if (mode === "draft") {
    const kind = "" + (body.kind || "relance");
    const ctx = body.context || {};
    let sysD, usr;
    if (kind === "relance") {
      sysD = "Tu rediges un court message de RELANCE de candidature en francais (5 a 7 phrases " +
        "maximum, objet inclus). Va a l'essentiel : rappeler la candidature (poste + date), " +
        "redire l'interet pour le poste avec des mots simples, rester disponible. " +
        "Cite le nom de l'entreprise et l'intitule du poste. Si un profil/CV est fourni, integre " +
        "UNE reference concrete et naturelle (une competence ou une experience reelle), sans tout recopier. " +
        "Termine par une formule de politesse courte et signe avec le prenom fourni.\n" +
        STYLE_RULES +
        "Format : commence par 'Objet : ...' puis le message. Reponds UNIQUEMENT par le texte, sans commentaire ni JSON.";
      usr = "Entreprise: " + (ctx.entreprise || "") + "\nPoste: " + (ctx.poste || "") +
        "\nCandidature envoyee il y a: " + (ctx.jours || "?") + " jours\nPrenom (signature): " + (ctx.prenom || "") +
        (ctx.intro ? ("\n\nProfil du candidat: " + ("" + ctx.intro).slice(0, 600)) : "") +
        (ctx.cv ? ("\n\nCV (extrait): " + ("" + ctx.cv).slice(0, 1500)) : "");
    } else if (kind === "spontanee") {
      sysD = "Tu rediges un EMAIL de CANDIDATURE SPONTANEE en francais (8 a 12 phrases maximum, " +
        "objet inclus). Le candidat n'a pas d'offre precise : il propose son profil a une entreprise " +
        "qu'il a choisie.\n" +
        "Structure : 'Objet : Candidature spontanee – ...' puis 'Bonjour,' puis le message.\n" +
        "Contenu obligatoire :\n" +
        "1. Pourquoi CETTE entreprise precisement — cite son nom ; si des raisons personnelles du " +
        "candidat sont fournies (champ POURQUOI), appuie-toi dessus en les reformulant sobrement, " +
        "c'est ce qui rend le mail credible. Sinon utilise le secteur/l'activite.\n" +
        "2. Qui est le candidat et ce qu'il vise, a partir de son profil/CV : UNE ou DEUX references " +
        "concretes maximum (formation, experience, competence), pas un recital.\n" +
        "3. Le type de poste recherche, et une invitation simple a echanger si un besoin existe ou se profile.\n" +
        "Termine par une formule de politesse courte et signe avec le prenom fourni.\n" +
        STYLE_RULES +
        "Reponds UNIQUEMENT par le texte du mail, sans commentaire ni JSON.";
      usr = "Entreprise: " + (ctx.entreprise || "") +
        (ctx.secteur ? ("\nSecteur: " + ctx.secteur) : "") +
        (ctx.ville ? ("\nVille: " + ctx.ville) : "") +
        (ctx.pourquoi ? ("\n\nPOURQUOI cette entreprise (notes personnelles du candidat, a reformuler sobrement):\n" + ("" + ctx.pourquoi).slice(0, 600)) : "") +
        "\n\nPrenom: " + (ctx.prenom || "") +
        (ctx.intro ? ("\n\nPROFIL du candidat:\n" + ("" + ctx.intro).slice(0, 700)) : "") +
        (ctx.cv ? ("\n\nCV (extrait): " + ("" + ctx.cv).slice(0, 1800)) : "");
    } else if (kind === "accroche") {
      sysD = "Tu adaptes l'ACCROCHE ORIGINALE du candidat pour cibler une offre precise. Objectif : on doit croire que c'est LUI qui l'a ecrite, et qu'elle est taillee sur mesure pour CETTE offre.\n" +
        "Regles : garde une longueur proche de l'original (a une ou deux phrases pres), la premiere personne, et des tournures qui restent credibles venant du candidat.\n" +
        "Adapte EN PROFONDEUR, pas en surface : cite le NOM de l'entreprise et l'INTITULE du poste ; parmi les competences/experiences REELLES du candidat (jamais d'invention), choisis et mets en avant celles qui repondent le mieux a CETTE offre ; " +
        "ajuste le registre et le vocabulaire a la culture probable du secteur/de l'entreprise (ex: registre factuel et chiffre pour la finance/le M&A, plus direct et energique pour une startup, plus institutionnel pour un grand groupe ou le secteur public) ; evoque le secteur d'activite si pertinent.\n" +
        "Pas de 'Madame, Monsieur', pas de signature, pas de commentaire.\n" + STYLE_RULES +
        "SORTIE : une seule version, prete a l'emploi, sans titre, sans etiquette, sans guillemets. Si aucune accroche fournie : redige 4-6 phrases sobres depuis le CV, en respectant les memes regles d'adaptation.\n" +
        (ctx.profilCible ? "Un 'PROFIL CIBLE DECLARE' peut etre fourni : c'est un INDICE d'appoint, utile seulement quand l'annonce ci-dessous est courte/vague. Il ne doit JAMAIS contredire ni dominer le contenu reel de l'annonce - l'annonce prime toujours." : "");
      usr = "Poste: " + (ctx.poste || "") + "\nEntreprise: " + (ctx.entreprise || "") +
        "\nLieu: " + (ctx.lieu || "") +
        (ctx.offre ? ("\n\nDetails de l'offre: " + ("" + ctx.offre).slice(0, 1500)) : "") +
        (ctx.profilCible ? ("\n\nProfil cible declare par le candidat (indice d'appoint si l'annonce est peu detaillee): " + ("" + ctx.profilCible).slice(0, 200)) : "") +
        (ctx.intro ? ("\n\nACCROCHE ORIGINALE A ADAPTER (garde sa longueur, son style et ses tournures):\n" + ("" + ctx.intro).slice(0, 800)) : "") +
        (ctx.cv ? ("\n\nCV (extrait, pour le contexte uniquement): " + ("" + ctx.cv).slice(0, 1800)) : "");
    } else {
      sysD = "Tu rediges un court texte professionnel en francais, clair et concis.\n" + STYLE_RULES + "Reponds uniquement par le texte.";
      usr = JSON.stringify(ctx);
    }
    // Prompt système personnalisé (édité par l'utilisateur dans les Réglages) prioritaire s'il est fourni
    const customSys = ("" + (body.systemPrompt || "")).trim();
    if (customSys) sysD = customSys.slice(0, 4000);
    // Langue de sortie (accroche multilingue) : anglais si demandé, sinon français par défaut
    const lang = ("" + (body.lang || "fr")).toLowerCase();
    if (lang === "en") sysD += "\n\nIMPORTANT: Write the ENTIRE response in natural, professional ENGLISH (not French). Keep the same rules and structure.";
    try {
      const out = await callAI(base, key, model,
        [{ role: "system", content: sysD }, { role: "user", content: usr }],
        1500, { json: false, temperature: 0.4 });
      if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
      let txt = (out.parsed && out.parsed.choices && out.parsed.choices[0] &&
        out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
      txt = ("" + txt).trim();
      res.status(200).json(withUsage({ ok: !!txt, text: txt.slice(0, 1800) }, out));
    } catch (e) {
      res.status(200).json({ ok: false, reason: "ai_error" });
    }
    return;
  }

  // ----- MODE PROFIL : pre-remplir le profil depuis le texte du CV -----
  if (mode === "profil") {
    const sysP =
      "On te donne le TEXTE BRUT du CV d'un candidat. Reponds UNIQUEMENT par un objet JSON valide : " +
      '{"prenom":"","intro":""}. ' +
      "'prenom' = le prenom du candidat tel qu'il apparait dans le CV (chaine vide si introuvable). " +
      "'intro' = une accroche de profil de 3 a 4 phrases, a la premiere personne, basee UNIQUEMENT " +
      "sur les faits du CV (formation, experiences, competences), qui dit qui il est et ce qu'il vise.\n" +
      STYLE_RULES;
    try {
      const out = await callAI(base, key, model,
        [{ role: "system", content: sysP },
         { role: "user", content: "CV :\n" + text }], 900);
      if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
      let c = (out.parsed && out.parsed.choices && out.parsed.choices[0] &&
        out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
      c = ("" + c).replace(/```json|```/g, "").trim();
      let d = {}; try { d = JSON.parse(c); } catch (e) {}
      res.status(200).json(withUsage({ ok: true, profil: {
        prenom: clean(d.prenom).slice(0, 40),
        intro: ("" + (d.intro || "")).replace(/\s+/g, " ").trim().slice(0, 900),
      }}, out));
    } catch (e) { res.status(200).json({ ok: false, reason: "ai_error" }); }
    return;
  }

  // ----- MODE OFFRE (defaut) -----
  const sys =
    "Tu extrais les informations d'une offre d'emploi a partir d'un texte brut " +
    "(souvent mal structure). Reponds UNIQUEMENT par un objet JSON valide, sans " +
    "aucun texte autour, avec EXACTEMENT ces cles (chaine vide si l'info est absente) : " +
    '{"titre":"","entreprise":"","lieu":"","typeContrat":"","salaire":"","experience":""}. ' +
    "Regles : 'titre' = l'intitule du poste SEUL, sans le nom de l'entreprise ni la ville. " +
    "'typeContrat' doit valoir l'un de : CDI, CDD, Alternance, Stage, Interim, Freelance, " +
    "'Temps partiel', 'Temps plein', Saisonnier — ou \"\" si indetermine. " +
    "'salaire' = la remuneration telle qu'ecrite. 'experience' = l'experience demandee. " +
    "Si le 'titre' fourni est absent, vide ou manifestement faux (ex: 'security check', " +
    "'verification', 'just a moment', 'captcha'), DEDUIS l'intitule reel du poste a partir " +
    "de la description et du contexte. " +
    "N'invente jamais une valeur absente.";

  try {
    const out = await callAI(base, key, model,
      [{ role: "system", content: sys },
       { role: "user", content: "URL: " + url + "\n\nTEXTE DE L'OFFRE :\n" + text }], 900);
    if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
    let content = (out.parsed && out.parsed.choices && out.parsed.choices[0] &&
      out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
    content = ("" + content).replace(/```json|```/g, "").trim();
    let data = {};
    try { data = JSON.parse(content); } catch (e) {}
    res.status(200).json(withUsage({
      ok: true,
      offer: {
        titre: clean(data.titre),
        entreprise: clean(data.entreprise),
        lieu: clean(data.lieu),
        typeContrat: clean(data.typeContrat),
        salaire: clean(data.salaire),
        experience: clean(data.experience),
      },
    }, out));
  } catch (e) {
    res.status(200).json({ ok: false, reason: "ai_error" });
  }
}
