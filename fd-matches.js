// api/fd-matches.js
// Proxy ke football-data.org v4 — sumber utama jadwal & skor World Cup

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return res.status(500).json({ error: "FOOTBALL_DATA_TOKEN not configured" });

  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const competition = req.query.competition || "WC";
    const url = `https://api.football-data.org/v4/competitions/${competition}/matches?dateFrom=${date}&dateTo=${date}`;

    const upstream = await fetch(url, {
      headers: { "X-Auth-Token": token },
    });
    const data = await upstream.json();

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
