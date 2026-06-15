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

  // --- inline helpers as local functions ---
  var tlaFromName = function (name, shortName, tla) {
    if (tla) return tla;
    if (shortName) return shortName.slice(0, 3).toUpperCase();
    return (name || "ZZZ").slice(0, 3).toUpperCase();
  };

  var normalizeName = function (name) {
    return (name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  };

  var mapFDStatus = function (status) {
    if (status === "FINISHED" || status === "AWARDED") return "FT";
    if (status === "IN_PLAY" || status === "PAUSED") return "LIVE";
    return "PRE";
  };

  var findSportmonksMatch = function (smData, homeName, awayName) {
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
  };

  try {
    // --- fetch football-data.org ---
    var fdUrl = "https://api.football-data.org/v4/competitions/" + competition + "/matches?dateFrom=" + date + "&dateTo=" + date;
    var fdRes = await fetch(fdUrl, { headers: { "X-Auth-Token": fdToken } });
    if (!fdRes.ok) {
      var fdErrText = await fdRes.text().catch(function () { return ""; });
      throw new Error("football-data.org " + fdRes.status + ": " + fdErrText.slice(0, 200));
    }
    var fdData = await fdRes.json();

    // --- fetch sportmonks (optional) ---
    var smData = null;
    if (smToken) {
      try {
        var smInclude = "participants;scores;periods;events";
        var smUrl = "https://api.sportmonks.com/v3/football/livescores/inplay?include=" + smInclude + "&api_token=" + smToken;
        var smRes = await fetch(smUrl);
        if (smRes.ok) smData = await smRes.json();
      } catch (e) {
        smData = null;
      }
    }

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
