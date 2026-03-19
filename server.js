import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "2mb" }));

// -------- Admin auth (nivel 2) --------
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  const parts = cookieHeader.split(";").map((s) => s.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx);
    const v = p.slice(idx + 1);
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function signSession(sessionId) {
  return crypto.createHmac("sha256", String(ADMIN_SESSION_SECRET ?? "")).update(sessionId).digest("hex");
}

function verifySession(token) {
  if (!token || typeof token !== "string") return false;
  const sep = token.lastIndexOf(".");
  if (sep <= 0) return false;
  const sessionId = token.slice(0, sep);
  const signature = token.slice(sep + 1);
  if (!sessionId || !signature) return false;

  const expected = signSession(sessionId);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASS_HASH || !ADMIN_SESSION_SECRET) {
    res.status(500).json({ ok: false, error: "Admin auth no configurado (env missing)." });
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["admin_session"];
  if (!verifySession(token)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }
  next();
}

app.get("/api/admin/me", (req, res) => {
  try {
    if (!ADMIN_SESSION_SECRET) return res.json({ ok: false });
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies["admin_session"];
    return res.json({ ok: verifySession(token) });
  } catch {
    return res.json({ ok: false });
  }
});

app.post("/api/admin/login", (req, res) => {
  try {
    if (!ADMIN_PASS_HASH || !ADMIN_SESSION_SECRET) {
      res.status(500).json({ ok: false, error: "Admin auth no configurado (env missing)." });
      return;
    }
    const body = req.body || {};
    const pass = body.password;
    if (typeof pass !== "string" || pass.length < 1) {
      res.status(400).json({ ok: false, error: "Falta password" });
      return;
    }
    const hash = sha256Hex(pass);
    if (hash !== ADMIN_PASS_HASH) {
      res.status(403).json({ ok: false, error: "Contraseña incorrecta" });
      return;
    }
    const ts = Date.now();
    const rand = crypto.randomBytes(16).toString("hex");
    const sessionId = `${ts}_${rand}`;
    const signature = signSession(sessionId);
    const token = `${sessionId}.${signature}`;

    // Cookie de sesión (HttpOnly para que JS no la lea)
    const isHttps = Boolean(req.secure || req.headers["x-forwarded-proto"] === "https");
    res.setHeader(
      "Set-Cookie",
      `admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}${isHttps ? "; Secure" : ""}`
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/admin/login error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabase = USE_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

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

async function getStateSupabase() {
  if (!supabase) return data;
  const { data: row, error } = await supabase.from("app_state").select("payload").eq("id", "default").single();
  if (error) {
    // Si no existe la fila, la inicializamos.
    const code = String(error?.code || "");
    const msg = String(error?.message || "").toLowerCase();
    if (code === "PGRST116" || msg.includes("no rows") || msg.includes("0 rows")) {
      const init = { exportedAt: Date.now(), tournaments: [] };
      await supabase.from("app_state").upsert({ id: "default", payload: init });
      return init;
    }
    throw error;
  }
  return row?.payload ?? { exportedAt: Date.now(), tournaments: [] };
}

/** @type {Set<import("express").Response>} */
const sseClients = new Set();

function persist(next) {
  const run = async () => {
    data = next;
    if (USE_SUPABASE) {
      // Guarda estado completo (incluye torneos, llaves y resultados)
      await supabase.from("app_state").upsert({ id: "default", payload: next });
    } else {
      try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
      } catch {
        // ignore
      }
    }
    // broadcast SSE (solo a conexiones del mismo runtime)
    const payload = `data: ${JSON.stringify({ type: "data", data })}\n\n`;
    for (const res of sseClients) {
      res.write(payload);
    }
  };
  return run().catch((e) => {
    console.error("persist() failed:", e);
    if (USE_SUPABASE) throw e;
  });
}

app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, message: "Torneos CS API" });
});

app.get("/api/data", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (USE_SUPABASE) {
    getStateSupabase()
      .then((s) => {
        res.json(s);
      })
      .catch(() => {
        res.status(500).json({ exportedAt: Date.now(), tournaments: [] });
      });
    return;
  }
  res.json(data);
});

app.post("/api/data", (req, res) => {
  // Proteger publicar al público (nivel 2)
  if (!ADMIN_PASS_HASH || !ADMIN_SESSION_SECRET) {
    res.status(500).json({ ok: false, error: "Admin auth no configurado (env missing)." });
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (!verifySession(cookies["admin_session"])) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }
  const body = req.body;
  if (!body || typeof body !== "object" || !Array.isArray(body.tournaments)) {
    res.status(400).json({ ok: false, error: "Formato inválido" });
    return;
  }
  const clearAll = Boolean(body.clearAll);
  const incomingTournaments = body.tournaments;

  // Evita que un publish "vacío" (tournaments: []) sobreescriba el estado real en Supabase.
  if (USE_SUPABASE && Array.isArray(incomingTournaments) && incomingTournaments.length === 0 && !clearAll) {
    getStateSupabase()
      .then((current) => persist(current))
      .then(() => res.json({ ok: true, skipped: true }))
      .catch(() => res.status(500).json({ ok: false, error: "No se pudo persistir en Supabase" }));
    return;
  }

  const next = { exportedAt: Date.now(), tournaments: incomingTournaments };
  persist(next)
    .then(() => res.json({ ok: true }))
    .catch(() => res.status(500).json({ ok: false, error: "No se pudo persistir en Supabase" }));
});

