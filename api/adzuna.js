// api/adzuna.js
// Serverless Vercel : interroge l'API Adzuna (France), cache les clés,
// fait la multi-recherche par mot-clé et normalise au MÊME format que France Travail.

async function searchAdzuna(appId, appKey, what, where, perPage) {
  const url = new URL("https://api.adzuna.com/v1/api/jobs/fr/search/1");
  url.searchParams.append("app_id", appId);
  url.searchParams.append("app_key", appKey);
  url.searchParams.append("results_per_page", perPage);
  url.searchParams.append("what", what);
  if (where) url.searchParams.append("where", where);
  url.searchParams.append("content-type", "application/json");

  const resp = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!resp.ok) return { results: [], count: 0 };
  const data = await resp.json();
  return { results: data.results || [], count: data.count || 0 };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  // Si pas de clés configurées, on renvoie vide proprement (l'app marche quand même avec FT seul)
  if (!appId || !appKey) {
    return res.status(200).json({ offers: [], total: 0, count: 0, disabled: true });
  }

  try {
    const { motsCles = "", departement = "", parPage = "50" } = req.query;
    // Adzuna utilise "where" en texte ; on passe le département/ville si fourni
    const where = departement || "";
    const perPage = Math.min(parseInt(parPage, 10) || 50, 50); // Adzuna cap à 50/page

    const keywords = motsCles.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
    if (keywords.length === 0) keywords.push("");

    // Une requête par mot-clé, en parallèle
    const results = await Promise.all(
      keywords.map((kw) => searchAdzuna(appId, appKey, kw, where, perPage))
    );

    // Combine + déduplique sur l'id (ou redirect_url)
    const seen = new Set();
    let offers = [];
    let total = 0;
    results.forEach((r) => {
      total += r.count;
      r.results.forEach((j) => {
        const id = "adz_" + (j.id || j.redirect_url || Math.random());
        if (seen.has(id)) return;
        seen.add(id);
        // Normalisation au format France Travail
        offers.push({
          id: id,
          titre: j.title || "",
          entreprise: (j.company && j.company.display_name) || "Non précisé",
          lieu: (j.location && j.location.display_name) || "",
          lat: j.latitude || null,
          lon: j.longitude || null,
          typeContrat: j.contract_time === "part_time" ? "Temps partiel"
            : j.contract_type === "permanent" ? "CDI"
            : j.contract_type === "contract" ? "CDD" : "",
          experience: "",
          dateCreation: j.created || "",
          description: (j.description || "").substring(0, 300),
          salaire: j.salary_min
            ? "Annuel de " + Math.round(j.salary_min) + (j.salary_max ? " à " + Math.round(j.salary_max) : "") + " Euros"
            : "",
          lien: j.redirect_url || "",
          rome: (j.category && j.category.label) || "",
          source: "Adzuna",
        });
      });
    });

    // Tri par date décroissante
    offers.sort((a, b) => new Date(b.dateCreation || 0) - new Date(a.dateCreation || 0));

    return res.status(200).json({ offers, total, count: offers.length });
  } catch (err) {
    return res.status(500).json({ error: err.message, offers: [], total: 0 });
  }
}
