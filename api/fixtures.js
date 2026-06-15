// api/fixtures.js
// Mengambil semua fixture hari ini (termasuk yang belum/sudah main)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.SPORTMONKS_TOKEN;
  if (!token) return res.status(500).json({ error: "SPORTMONKS_TOKEN not configured" });

  try {
    // Ambil tanggal dari query param, default hari ini
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const include = "participants;scores;periods;league.country;round;venue;state";
    const url = `https://api.sportmonks.com/v3/football/fixtures/date/${date}?include=${include}&api_token=${token}`;

    const upstream = await fetch(url);
    const data = await upstream.json();

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
