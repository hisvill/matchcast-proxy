function helperOne(a, b, c) {
  if (c) return c;
  if (b) return b.slice(0, 3).toUpperCase();
  return (a || "ZZZ").slice(0, 3).toUpperCase();
}

function helperTwo(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function helperThree(token, date, competition) {
  var url = "https://api.football-data.org/v4/competitions/" + competition + "/matches?dateFrom=" + date + "&dateTo=" + date;
  var r = await fetch(url, { headers: { "X-Auth-Token": token } });
  if (!r.ok) {
    var text = await r.text().catch(function () { return ""; });
    throw new Error("football-data.org " + r.status + ": " + text.slice(0, 200));
  }
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  var fdToken = process.env.FOOTBALL_DATA_TOKEN;
  if (!fdToken) {
    return res.status(500).json({ error: "FOOTBALL_DATA_TOKEN not configured" });
  }
  var date = req.query.date || "2026-06-15";
  var competition = req.query.competition || "WC";

  try {
    var fdData = await helperThree(fdToken, date, competition);
    var fdMatches = fdData.matches || [];
    var simplified = fdMatches.map(function (m) {
      return {
        id: m.id,
        homeTla: helperOne(m.homeTeam && m.homeTeam.name, m.homeTeam && m.homeTeam.shortName, m.homeTeam && m.homeTeam.tla),
        normalized: helperTwo(m.homeTeam && m.homeTeam.name)
      };
    });
    return res.status(200).json({ ok: true, count: simplified.length, sample: simplified.slice(0, 2) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
