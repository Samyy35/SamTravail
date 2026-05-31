// api/search.js
// Serverless function Vercel : parle à l'API France Travail en cachant la clé.
// Gère OAuth2, la recherche multi mots-clés en parallèle, et la déduplication.

let cachedToken = null;
let tokenExpiry = 0;

// Récupère un token OAuth2 (avec cache pour éviter de le redemander à chaque requête)
async function getToken() {
  const now = Date.now();
  // Si le token est encore valide (avec 60s de marge), on le réutilise
  if (cachedToken && now < tokenExpiry - 60000) {
    return cachedToken;
  }

  const clientId = process.env.FT_CLIENT_ID;
  const clientSecret = process.env.FT_CLIENT_SECRET;
  const scope = "api_offresdemploiv2 o2dsoffre";

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: scope,
  });

  const resp = await fetch(
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error("Auth FT échouée: " + resp.status + " " + txt);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in * 1000);
  return cachedToken;
}

// Lance une recherche sur l'API FT pour un jeu de paramètres
async function searchOffers(token, params) {
  const url = new URL("https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search");

  // Ajout des paramètres de recherche
  Object.keys(params).forEach((key) => {
    if (params[key] !== undefined && params[key] !== null && params[key] !== "") {
      url.searchParams.append(key, params[key]);
    }
  });

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
    },
  });

  // 204 = aucun résultat ; 206 = résultats partiels (normal avec pagination)
  if (resp.status === 204) {
    return { resultats: [], total: 0 };
  }
  if (!resp.ok && resp.status !== 206) {
    return { resultats: [], total: 0 };
  }

  const data = await resp.json();
  // Le total réel est dans le header Content-Range : "offres 0-49/12345"
  let total = 0;
  const contentRange = resp.headers.get("content-range");
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)/);
    if (match) total = parseInt(match[1], 10);
  }

  return { resultats: data.resultats || [], total };
}

// Handler principal appelé par le frontend
export default async function handler(req, res) {
  // CORS pour autoriser les appels depuis ta page
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const token = await getToken();

    // Paramètres reçus du frontend (query string)
    const {
      motsCles = "",        // mots-clés séparés par des virgules pour multi-recherche
      commune = "",         // code INSEE commune
      departement = "",     // numéro département
      distance = "",        // rayon km
      typeContrat = "",     // CDI, CDD, MIS, etc.
      experience = "",      // 1, 2, 3
      page = "0",           // page (0-indexed)
      parPage = "50",       // résultats par page
    } = req.query;

    // Multi-recherche : on découpe les mots-clés par virgule
    const keywords = motsCles
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    // Pagination : range FT
    const start = parseInt(page, 10) * parseInt(parPage, 10);
    const end = start + parseInt(parPage, 10) - 1;
    const range = start + "-" + end;

    // Paramètres communs à toutes les requêtes
    const baseParams = {
      commune: commune || undefined,
      departement: departement || undefined,
      distance: distance || undefined,
      typeContrat: typeContrat || undefined,
      experience: experience || undefined,
      range: range,
      sort: "1", // tri par date décroissante
    };

    let allResults = [];
    let maxTotal = 0;

    if (keywords.length <= 1) {
      // Recherche simple
      const params = { ...baseParams, motsCles: keywords[0] || undefined };
      const { resultats, total } = await searchOffers(token, params);
      allResults = resultats;
      maxTotal = total;
    } else {
      // Multi-recherche : une requête par mot-clé, en parallèle
      const promises = keywords.map((kw) =>
        searchOffers(token, { ...baseParams, motsCles: kw })
      );
      const results = await Promise.all(promises);

      // Combine et déduplique sur l'id de l'offre
      const seen = new Set();
      results.forEach((r) => {
        maxTotal += r.total;
        r.resultats.forEach((offre) => {
          if (!seen.has(offre.id)) {
            seen.add(offre.id);
            allResults.push(offre);
          }
        });
      });

      // Tri par date décroissante après combinaison
      allResults.sort((a, b) => {
        const da = new Date(a.dateCreation || 0);
        const db = new Date(b.dateCreation || 0);
        return db - da;
      });
    }

    // Nettoie / structure les données pour le frontend
    const offers = allResults.map((o) => ({
      id: o.id,
      titre: o.intitule || "",
      entreprise: (o.entreprise && o.entreprise.nom) || "Non précisé",
      lieu: (o.lieuTravail && o.lieuTravail.libelle) || "",
      typeContrat: o.typeContratLibelle || o.typeContrat || "",
      experience: o.experienceLibelle || "",
      dateCreation: o.dateCreation || "",
      description: (o.description || "").substring(0, 300),
      salaire: (o.salaire && o.salaire.libelle) || "",
      lien:
        (o.origineOffre && o.origineOffre.urlOrigine) ||
        ("https://candidat.francetravail.fr/offres/recherche/detail/" + o.id),
      rome: o.romeLibelle || "",
      source: "France Travail",
    }));

    return res.status(200).json({
      offers,
      total: maxTotal,
      count: offers.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