/** Inscripción pública: agregar equipo a un torneo (confirmed: false) */
const PLAYERS_BY_MODE = { "1v1": 1, "2v2": 2, "5v5": 5 };
function handleRegister(req, res) {
  const run = async () => {
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
    const current = USE_SUPABASE ? await getStateSupabase() : data;
    const tournaments = Array.isArray(current.tournaments) ? current.tournaments : [];
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
      ...current,
      exportedAt: Date.now(),
      tournaments: (current.tournaments || []).map((t) =>
        t && t.id === tournamentId ? { ...t, teams: [...(t.teams || []), newTeam] } : t
      ),
    };
    // Nota: mantenemos el comportamiento previo, persistiendo el estado completo.
    await persist(next);
    res.json({ ok: true, teamId: newTeam.id });
  };
  run().catch((err) => {
    console.error("/api/register error:", err);
    res.status(500).json({ ok: false, error: "Error en el servidor. Revisá la consola." });
  });
}
app.post("/api/register", handleRegister);
app.post("/api/register/", handleRegister);

app.get("/api/waiting-room", async (req, res) => {
  try {
    const tournamentId = String(req.query.tournamentId ?? "").trim();
    const teamId = String(req.query.teamId ?? "").trim();
    if (!tournamentId || !teamId) {
      res.status(400).json({ ok: false, error: "Faltan tournamentId o teamId" });
      return;
    }

    const current = USE_SUPABASE ? await getStateSupabase() : data;
    const tournaments = Array.isArray(current?.tournaments) ? current.tournaments : [];
    const t = tournaments.find((x) => x?.id === tournamentId);
    if (!t) {
      res.status(404).json({ ok: false, error: "Torneo no encontrado" });
      return;
    }

    const teams = Array.isArray(t.teams) ? t.teams : [];
    const own = teams.find((x) => x?.id === teamId) ?? null;
    if (!own) {
      res.status(404).json({ ok: false, error: "Equipo no encontrado en este torneo" });
      return;
    }

    const rounds = Array.isArray(t?.bracket?.rounds) ? t.bracket.rounds : [];
    const firstRound = rounds.find((r) => Number(r?.round) === 1) ?? rounds[0] ?? null;
    const matches = Array.isArray(firstRound?.matches) ? firstRound.matches : [];
    const match = matches.find((m) => m?.a?.teamId === teamId || m?.b?.teamId === teamId) ?? null;

    const rivalTeamName = match
      ? (match.a?.teamId === teamId ? (match.b?.teamName ?? null) : (match.a?.teamName ?? null))
      : null;
    const ownSide = match
      ? (match.a?.teamId === teamId ? "a" : "b")
      : null;
    const winner = match?.result?.winner ?? null;
    const status = !match
      ? "pendiente"
      : winner
        ? (winner === ownSide ? "ganado" : "perdido")
        : "listo";

    const connectIp = t.connectIp ?? null;
    const connectPort = t.connectPort ?? null;
    const connectAddress = connectIp && connectPort ? `${connectIp}:${connectPort}` : null;
    const connectUrl = connectAddress ? `steam://connect/${connectAddress}` : null;

    res.json({
      ok: true,
      tournament: {
        id: t.id,
        name: t.name,
        mode: t.mode,
        platform: t.platform ?? null,
        server: t.server ?? null,
      },
      team: {
        id: own.id,
        name: own.name,
        players: own.players ?? [],
        confirmed: Boolean(own.confirmed),
      },
      match: match
        ? {
            round: firstRound?.round ?? 1,
            number: match.match ?? null,
            rivalTeamName,
            status,
          }
        : null,
      connection: {
        address: connectAddress,
        connectUrl,
      },
    });
  } catch (err) {
    console.error("/api/waiting-room error:", err);
    res.status(500).json({ ok: false, error: "Error del servidor" });
  }
});

// ---- Static UI routes (explicit) ----
// En Vercel, los archivos fuera de `public/` pueden no estar disponibles para
// el resolver dinámico con fs. Para que `/admin/` y `/inscribirse/` funcionen,
// exponemos rutas explícitas para sus assets HTML/CSS/JS.
function sendIfExists(filePath, res) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.sendFile(filePath);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

const ROOT_ADMIN_DIR = path.join(__dirname, "admin");
const ROOT_INSCRIBIRSE_DIR = path.join(__dirname, "inscribirse");
const ROOT_SALA_DIR = path.join(__dirname, "sala");

function sendAdminIndex(res) {
  const ok = sendIfExists(path.join(ROOT_ADMIN_DIR, "index.html"), res);
  if (!ok) res.status(404).send("Cannot GET /admin/");
}

