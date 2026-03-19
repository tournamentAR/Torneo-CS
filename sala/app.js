(function () {
  const $ = (id) => document.getElementById(id);
  const loading = $("loading");
  const errorBox = $("errorBox");
  const errorText = $("errorText");
  const roomCard = $("roomCard");
  const matchMeta = $("matchMeta");
  const teamName = $("teamName");
  const rivalName = $("rivalName");
  const matchStatus = $("matchStatus");
  const serverAddress = $("serverAddress");
  const btnConnect = $("btnConnect");

  function getParams() {
    const sp = new URLSearchParams(window.location.search);
    return {
      tournamentId: (sp.get("tournamentId") || "").trim(),
      teamId: (sp.get("teamId") || "").trim(),
    };
  }

  function setError(msg) {
    loading.classList.add("hidden");
    roomCard.classList.add("hidden");
    errorBox.classList.remove("hidden");
    errorText.textContent = msg;
  }

  function statusText(s) {
    if (s === "ganado") return "Ganaste este cruce";
    if (s === "perdido") return "Resultado finalizado";
    if (s === "listo") return "Listo para jugar";
    return "Pendiente de asignación";
  }

  async function loadRoom() {
    const { tournamentId, teamId } = getParams();
    if (!tournamentId || !teamId) {
      setError("Faltan datos de sala. Volvé a inscribirte o pedí el link al organizador.");
      return;
    }

    try {
      const url = `/api/waiting-room?tournamentId=${encodeURIComponent(tournamentId)}&teamId=${encodeURIComponent(teamId)}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No se pudo cargar la sala.");
        return;
      }

      loading.classList.add("hidden");
      errorBox.classList.add("hidden");
      roomCard.classList.remove("hidden");

      const t = json.tournament || {};
      const own = json.team || {};
      const m = json.match || {};
      const conn = json.connection || {};

      matchMeta.textContent = `${t.name || "Torneo"} · ${t.mode || ""} · ${t.server || "Servidor por definir"}`;
      teamName.textContent = own.name || "Tu equipo";
      rivalName.textContent = m.rivalTeamName || "Por definir";
      matchStatus.textContent = statusText(m.status);
      serverAddress.textContent = conn.address || "Sin asignar";

      if (conn.connectUrl) {
        btnConnect.href = conn.connectUrl;
        btnConnect.classList.remove("disabled");
        btnConnect.setAttribute("aria-disabled", "false");
      } else {
        btnConnect.href = "#";
        btnConnect.classList.add("disabled");
        btnConnect.setAttribute("aria-disabled", "true");
      }
    } catch {
      setError("Error de conexión al cargar la sala.");
    }
  }

  loadRoom();
})();

