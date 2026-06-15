export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  var date = req.query.date || "2026-06-15";
  res.status(200).json({ ok: true, date: date, message: "Step 2 works" });
}
