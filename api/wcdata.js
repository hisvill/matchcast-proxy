function tlaFromName(name, shortName, tla) {
  if (tla) return tla;
  if (shortName) return shortName.slice(0, 3).toUpperCase();
  return (name || "ZZZ").slice(0, 3).toUpperCase();
}

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function fetchFootballData(token, date, competition) {
  var url = "https://api.football-data.org/v4/competitions/" + competition + "/matches?dateFrom=" + date + "&dateTo=" + date;
  var r = await fetch(url, { headers: { "X-Auth-Token": token } });
  if (!r.ok) {
    var text = await r.text().catch(function () { return ""; });
    throw new Error("football-data.org " + r.status + ": " + text.slice(0, 200));
  }
  return r.json();
}

async function fetchSportmonksInplay(token) {
  if (!token) return null;
  try {
    var include = "participants;scores;periods;events";
    var url = "https://api.sportmonks.com/v3/football/livescores/inplay?include=" + include + "&api_token=" + token;
    var r = await fetch(url);
    if (!r.ok) return null;
    return r.json();
  } catch (e) {
    return null;
  }
}

function findSportmonksMatch(smData, homeName, awayName) {
  if (!smData || !smData.data) return null;
  var h = normalizeName(homeName);
  var a = normalizeName(awayName);
  var found = null;
  for (var i = 0; i < smData.data.length; i++) {
    var f = smData.data[i];
    var participants = f.participants || [];
    var names = participants.map(function (p) { return normalizeName(p.name); });
    var hasHome = names.some(function (n) { return n.indexOf(h) !== -1 || h.indexOf(n) !== -1; });
    var hasAway = names.some(function (n) { return n.indexOf(a) !== -1 || a.indexOf(n) !== -1; });
    if (hasHome && hasAway) { found = f; break; }
  }
  return found;
}

function mapFDStatus(status) {
  if (status === "FINISHED" || status === "AWARDED") return "FT";
  if (status === "IN_PLAY" || status === "PAUSED") return "LIVE";
  return "PRE";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  var fdToken = process.env.FOOTBALL_DATA_TOKEN;
  var smToken = process.env.SPORTMONKS_TOKEN;

  if (!fdToken) {
    return res.status(500).json({ error: "FOOTBALL_DATA_TOKEN not configured" });
  }

  var date = req.query.date || new Date().toISOString().slice(0, 10);
  var competition = req.query.competition || "WC";

  try {
    var results = await Promise.all([
      fetchFootballData(fdToken, date, competition),
      fetchSportmonksInplay(smToken)
    ]);
    var fdData = results[0];
    var smData = results[1];

    var fdMatches = fdData.matches || [];

    var merged = fdMatches.map(function (m) {
      var home = m.homeTeam || {};
      var away = m.awayTeam || {};
      var status = mapFDStatus(m.status);

      var sm = status === "LIVE" ? findSportmonksMatch(smData, home.name, away.name) : null;

      var goals = [];
      var minute = null;
      if (sm) {
        var homeP = (sm.participants || []).find(function (p) { return p.meta && p.meta.location === "home"; });
        goals = (sm.events || [])
          .filter(function (e) { return e.type_id === 14; })
          .map(function (e) {
            return {
              minute: e.minute,
              player: e.player_name || "Unknown",
              isHome: homeP ? e.participant_id === homeP.id : false
            };
          })
          .sort(function (a, b) { return a.minute - b.minute; });
        var tickingPeriod = (sm.periods || []).find(function (p) { return p.ticking; });
        minute = tickingPeriod ? tickingPeriod.minutes : null;
      }

      return {
        id: m.id,
        source: "football-data.org" + (sm ? " + sportmonks" : ""),
        status: status,
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
          crest: home.crest
        },
        awayTeam: {
          id: away.id,
          name: away.name,
          shortName: away.shortName,
          tla: tlaFromName(away.name, away.shortName, away.tla),
          crest: away.crest
        },
        score: {
          home: (m.score && m.score.fullTime && m.score.fullTime.home != null) ? m.score.fullTime.home : ((m.score && m.score.halfTime) ? m.score.halfTime.home : null),
          away: (m.score && m.score.fullTime && m.score.fullTime.away != null) ? m.score.fullTime.away : ((m.score && m.score.halfTime) ? m.score.halfTime.away : null),
          halfTime: (m.score && m.score.halfTime) || null,
          winner: (m.score && m.score.winner) || null
        },
        minute: minute,
        goals: goals
      };
    });

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    return res.status(200).json({
      date: date,
      competition: competition,
      count: merged.length,
      sources: {
        footballData: true,
        sportmonks: !!smData
      },
      matches: merged
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
