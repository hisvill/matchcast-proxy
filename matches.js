// api/matches.js
// Endpoint utama: menggabungkan football-data.org (jadwal/skor resmi WC)
// dengan Sportmonks (live events/goal timeline jika tersedia)

// Mapping nama tim football-data.org -> kode TLA yang konsisten
function tlaFromName(name, shortName, tla) {
  if (tla) return tla;
  if (shortName) return shortName.slice(0, 3).toUpperCase();
  return (name || "???").slice(0, 3).toUpperCase();
}

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]/g, "");
}

async function fetchFootballData(token, date, competition) {
  const url = `https://api.football-data.org/v4/competitions/${competition}/matches?dateFrom=${date}&dateTo=${date}`;
  const r = await fetch(url, { headers: { "X-Auth-Token": token } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`football-data.org ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

async function fetchSportmonksInplay(token) {
  if (!token) return null;
  try {
    const include = "participants;scores;periods;events";
    const url = `https://api.sportmonks.com/v3/football/livescores/inplay?include=${include}&api_token=${token}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

// Cari fixture Sportmonks yang cocok (berdasarkan nama tim)
function findSportmonksMatch(smData, homeName, awayName) {
  if (!smData?.data) return null;
  const h = normalizeName(homeName);
  const a = normalizeName(awayName);
  return smData.data.find(f => {
    const participants = f.participants || [];
    const names = participants.map(p => normalizeName(p.name));
    return names.some(n => n.includes(h) || h.includes(n)) &&
           names.some(n => n.includes(a) || a.includes(n));
  }) || null;
}

function mapFDStatus(status) {
  if (["FINISHED", "AWARDED"].includes(status)) return "FT";
  if (["IN_PLAY", "PAUSED"].includes(status)) return "LIVE";
  return "PRE"; // SCHEDULED, TIMED, POSTPONED, etc.
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const fdToken = process.env.FOOTBALL_DATA_TOKEN;
  const smToken = process.env.SPORTMONKS_TOKEN;

  if (!fdToken) {
    return res.status(500).json({ error: "FOOTBALL_DATA_TOKEN not configured in Vercel environment variables" });
  }

  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const competition = req.query.competition || "WC";

  try {
    const [fdData, smData] = await Promise.all([
      fetchFootballData(fdToken, date, competition),
      fetchSportmonksInplay(smToken),
    ]);

    const fdMatches = fdData.matches || [];

    const merged = fdMatches.map(m => {
      const home = m.homeTeam || {};
      const away = m.awayTeam || {};
      const status = mapFDStatus(m.status);

      // Cari data Sportmonks yang cocok untuk live events
      const sm = status === "LIVE" ? findSportmonksMatch(smData, home.name, away.name) : null;

      let goals = [];
      let minute = null;
      if (sm) {
        const homeP = sm.participants?.find(p => p.meta?.location === "home");
        const awayP = sm.participants?.find(p => p.meta?.location === "away");
        goals = (sm.events || [])
          .filter(e => e.type_id === 14)
          .map(e => ({
            minute: e.minute,
            player: e.player_name || "—",
            isHome: e.participant_id === homeP?.id,
          }))
          .sort((a, b) => a.minute - b.minute);
        minute = sm.periods?.find(p => p.ticking)?.minutes ?? null;
      }

      return {
        id: m.id,
        source: "football-data.org" + (sm ? " + sportmonks" : ""),
        status,
        statusRaw: m.status,
        utcDate: m.utcDate,
        stage: m.stage,
        group: m.group,
        matchday: m.matchday,
        venue: m.venue || null,
        homeTeam: {
          id: home.id,
          name: home.name,
          shortName: home.shortName,
          tla: tlaFromName(home.name, home.shortName, home.tla),
          crest: home.crest,
        },
        awayTeam: {
          id: away.id,
          name: away.name,
          shortName: away.shortName,
          tla: tlaFromName(away.name, away.shortName, away.tla),
          crest: away.crest,
        },
        score: {
          home: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null,
          away: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null,
          halfTime: m.score?.halfTime || null,
          winner: m.score?.winner || null,
        },
        minute,
        goals,
      };
    });

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    return res.status(200).json({
      date,
      competition,
      count: merged.length,
      sources: {
        footballData: true,
        sportmonks: !!smData,
      },
      matches: merged,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
