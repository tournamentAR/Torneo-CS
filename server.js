import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "2mb" }));

const DATA_FILE = path.join(__dirname, "data-store.json");

/** @type {{exportedAt:number,tournaments:any[]}} */
let data = { exportedAt: Date.now(), tournaments: [] };

try {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
} catch {
  // ignore
}

/** @type {Set<import("express").Response>} */
const sseClients = new Set();

function persist(next) {
  data = next;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // ignore
  }
  // broadcast SSE
  const payload = `data: ${JSON.stringify({ type: "data", data })}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, message: "Torneos CS API" });
});

app.get("/api/data", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(data);
});

app.post("/api/data", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || !Array.isArray(body.tournaments)) {
    res.status(400).json({ ok: false, error: "Formato inválido" });
    return;
  }
  persist({ exportedAt: Date.now(), tournaments: body.tournaments });
  res.json({ ok: true });
});

/** Inscripción pública: agregar equipo a un torneo (confirmed: false) */
const PLAYERS_BY_MODE = { "1v1": 1, "2v2": 2, "5v5": 5 };
function handleRegister(req, res) {
  try {
    const body = req.body || {};
    if (typeof body.tournamentId !== "string" || typeof body.teamName !== "string") {
      res.status(400).json({ ok: false, error: "Faltan tournamentId o teamName" });
      return;
    }
    const tournamentId = body.tournamentId.trim();
    const teamName = (body.teamName || "").trim();
      const repNumber =
        typeof body.repNumber === "string" ? body.repNumber.trim() : "";
      const discord =
        typeof body.discord === "string" ? body.discord.trim() : "";
    const players = Array.isArray(body.players) ? body.players.map((p) => String(p || "").trim()).filter(Boolean) : [];
    if (!teamName) {
      res.status(400).json({ ok: false, error: "El nombre del equipo es obligatorio" });
      return;
    }
    const tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];
    const tournament = tournaments.find((t) => t && t.id === tournamentId);
    if (!tournament) {
      res.status(404).json({ ok: false, error: "Torneo no encontrado" });
      return;
    }
    const required = PLAYERS_BY_MODE[tournament.mode] ?? 5;
    if (players.length !== required) {
      res.status(400).json({ ok: false, error: `Este torneo es ${tournament.mode}: debes indicar exactamente ${required} jugador(es)` });
      return;
    }
    const teams = tournament.teams || [];
    if (teams.length >= tournament.cap) {
      res.status(400).json({ ok: false, error: "El torneo ya tiene el cupo completo" });
      return;
    }
    const existingNames = teams.map((t) => (t.name || "").toLowerCase());
    if (existingNames.includes(teamName.toLowerCase())) {
      res.status(400).json({ ok: false, error: "Ya existe un equipo con ese nombre en este torneo" });
      return;
    }
    const newTeam = {
      id: crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: teamName,
      confirmed: false,
      createdAt: Date.now(),
      players,
      repNumber: repNumber || null,
      discord: discord || null,
    };
    const next = {
      ...data,
      exportedAt: Date.now(),
      tournaments: (data.tournaments || []).map((t) =>
        t && t.id === tournamentId ? { ...t, teams: [...(t.teams || []), newTeam] } : t
      ),
    };
    persist(next);
    res.json({ ok: true, teamId: newTeam.id });
  } catch (err) {
    console.error("/api/register error:", err);
    res.status(500).json({ ok: false, error: "Error en el servidor. Revisá la consola." });
  }
}
app.post("/api/register", handleRegister);
app.post("/api/register/", handleRegister);

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: "hello", data })}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

// Static (Vercel: express.static() se ignora)
app.get("*", (req, res) => {
  try {
    const reqPath = decodeURIComponent(req.path || "/");
    const relativePath = reqPath.replace(/^\/+/, "");
    const wanted = relativePath === "" ? "index.html" : relativePath;
    const finalRel = wanted.endsWith("/") ? `${wanted}index.html` : wanted;
    const filePath = path.join(__dirname, finalRel);

    // Seguridad básica anti traversal
    if (!filePath.startsWith(__dirname)) {
      res.status(400).send("Bad request");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.sendFile(filePath);
      return;
    }

    res.status(404).send(`Cannot GET ${reqPath}`);
  } catch (err) {
    console.error("Static handler error:", err);
    res.status(500).send("Server error");
  }
});

export default app;

// Solo escuchamos en local. En Vercel (serverless) se usa el export.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 5173);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

