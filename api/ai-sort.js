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

// Regles de style communes a toutes les redactions IA (relance, accroche, etc.)
const STYLE_RULES =
  "STYLE OBLIGATOIRE — le texte doit sembler ecrit par le candidat lui-meme, pas par une IA :\n" +
  "- Phrases simples et directes, ton sobre et professionnel.\n" +
  "- INTERDIT : 'dynamique', 'passionne par', 'relever des defis', 'fort de', 'doté de', " +
  "'mettre a profit', 'pleinement', 'au sein de votre structure', 'n'hesitez pas', " +
  "superlatifs, enumerations de qualites, formules creuses de motivation generique.\n" +
  "- Pas de tirets longs, pas de listes a puces, pas d'emphase, pas d'emojis.\n" +
  "- Une legere imperfection (phrase courte, formulation simple) vaut mieux qu'un texte trop lisse.\n" +
  "- N'invente AUCUN fait : utilise uniquement les informations fournies.\n";

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
      sysD = "Tu adaptes l'ACCROCHE ORIGINALE du candidat pour la cibler sur une offre d'emploi. " +
        "OBJECTIF : que le resultat semble ecrit par le candidat lui-meme, pas par une IA.\n" +
        "REGLES STRICTES :\n" +
        "1. Garde la longueur de l'original (a une phrase pres), sa structure, son rythme et son vocabulaire. " +
        "Reprends ses tournures telles quelles quand elles restent pertinentes.\n" +
        "2. ADAPTE REELLEMENT le contenu a l'annonce : cite le NOM DE L'ENTREPRISE, l'INTITULE DU POSTE, " +
        "et evoque le secteur/l'industrie quand c'est pertinent. Ajuste les competences et qualites mises " +
        "en avant pour qu'elles repondent a ce que demande l'offre (en t'appuyant uniquement sur le parcours " +
        "reel du candidat). L'accroche doit donner l'impression d'avoir ete ecrite POUR cette annonce, " +
        "pas juste retouchee d'un mot ou deux.\n" +
        "3. " + STYLE_RULES +
        "4. Pas de 'Madame, Monsieur', pas de signature, pas de commentaire.\n" +
        "FORMAT DE SORTIE OBLIGATOIRE : DEUX versions de l'accroche, separees par une ligne contenant " +
        "uniquement trois tirets (---).\n" +
        "Version 1 (avant le ---) : TRES PROCHE de l'original — changements minimaux, juste le poste/l'entreprise integres.\n" +
        "Version 2 (apres le ---) : PLUS ADAPTEE a l'annonce — competences et qualites ajustees a l'offre, " +
        "secteur evoque, mais toujours le meme style et la meme longueur.\n" +
        "Aucun titre, aucune etiquette, aucun commentaire : juste version 1, la ligne ---, version 2.\n" +
        "Si aucune accroche originale n'est fournie, redige 4 a 6 phrases sobres a partir du CV, memes regles, meme format a deux versions.";
      usr = "Poste: " + (ctx.poste || "") + "\nEntreprise: " + (ctx.entreprise || "") +
        "\nLieu: " + (ctx.lieu || "") +
        (ctx.offre ? ("\n\nDetails de l'offre: " + ("" + ctx.offre).slice(0, 1500)) : "") +
        (ctx.intro ? ("\n\nACCROCHE ORIGINALE A ADAPTER (garde sa longueur, son style et ses tournures):\n" + ("" + ctx.intro).slice(0, 800)) : "") +
        (ctx.cv ? ("\n\nCV (extrait, pour le contexte uniquement): " + ("" + ctx.cv).slice(0, 1800)) : "");
    } else {
      sysD = "Tu rediges un court texte professionnel en francais, clair et concis.\n" + STYLE_RULES + "Reponds uniquement par le texte.";
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
      res.status(200).json({ ok: true, profil: {
        prenom: clean(d.prenom).slice(0, 40),
        intro: ("" + (d.intro || "")).replace(/\s+/g, " ").trim().slice(0, 900),
      }});
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
