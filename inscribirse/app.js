(function () {
  const PLAYERS_BY_MODE = { "1v1": 1, "2v2": 2, "5v5": 5 };

  const $ = (id) => document.getElementById(id);
  const loading = $("loading");
  const noTournaments = $("noTournaments");
  const form = $("formInscripcion");
  const selectTorneo = $("selectTorneo");
  const torneoMeta = $("torneoMeta");
  const torneoDetalle = $("torneoDetalle");
  const torneoNombreDisp = $("torneoNombreDisp");
  const torneoPrecioDisp = $("torneoPrecioDisp");
  const torneoPlataformaDisp = $("torneoPlataformaDisp");
  const torneoServidorDisp = $("torneoServidorDisp");
  const teamName = $("teamName");
  const repNumber = $("repNumber");
  const discord = $("discord");
  const playersList = $("playersList");
  const success = $("success");
  const waitingRoomLink = $("waitingRoomLink");
  const resumeRoomCard = $("resumeRoomCard");
  const resumeRoomLink = $("resumeRoomLink");
  const wrongServerBanner = $("wrongServerBanner");
  const submitError = $("submitError");
  const submitErrorText = $("submitErrorText");

  const RULES_STORAGE_KEY = "mercRulesAccepted_v1";
  const mercModal = $("mercRulesModal");
  const mercCheckbox = $("mercRulesAgree");
  const mercContinue = $("mercRulesContinue");

  const DEFAULT_ORIGIN = "http://localhost:5173";
  const LAST_ROOM_KEY = "cs_last_waiting_room_v1";

  function getOriginForLinks() {
    try {
      if (typeof window !== "undefined" && window.location && window.location.origin) return window.location.origin;
    } catch {}
    return DEFAULT_ORIGIN;
  }

  function getCorrectUrl() {
    return getOriginForLinks() + "/inscribirse/";
  }

  function buildRoomUrl(tournamentId, teamId) {
    return `../sala/?tournamentId=${encodeURIComponent(tournamentId)}&teamId=${encodeURIComponent(teamId)}`;
  }

  function saveLastRoom(tournamentId, teamId) {
    try {
      localStorage.setItem(
        LAST_ROOM_KEY,
        JSON.stringify({ tournamentId, teamId, savedAt: Date.now() })
      );
    } catch {}
  }

  function loadLastRoom() {
    try {
      const raw = localStorage.getItem(LAST_ROOM_KEY);
      if (!raw) return null;
      const json = JSON.parse(raw);
      if (!json || typeof json !== "object") return null;
      const tournamentId = String(json.tournamentId || "").trim();
      const teamId = String(json.teamId || "").trim();
      if (!tournamentId || !teamId) return null;
      return { tournamentId, teamId };
    } catch {
      return null;
    }
  }

  function hasMercAccepted() {
    try {
      return localStorage.getItem(RULES_STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setFormLocked(locked) {
    if (!form) return;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = locked;
    if (locked) {
      form.classList.add("mercLocked");
    } else {
      form.classList.remove("mercLocked");
    }
  }

  function syncContinueDisabled() {
    if (!mercContinue || !mercCheckbox) return;
    const ok = mercCheckbox.checked === true;
    mercContinue.disabled = !ok;
    mercContinue.classList.toggle("is-enabled", ok);
  }

  function openMercModal() {
    if (!mercModal || !mercCheckbox || !mercContinue) return;
    mercCheckbox.checked = false;
    syncContinueDisabled();
    mercModal.classList.remove("hidden");
    mercModal.setAttribute("aria-hidden", "false");
    setFormLocked(true);
  }

  function closeMercModalAndAccept() {
    if (!mercModal || !mercCheckbox || !mercContinue) return;
    try {
      localStorage.setItem(RULES_STORAGE_KEY, "1");
    } catch (e) {}
    mercModal.classList.add("hidden");
    mercModal.setAttribute("aria-hidden", "true");
    setFormLocked(false);
  }

  // Se ejecuta apenas carga el JS para bloquear el formulario si hace falta.
  if (mercModal && mercCheckbox && mercContinue) {
    mercContinue.disabled = true;
    syncContinueDisabled();

    mercCheckbox.addEventListener("change", syncContinueDisabled);
    mercContinue.addEventListener("click", function () {
      if (mercContinue.disabled) return;
      closeMercModalAndAccept();
    });

    if (!hasMercAccepted()) {
      openMercModal();
    }
  }

  function isCorrectServer() {
    if (typeof window === "undefined" || window.location.protocol === "file:") return false;
    // En Vercel u otras integraciones, el origen cambia. Dejamos que el fetch a /api/data
    // sea el que determine si el servidor realmente responde.
    return true;
  }

  let tournaments = [];

  /** Si no viene isFree del servidor, se asume gratis (torneos viejos). */
  function isTournamentFree(t) {
    return t.isFree !== false;
  }

  function inscriptionText(t) {
    if (isTournamentFree(t)) return "Gratis";
    const fee = Number(t.fee);
    const n = Number.isFinite(fee) ? fee : 0;
    return `$${n}`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T12:00:00");
      return d.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return dateStr;
    }
  }

  function renderTournamentOptions() {
    const open = tournaments.filter((t) => (t.teams || []).length < t.cap);
    if (open.length === 0) {
      loading.classList.add("hidden");
      noTournaments.classList.remove("hidden");
      return;
    }
    loading.classList.add("hidden");
    noTournaments.classList.add("hidden");
    form.classList.remove("hidden");

    selectTorneo.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— Elegir torneo —";
    selectTorneo.appendChild(opt0);
    for (const t of open) {
      const opt = document.createElement("option");
      opt.value = t.id;
      const date = formatDate(t.dateAt);
      const spots = t.cap - (t.teams || []).length;
      const precio = inscriptionText(t);
      const plataforma = String(t.platform ?? "xplay.gg").trim();
      const servidor = String(t.server ?? "Buenos Aires").trim();
      opt.textContent = `${t.name} · ${t.mode} · ${precio} · ${plataforma} · ${servidor}${date ? " · " + date : ""} (${spots} cupo${spots !== 1 ? "s" : ""})`;
      selectTorneo.appendChild(opt);
    }
    updateTorneoMeta();
    renderPlayerInputs(null);
  }

  function updateTorneoMeta() {
    const id = selectTorneo.value;
    const t = tournaments.find((x) => x.id === id);
    if (!t) {
      torneoMeta.textContent = "";
      if (torneoDetalle) torneoDetalle.classList.add("hidden");
      return;
    }
    const n = PLAYERS_BY_MODE[t.mode] ?? 5;
    torneoMeta.textContent = `Modalidad ${t.mode}: ${n} jugador${n !== 1 ? "es" : ""}.`;
    if (torneoDetalle && torneoNombreDisp && torneoPrecioDisp && torneoPlataformaDisp && torneoServidorDisp) {
      torneoDetalle.classList.remove("hidden");
      torneoNombreDisp.textContent = t.name;
      torneoPrecioDisp.textContent = inscriptionText(t);
      torneoPlataformaDisp.textContent = String(t.platform ?? "xplay.gg").trim();
      torneoServidorDisp.textContent = String(t.server ?? "Buenos Aires").trim();
    }
  }

  function renderPlayerInputs(mode) {
    const n = mode ? (PLAYERS_BY_MODE[mode] ?? 5) : 0;
    playersList.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const label = document.createElement("label");
      label.className = "field";
      const span = document.createElement("span");
      span.className = "field__label";
      span.textContent = `Jugador ${i + 1}`;
      const input = document.createElement("input");
      input.className = "input";
      input.type = "text";
      input.placeholder = `Nombre jugador ${i + 1}`;
      input.name = "player";
      input.required = true;
      input.minLength = 1;
      input.maxLength = 80;
      label.appendChild(span);
      label.appendChild(input);
      playersList.appendChild(label);
    }
  }

  selectTorneo.addEventListener("change", () => {
    const t = tournaments.find((x) => x.id === selectTorneo.value);
    renderPlayerInputs(t ? t.mode : null);
    updateTorneoMeta();
  });

  function getApiBase() {
    if (typeof window === "undefined" || window.location.protocol === "file:") return null;
    return window.location.origin;
  }

  async function load() {
    const lastRoom = loadLastRoom();
    if (lastRoom && resumeRoomCard && resumeRoomLink) {
      resumeRoomLink.href = buildRoomUrl(lastRoom.tournamentId, lastRoom.teamId);
      resumeRoomCard.classList.remove("hidden");
    }

    if (window.location.protocol === "file:") {
      const correctUrl = getCorrectUrl();
      loading.innerHTML = "Abrí esta página desde el servidor: <a href=\"" + correctUrl + "\" style=\"color:#ffb03a\">" + correctUrl + "</a> (ejecutá <code>npm run dev</code> antes).";
      loading.classList.remove("hidden");
      return;
    }
    if (!isCorrectServer()) {
      wrongServerBanner.classList.remove("hidden");
      loading.classList.add("hidden");
      document.getElementById("openCorrectUrl").href = getCorrectUrl();
      return;
    }
    try {
      const base = getApiBase() || "";
      const res = await fetch(base + "/api/data");
      if (res.status === 404) {
        wrongServerBanner.classList.remove("hidden");
        loading.classList.add("hidden");
        return;
      }
      const data = await res.json();
      tournaments = (data && data.tournaments) ? data.tournaments : [];
    } catch {
      tournaments = [];
      const correctUrl = getCorrectUrl();
      loading.innerHTML = "No se pudo conectar. ¿Está corriendo el servidor? Ejecutá en la terminal: <code>npm run dev</code> y recargá. Luego entrá a <a href=\"" + correctUrl + "\" style=\"color:#ffb03a\">" + correctUrl + "</a>.";
      loading.classList.remove("hidden");
      return;
    }
    renderTournamentOptions();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!hasMercAccepted()) {
      openMercModal();
      return;
    }
    if (window.location.protocol === "file:") {
      alert("Ejecutá el servidor (npm run dev) y abrí http://localhost:5173/inscribirse/");
      return;
    }
    const tid = selectTorneo.value;
    const t = tournaments.find((x) => x.id === tid);
    if (!t) return;
    const name = (teamName.value || "").trim();
    const rep = (repNumber?.value || "").trim();
    const disc = (discord?.value || "").trim();
    const playerInputs = playersList.querySelectorAll('input[name="player"]');
    const players = Array.from(playerInputs).map((inp) => (inp.value || "").trim()).filter(Boolean);
    const required = PLAYERS_BY_MODE[t.mode] ?? 5;
    if (players.length !== required) {
      alert(`Este torneo es ${t.mode}: debes cargar exactamente ${required} jugador(es).`);
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Enviando…";
    try {
      const apiBase = getApiBase() || "";
      const res = await fetch(apiBase + "/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournamentId: tid,
          teamName: name,
          repNumber: rep || null,
          discord: disc || null,
          players,
        }),
      });
      let json = {};
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        json = await res.json();
      } else {
        const text = await res.text();
        console.error("API no devolvió JSON:", res.status, text);
      }
      if (!res.ok) {
        submitError.classList.remove("hidden");
        if (res.status === 404) {
          submitErrorText.textContent = "La API no está en este servidor. Hacé clic en el botón de abajo para abrir la página en el servidor correcto (primero ejecutá npm run dev en la terminal).";
          document.getElementById("submitErrorLink").href = getCorrectUrl();
          document.getElementById("submitErrorLink").textContent = "Abrir en localhost:5173";
        } else {
          submitErrorText.textContent = json.error || "Error " + res.status + ". Revisá que el servidor esté corriendo (npm run dev).";
          document.getElementById("submitErrorLink").href = getCorrectUrl();
          document.getElementById("submitErrorLink").textContent = "Abrir en el servidor correcto";
        }
        submitError.scrollIntoView({ behavior: "smooth", block: "start" });
        btn.disabled = false;
        btn.textContent = "Enviar inscripción";
        return;
      }
      submitError.classList.add("hidden");
      form.classList.add("hidden");
      success.classList.remove("hidden");
      if (waitingRoomLink && json?.teamId) {
        const roomUrl = buildRoomUrl(tid, json.teamId);
        waitingRoomLink.href = roomUrl;
        if (resumeRoomCard && resumeRoomLink) {
          resumeRoomLink.href = roomUrl;
          resumeRoomCard.classList.remove("hidden");
        }
        saveLastRoom(tid, json.teamId);
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión. ¿Está corriendo el servidor? Ejecutá en la carpeta del proyecto: npm run dev");
      btn.disabled = false;
      btn.textContent = "Enviar inscripción";
    }
  });

  load();
})();
