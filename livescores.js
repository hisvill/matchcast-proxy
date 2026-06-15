// api/livescores.js
// Vercel Serverless Function — proxy ke Sportmonks API
// Token disimpan di environment variable, tidak pernah terekspos ke browser

export default async function handler(req, res) {
  // Izinkan semua origin (atau ganti * dengan domain spesifik Anda)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const token = process.env.SPORTMONKS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "SPORTMONKS_TOKEN not configured" });
  }

  try {
    const include = "participants;scores;periods;events;league.country;round";
    const url = `https://api.sportmonks.com/v3/football/livescores/inplay?include=${include}&api_token=${token}`;

    const upstream = await fetch(url);
    const data = await upstream.json();

    // Cache 15 detik di Vercel edge (sesuai update interval Sportmonks)
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
