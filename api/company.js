// api/company.js
// Enrichit une entreprise via l'API officielle gratuite recherche-entreprises.api.gouv.fr
// (données SIRENE/INSEE : effectif, code NAF/activité, ville du siège, date création)
// Aucune clé requise. 7 req/s max.

// Mapping des tranches d'effectif INSEE -> texte lisible
const EFFECTIF = {
  "00": "0 salarié", "01": "1-2 salariés", "02": "3-5 salariés", "03": "6-9 salariés",
  "11": "10-19 salariés", "12": "20-49 salariés", "21": "50-99 salariés",
  "22": "100-199 salariés", "31": "200-249 salariés", "32": "250-499 salariés",
  "41": "500-999 salariés", "42": "1000-1999 salariés", "51": "2000-4999 salariés",
  "52": "5000-9999 salariés", "53": "10000+ salariés",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const name = (req.query.nom || "").trim();
  if (!name) return res.status(200).json({ found: false });

  try {
    const url = "https://recherche-entreprises.api.gouv.fr/search?q=" +
      encodeURIComponent(name) + "&page=1&per_page=1";
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) return res.status(200).json({ found: false });

    const data = await resp.json();
    const r = (data.results && data.results[0]) || null;
    if (!r) return res.status(200).json({ found: false });

    const siege = r.siege || {};
    const out = {
      found: true,
      nom: r.nom_complet || r.nom_raison_sociale || name,
      activite: r.activite_principale_libelle || (r.complements && r.complements.activite_principale) || "",
      naf: r.activite_principale || "",
      effectif: EFFECTIF[r.tranche_effectif_salarie] || (r.tranche_effectif_salarie ? "n.c." : "Non renseigné"),
      ville_siege: siege.libelle_commune || siege.commune || "",
      cp_siege: siege.code_postal || "",
      date_creation: r.date_creation || "",
      dirigeant: (r.dirigeants && r.dirigeants[0])
        ? ((r.dirigeants[0].prenoms || "") + " " + (r.dirigeants[0].nom || "")).trim()
        : "",
      siren: r.siren || "",
    };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json({ found: false, error: e.message });
  }
}
