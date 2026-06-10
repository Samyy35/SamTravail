// =============================================================
//  Sam'Travail — /api/ai-sort
//  Repli "mini-IA" : nettoie une offre d'emploi (texte brut -> JSON propre)
//  via une IA GRATUITE compatible OpenAI.
//
//  >>> À placer dans ton dépôt à :  api/ai-sort.js  <<<
//
//  Config via variables d'environnement Vercel (Settings > Environment Variables) :
//    AI_KEY       = ta clé API gratuite           (OBLIGATOIRE)
//    AI_BASE_URL  = endpoint compatible OpenAI     (optionnel, défaut = Groq)
//    AI_MODEL     = nom du modèle                  (optionnel, défaut = Llama 3.3 70B)
//
//  Exemples de config (choisis-en UN) :
//
//   • Groq (recommandé : rapide, sans carte, 14 400 req/jour)
//       clé    -> https://console.groq.com  (Create API Key)
//       AI_KEY      = gsk_........
//       AI_BASE_URL = https://api.groq.com/openai/v1
//       AI_MODEL    = llama-3.3-70b-versatile
//
//   • Google Gemini (1 500 req/jour, très bon en extraction)
//       clé    -> https://aistudio.google.com/app/apikey
//       AI_KEY      = AIza........
//       AI_BASE_URL = https://generativelanguage.googleapis.com/v1beta/openai
//       AI_MODEL    = gemini-2.5-flash
//
//   • Mistral (français)
//       clé    -> https://console.mistral.ai
//       AI_KEY      = ........
//       AI_BASE_URL = https://api.mistral.ai/v1
//       AI_MODEL    = mistral-small-latest
//
//  Sans AI_KEY, la fonction répond {ok:false} et l'app continue normalement
//  (aucune erreur, le repli IA est simplement inactif).
// =============================================================

export default async function handler(req, res) {
  // CORS / méthode
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "method" });
    return;
  }

  const key = process.env.AI_KEY;
  if (!key) {
    // Pas de clé configurée -> repli inactif, l'app garde l'extraction classique.
    res.status(200).json({ ok: false, reason: "no_key" });
    return;
  }

  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL || "llama-3.3-70b-versatile";

  // Corps de la requête
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  const text = ("" + (body.text || "")).slice(0, 6000);
  const url = "" + (body.url || "");

  if (!text.trim()) {
    res.status(200).json({ ok: false, reason: "no_text" });
    return;
  }

  const sys =
    "Tu extrais les informations d'une offre d'emploi à partir d'un texte brut " +
    "(souvent mal structuré). Réponds UNIQUEMENT par un objet JSON valide, sans " +
    "aucun texte autour, avec EXACTEMENT ces clés (chaîne vide si l'info est absente) : " +
    '{"titre":"","entreprise":"","lieu":"","typeContrat":"","salaire":"","experience":""}. ' +
    "Règles : 'titre' = l'intitulé du poste SEUL, sans le nom de l'entreprise ni la ville. " +
    "'typeContrat' doit valoir l'un de : CDI, CDD, Alternance, Stage, Intérim, Freelance, " +
    "'Temps partiel', 'Temps plein', Saisonnier — ou \"\" si indéterminé. " +
    "'salaire' = la rémunération telle qu'écrite (ex: '38 000 à 45 000 € brut/an'). " +
    "'experience' = l'expérience demandée (ex: '2 ans'). N'invente jamais une valeur absente.";

  try {
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: model,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: "URL: " + url + "\n\nTEXTE DE L'OFFRE :\n" + text },
        ],
      }),
    });

    const j = await r.json();
    let content =
      (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    content = ("" + content).replace(/```json|```/g, "").trim();

    let data = {};
    try { data = JSON.parse(content); } catch (e) { data = {}; }

    // On ne renvoie que des champs connus, en chaînes propres.
    const clean = (v) => ("" + (v == null ? "" : v)).replace(/\s+/g, " ").trim().slice(0, 200);
    const offer = {
      titre: clean(data.titre),
      entreprise: clean(data.entreprise),
      lieu: clean(data.lieu),
      typeContrat: clean(data.typeContrat),
      salaire: clean(data.salaire),
      experience: clean(data.experience),
    };

    res.status(200).json({ ok: true, offer: offer });
  } catch (e) {
    res.status(200).json({ ok: false, reason: "ai_error" });
  }
}
