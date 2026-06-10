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
  return { status: r.status, ok: r.ok, raw: raw, parsed: parsed };
}

module.exports = async function handler(req, res) {
  const key = process.env.AI_KEY;
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
  if (!key) { res.status(200).json({ ok: false, reason: "no_key" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const text = ("" + (body.text || "")).slice(0, 6000);
  const url = "" + (body.url || "");
  const mode = "" + (body.mode || "offer");
  // le mode "draft" travaille à partir de "context", pas de "text"
  if (mode !== "draft" && !text.trim()) { res.status(200).json({ ok: false, reason: "no_text" }); return; }

  const clean = (v) => ("" + (v == null ? "" : v)).replace(/\s+/g, " ").trim().slice(0, 200);

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
      res.status(200).json({
        ok: true,
        brand: {
          entreprise: clean(d.entreprise),
          secteur: clean(d.secteur),
          ville: clean(d.ville),
          description: clean(d.description),
        },
      });
    } catch (e) {
      res.status(200).json({ ok: false, reason: "ai_error" });
    }
    return;
  }

  // ----- MODE BROUILLON : rédige un court message (relance, etc.) -----
  if (mode === "draft") {
    const kind = "" + (body.kind || "relance");
    const ctx = body.context || {};
    let sysD, usr;
    if (kind === "relance") {
      sysD = "Tu rediges un court message de RELANCE de candidature en francais, professionnel, " +
        "courtois et concis (5 a 7 phrases maximum). Va a l'essentiel : rappeler la candidature, " +
        "reaffirmer la motivation, rester disponible. Termine par une formule de politesse. " +
        "Signe avec le prenom fourni s'il est donne. Si un profil/CV du candidat est fourni, tu " +
        "peux integrer UNE reference pertinente et naturelle (une competence ou une experience), " +
        "sans tout recopier. Reponds UNIQUEMENT par le texte du message, sans commentaire ni JSON.";
      usr = "Entreprise: " + (ctx.entreprise || "") + "\nPoste: " + (ctx.poste || "") +
        "\nCandidature envoyee il y a: " + (ctx.jours || "?") + " jours\nPrenom (signature): " + (ctx.prenom || "") +
        (ctx.intro ? ("\n\nProfil du candidat: " + ("" + ctx.intro).slice(0, 600)) : "") +
        (ctx.cv ? ("\n\nCV (extrait): " + ("" + ctx.cv).slice(0, 1500)) : "");
    } else if (kind === "accroche") {
      sysD = "Tu adaptes l'ACCROCHE ORIGINALE du candidat pour la cibler sur une offre d'emploi. " +
        "OBJECTIF : que le resultat semble ecrit par le candidat lui-meme, pas par une IA.\n" +
        "REGLES STRICTES :\n" +
        "1. Garde la longueur de l'original (a une phrase pres), sa structure, son rythme et son vocabulaire. " +
        "Reprends ses tournures telles quelles quand elles restent pertinentes : ne reformule que le strict necessaire.\n" +
        "2. Adapte 1 ou 2 elements MAXIMUM au contexte de l'annonce : le poste vise, et un point concret de " +
        "l'offre ou de l'entreprise (secteur, produit, lieu) qui fait echo au parcours du candidat.\n" +
        "3. INTERDIT (vocabulaire artificiel) : 'dynamique', 'passionne par', 'relever des defis', 'fort de', " +
        "'doté de', 'mettre a profit', 'pleinement', 'au sein de votre structure', superlatifs, " +
        "enumerations de qualites, phrases creuses de motivation generique.\n" +
        "4. Phrases simples et directes, ton sobre. Pas de tirets longs, pas de listes, pas d'emphase. " +
        "Une imperfection legere (phrase courte, formulation simple) vaut mieux qu'un texte trop lisse.\n" +
        "5. N'invente AUCUN fait : utilise uniquement le parcours fourni (accroche + CV).\n" +
        "6. Pas de 'Madame, Monsieur', pas de signature, pas de commentaire. " +
        "Reponds uniquement par le texte de l'accroche.\n" +
        "Si aucune accroche originale n'est fournie, redige 4 a 6 phrases sobres a partir du CV, memes regles.";
      usr = "Poste: " + (ctx.poste || "") + "\nEntreprise: " + (ctx.entreprise || "") +
        "\nLieu: " + (ctx.lieu || "") +
        (ctx.offre ? ("\n\nDetails de l'offre: " + ("" + ctx.offre).slice(0, 1500)) : "") +
        (ctx.intro ? ("\n\nACCROCHE ORIGINALE A ADAPTER (garde sa longueur, son style et ses tournures):\n" + ("" + ctx.intro).slice(0, 800)) : "") +
        (ctx.cv ? ("\n\nCV (extrait, pour le contexte uniquement): " + ("" + ctx.cv).slice(0, 1800)) : "");
    } else {
      sysD = "Tu rediges un court texte professionnel en francais, clair et concis. Reponds uniquement par le texte.";
      usr = JSON.stringify(ctx);
    }
    try {
      const out = await callAI(base, key, model,
        [{ role: "system", content: sysD }, { role: "user", content: usr }],
        1500, { json: false, temperature: 0.4 });
      if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
      let txt = (out.parsed && out.parsed.choices && out.parsed.choices[0] &&
        out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
      txt = ("" + txt).trim();
      res.status(200).json({ ok: !!txt, text: txt.slice(0, 1800) });
    } catch (e) {
      res.status(200).json({ ok: false, reason: "ai_error" });
    }
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
    res.status(200).json({
      ok: true,
      offer: {
        titre: clean(data.titre),
        entreprise: clean(data.entreprise),
        lieu: clean(data.lieu),
        typeContrat: clean(data.typeContrat),
        salaire: clean(data.salaire),
        experience: clean(data.experience),
      },
    });
  } catch (e) {
    res.status(200).json({ ok: false, reason: "ai_error" });
  }
}
