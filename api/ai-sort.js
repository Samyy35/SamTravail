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

async function callAI(base, key, model, messages, maxTokens) {
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: messages,
    }),
  });
  const raw = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) {}
  return { status: r.status, ok: r.ok, raw: raw, parsed: parsed };
}

export default async function handler(req, res) {
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
        [{ role: "user", content: 'Reponds en JSON: {"ping":"ok"}' }], 20);
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
  if (!text.trim()) { res.status(200).json({ ok: false, reason: "no_text" }); return; }

  const sys =
    "Tu extrais les informations d'une offre d'emploi a partir d'un texte brut " +
    "(souvent mal structure). Reponds UNIQUEMENT par un objet JSON valide, sans " +
    "aucun texte autour, avec EXACTEMENT ces cles (chaine vide si l'info est absente) : " +
    '{"titre":"","entreprise":"","lieu":"","typeContrat":"","salaire":"","experience":""}. ' +
    "Regles : 'titre' = l'intitule du poste SEUL, sans le nom de l'entreprise ni la ville. " +
    "'typeContrat' doit valoir l'un de : CDI, CDD, Alternance, Stage, Interim, Freelance, " +
    "'Temps partiel', 'Temps plein', Saisonnier — ou \"\" si indetermine. " +
    "'salaire' = la remuneration telle qu'ecrite. 'experience' = l'experience demandee. " +
    "N'invente jamais une valeur absente.";

  try {
    const out = await callAI(base, key, model,
      [{ role: "system", content: sys },
       { role: "user", content: "URL: " + url + "\n\nTEXTE DE L'OFFRE :\n" + text }], 400);
    if (!out.ok) { res.status(200).json({ ok: false, reason: "ai_error", status: out.status }); return; }
    let content = (out.parsed && out.parsed.choices && out.parsed.choices[0] &&
      out.parsed.choices[0].message && out.parsed.choices[0].message.content) || "";
    content = ("" + content).replace(/```json|```/g, "").trim();
    let data = {};
    try { data = JSON.parse(content); } catch (e) {}
    const clean = (v) => ("" + (v == null ? "" : v)).replace(/\s+/g, " ").trim().slice(0, 200);
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