app.get("/admin", (req, res) => sendAdminIndex(res));
app.get("/admin/", (req, res) => sendAdminIndex(res));
app.get("/admin/index.html", (req, res) => sendAdminIndex(res));
app.get("/admin/app.js", (req, res) => {
  const ok = sendIfExists(path.join(ROOT_ADMIN_DIR, "app.js"), res);
  if (!ok) res.status(404).send("Cannot GET /admin/app.js");
});
app.get("/admin/styles.css", (req, res) => {
  const ok = sendIfExists(path.join(ROOT_ADMIN_DIR, "styles.css"), res);
  if (!ok) res.status(404).send("Cannot GET /admin/styles.css");
});

function sendInscribirseIndex(res) {
  const ok = sendIfExists(path.join(ROOT_INSCRIBIRSE_DIR, "index.html"), res);
  if (!ok) res.status(404).send("Cannot GET /inscribirse/");
}

app.get("/inscribirse", (req, res) => sendInscribirseIndex(res));
app.get("/inscribirse/", (req, res) => sendInscribirseIndex(res));
app.get("/inscribirse/index.html", (req, res) => sendInscribirseIndex(res));
app.get("/inscribirse/app.js", (req, res) => {
  const ok = sendIfExists(path.join(ROOT_INSCRIBIRSE_DIR, "app.js"), res);
  if (!ok) res.status(404).send("Cannot GET /inscribirse/app.js");
});
app.get("/inscribirse/styles.css", (req, res) => {
  const ok = sendIfExists(path.join(ROOT_INSCRIBIRSE_DIR, "styles.css"), res);
  if (!ok) res.status(404).send("Cannot GET /inscribirse/styles.css");
});

function sendSalaIndex(res) {
  const ok = sendIfExists(path.join(ROOT_SALA_DIR, "index.html"), res);
  if (!ok) res.status(404).send("Cannot GET /sala/");
}

app.get("/sala", (req, res) => sendSalaIndex(res));
app.get("/sala/", (req, res) => sendSalaIndex(res));
app.get("/sala/index.html", (req, res) => sendSalaIndex(res));
app.get("/sala/app.js", (req, res) => {
  const ok = sendIfExists(path.join(ROOT_SALA_DIR, "app.js"), res);
  if (!ok) res.status(404).send("Cannot GET /sala/app.js");
});
app.get("/sala/styles.css", (req, res) => {
  const ok = sendIfExists(path.join(ROOT_SALA_DIR, "styles.css"), res);
  if (!ok) res.status(404).send("Cannot GET /sala/styles.css");
});

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
// Catch-all con app.use para evitar patrones inválidos en Express 5.
app.use((req, res) => {
  try {
    const reqPath = decodeURIComponent(req.path || "/");
    const relativePath = reqPath.replace(/^\/+/, "");
    const wanted = relativePath === "" ? "index.html" : relativePath;
    // Normalizamos a uno o varios targets: archivo directo o index de carpeta.
    const targets = [];
    if (wanted === "index.html") {
      targets.push("index.html");
    } else {
      // Quitamos trailing slashes para evitar dobles barras (admin//index.html).
      const cleaned = wanted.replace(/\/+$/, "");
      targets.push(cleaned);
      targets.push(`${cleaned}/index.html`);
    }

    // En Vercel, __dirname puede no contener los archivos del proyecto.
    // Usamos process.cwd() como "base" real del runtime.
    const cwdBase = process.cwd();
    // En `/` queremos sí o sí el menú principal (root `index.html`),
    // incluso si `cwd` apunta a `public/`.
    if (reqPath === "/" || reqPath === "") {
      const rootHtmlCandidates = [
        path.join(__dirname, "index.html"),
        path.join(cwdBase, "index.html"),
      ];
      for (const filePath of rootHtmlCandidates) {
        if (filePath.startsWith(__dirname) || filePath.startsWith(cwdBase)) {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.sendFile(filePath);
            return;
          }
        }
      }
      res.status(404).send("Cannot GET /");
      return;
    }
    // Priorizamos la raíz del proyecto. En Vercel `cwd` puede apuntar a `public/`
    // y hacer que `/` cargue el index equivocado.
    const bases = [
      __dirname,
      path.join(__dirname, ".."),
      cwdBase,
      path.join(cwdBase, ".."),
      path.join(__dirname, "public"),
      path.join(cwdBase, "public"),
      path.join(__dirname, "..", "public"),
    ];

    // Seguridad anti traversal: el candidato debe estar dentro de una de las bases esperadas.
    const safeBases = [
      cwdBase,
      path.join(cwdBase, ".."),
      __dirname,
      path.join(__dirname, ".."),
      path.join(cwdBase, "public"),
      path.join(__dirname, "public"),
    ];

    for (const t of targets) {
      const candidates = bases.map((b) => path.join(b, t));
      for (const filePath of candidates) {
        if (!safeBases.some((sb) => filePath.startsWith(sb))) continue;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.sendFile(filePath);
          return;
        }
      }
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

