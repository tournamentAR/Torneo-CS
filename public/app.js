(() => {
  const el = {
    tournamentList: document.getElementById("tournamentList"),
    selectedTournamentEmpty: document.getElementById("selectedTournamentEmpty"),
    selectedTournamentPanel: document.getElementById("selectedTournamentPanel"),
    selectedTournamentTitle: document.getElementById("selectedTournamentTitle"),
    selectedTournamentMeta: document.getElementById("selectedTournamentMeta"),
    teamList: document.getElementById("teamList"),
    bracket: document.getElementById("bracket"),
    bracketHint: document.getElementById("bracketHint"),
    btnFull: document.getElementById("btnFull"),
  };

  /** @type {{exportedAt:number,tournaments:any[]}|null} */
  let data = null;
  /** @type {string|null} */
  let selectedId = null;
  let pollTimer = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(ts) {
    try {
      return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  function modeToPlayers(mode) {
    if (mode === "1v1") return 1;
    if (mode === "2v2") return 2;
    return 5;
  }

  function getSelectedTournament() {
    if (!data || !selectedId) return null;
    return data.tournaments.find((t) => t.id === selectedId) ?? null;
  }

  function setSelected(id) {
    selectedId = id;
    render();
  }

  function renderTournamentList() {
    if (!data || data.tournaments.length === 0) {
      el.tournamentList.innerHTML = `<div class="empty"><p><strong>Sin torneos</strong>. Crea un torneo en el panel <code>/admin</code> y aparecerá aquí automáticamente.</p></div>`;
      return;
    }

    el.tournamentList.innerHTML = data.tournaments
      .map((t) => {
        const confirmed = (t.teams ?? []).filter((x) => x.confirmed).length;
        const total = (t.teams ?? []).length;
        const selected = t.id === selectedId;
        return `
          <div class="item" data-tid="${t.id}" role="button" aria-pressed="${selected ? "true" : "false"}">
            <div class="item__main">
              <p class="item__title">${escapeHtml(t.name)}</p>
              <p class="item__meta">${escapeHtml(t.mode)} · cupo ${t.cap} · equipos ${total} (confirmados ${confirmed})</p>
            </div>
            <div class="pill"><strong>${selected ? "Viendo" : "Ver"}</strong></div>
          </div>
        `;
      })
      .join("");
  }

  function renderSelectedTournament() {
    const t = getSelectedTournament();
    if (!t) {
      el.selectedTournamentEmpty.classList.remove("hidden");
      el.selectedTournamentPanel.classList.add("hidden");
      return;
    }

    el.selectedTournamentEmpty.classList.add("hidden");
    el.selectedTournamentPanel.classList.remove("hidden");
    el.selectedTournamentTitle.textContent = t.name;
    el.selectedTournamentMeta.textContent = `${t.mode} · ${modeToPlayers(t.mode)} jugadores por equipo · cupo ${t.cap} · creado ${formatDate(t.createdAt)}`;

    renderTeamList(t);
    renderBracket(t);
  }

  function renderTeamList(t) {
    const teams = (t.teams ?? []).slice().sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.name.localeCompare(b.name));
    if (teams.length === 0) {
      el.teamList.innerHTML = `<div class="empty"><p><strong>Sin equipos</strong>.</p></div>`;
      return;
    }
    el.teamList.innerHTML = teams
      .map((team) => {
        const players = team.players ?? [];
        const playersText = players.length ? players.map((p) => escapeHtml(p)).join(", ") : "";
        return `<div class="item item--teamPublic" style="cursor:default">
          <div class="item__main">
            <p class="item__title">${escapeHtml(team.name)}</p>
            <p class="item__meta">${team.confirmed ? "Confirmado" : "Pendiente"}${playersText ? " · " + playersText : ""}</p>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderBracket(t) {
    const bracket = t.bracket ?? null;
    if (!bracket) {
      el.bracket.innerHTML = `<div class="empty"><p><strong>Sin llave</strong>.</p></div>`;
      el.bracketHint.textContent = "";
      return;
    }

    el.bracketHint.textContent = `Generada: ${formatDate(bracket.generatedAt)} · Tamaño: ${bracket.size}`;
    el.bracket.innerHTML = renderBracketLuma(bracket);
  }

  function renderBracketLuma(bracket) {
    const rounds = bracket.rounds ?? [];
    if (rounds.length === 0) return `<div class="empty"><p><strong>Sin llave</strong>.</p></div>`;

    const totalRounds = rounds.length;
    const size = Number(bracket.size ?? 0) || 8;

    // Layout constants (SVG units)
    const padX = 40;
    const padY = 40;
    const colGap = 170;
    const centerGap = 220;
    const stepBase = 42; // vertical base step

    const rectW = 120;
    const rectH = 18;
    const rectGap = 6; // between a/b slots

    const leftCols = totalRounds - 1; // rounds excluding final
    const svgW = padX * 2 + leftCols * colGap * 2 + centerGap;
    const svgH = padY * 2 + stepBase * size;
    const cx = svgW / 2;
    const finalX = cx - rectW / 2;
    const finalRightEdgeX = finalX + rectW;

    /** @type {string[]} */
    const nodes = [];
    /** @type {string[]} */
    const links = [];

    function matchCenterY(roundIndex0, matchIndex0) {
      // roundIndex0: 0 => R1
      const step = stepBase * (2 ** roundIndex0);
      return padY + (matchIndex0 * 2 + 1) * step;
    }

    /** Path "chip" con esquinas cortadas (tipo electrónico) */
    function chipPath(w, h, cut) {
      const c = Math.min(cut, w / 3, h / 2);
      return `M ${c} 0 L ${w - c} 0 L ${w} ${c} L ${w} ${h - c} L ${w - c} ${h} L ${c} ${h} L 0 ${h - c} L 0 ${c} Z`;
    }
    function slotRect(x, y, name, score, isWinner, isDim) {
      const safeName = escapeHtml(name ?? "—");
      const safeScore = escapeHtml(score ?? "");
      const cls = `nodeRect${isWinner ? " winner" : ""}${isDim ? " dim" : ""}`;
      const textX = x + 8;
      const scoreX = x + rectW - 8;
      const textY = y + rectH / 2 + 3.6;
      const scoreY = textY;
      const chip = chipPath(rectW, rectH, 5);
      return `
        <path class="${cls}" d="${chip}" transform="translate(${x},${y})"/>
        <text class="nodeText" x="${textX}" y="${textY}">${truncateSvgText(safeName, 16)}</text>
        ${safeScore ? `<text class="nodeScore" x="${scoreX}" y="${scoreY}" text-anchor="end">${safeScore}</text>` : ``}
      `;
    }

    function curve(x1, y1, x2, y2, hot) {
      const dist = Math.abs(x2 - x1);
      // Evita que los puntos de control se crucen (curva "al revés")
      const dx = Math.min(Math.max(40, dist * 0.55), dist / 2);
      const dir = x2 >= x1 ? 1 : -1;
      const c1x = x1 + dir * dx;
      const c2x = x2 - dir * dx;
      return `<path class="linkPath${hot ? " hot" : ""}" d="M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}" />`;
    }

    function matchWinnerName(m) {
      const w = m?.result?.winner;
      if (w === "a") return m?.a?.teamName ?? null;
      if (w === "b") return m?.b?.teamName ?? null;
      return null;
    }

    function matchWinnerSide(m) {
      const w = m?.result?.winner;
      return w === "a" || w === "b" ? w : null;
    }

    // Build left and right sides (mirrored)
    for (let r0 = 0; r0 < totalRounds - 1; r0++) {
      const round = rounds[r0];
      const matches = round?.matches ?? [];
      const half = Math.floor(matches.length / 2);
      const leftMatches = matches.slice(0, half);
      const rightMatches = matches.slice(half);

      const xLeft = padX + r0 * colGap;
      const xRight = svgW - padX - rectW - r0 * colGap;

      // Left matches
      for (let i = 0; i < leftMatches.length; i++) {
        const m = leftMatches[i];
        const cy = matchCenterY(r0, i);
        const topY = cy - rectH - rectGap / 2;
        const botY = cy + rectGap / 2;
        const res = m?.result ?? {};
        const wSide = matchWinnerSide(m);
        const aDim = !m?.a?.teamId && !m?.a?.bye;
        const bDim = !m?.b?.teamId && !m?.b?.bye;

        nodes.push(slotRect(xLeft, topY, m?.a?.teamName ?? "—", res.aScore ?? "", wSide === "a", aDim));
        nodes.push(slotRect(xLeft, botY, m?.b?.teamName ?? "—", res.bScore ?? "", wSide === "b", bDim));

        // Link to next round winner slot (center line)
        const winner = matchWinnerName(m);
        const hot = Boolean(winner);
        const outX = xLeft + rectW;
        const outY = cy;
        // Si estamos antes de la final, conectamos directo al borde izquierdo del bloque central
        const nextX = (r0 === totalRounds - 2) ? finalX : (padX + (r0 + 1) * colGap);
        const nextMatchIndex = Math.floor(i / 2);
        const nextCY = matchCenterY(r0 + 1, nextMatchIndex);
        links.push(curve(outX, outY, nextX, nextCY, hot));
      }

      // Right matches (mirrored)
      for (let i = 0; i < rightMatches.length; i++) {
        const m = rightMatches[i];
        const cy = matchCenterY(r0, i);
        const topY = cy - rectH - rectGap / 2;
        const botY = cy + rectGap / 2;
        const res = m?.result ?? {};
        const wSide = matchWinnerSide(m);
        const aDim = !m?.a?.teamId && !m?.a?.bye;
        const bDim = !m?.b?.teamId && !m?.b?.bye;

        nodes.push(slotRect(xRight, topY, m?.a?.teamName ?? "—", res.aScore ?? "", wSide === "a", aDim));
        nodes.push(slotRect(xRight, botY, m?.b?.teamName ?? "—", res.bScore ?? "", wSide === "b", bDim));

        const winner = matchWinnerName(m);
        const hot = Boolean(winner);
        const outX = xRight;
        const outY = cy;
        // Si estamos antes de la final, conectamos al borde derecho del bloque central.
        // Si no, conectamos al borde derecho del siguiente match del lado derecho.
        const nextBoxLeftX = (r0 === totalRounds - 2) ? finalX : (svgW - padX - rectW - (r0 + 1) * colGap);
        const targetX = (r0 === totalRounds - 2) ? finalRightEdgeX : (nextBoxLeftX + rectW);
        const nextMatchIndex = Math.floor(i / 2);
        const nextCY = matchCenterY(r0 + 1, nextMatchIndex);
        links.push(curve(outX, outY, targetX, nextCY, hot));
      }
    }

    // Center final (R = totalRounds)
    const finalRound = rounds[totalRounds - 1];
    const finalMatch = finalRound?.matches?.[0] ?? null;
    const finalCY = matchCenterY(totalRounds - 1, 0);
    if (finalMatch) {
      const res = finalMatch?.result ?? {};
      const wSide = matchWinnerSide(finalMatch);
      const topY = finalCY - rectH - rectGap / 2;
      const botY = finalCY + rectGap / 2;
      nodes.push(slotRect(finalX, topY, finalMatch?.a?.teamName ?? "—", res.aScore ?? "", wSide === "a", false));
      nodes.push(slotRect(finalX, botY, finalMatch?.b?.teamName ?? "—", res.bScore ?? "", wSide === "b", false));
    } else {
      nodes.push(slotRect(finalX, finalCY - rectH / 2, "FINAL", "", false, true));
    }

    const champ = getChampionNameFromBracket(bracket);
    const badgeY = padY * 0.75;
    const trophyY = badgeY + 20;
    const trophySize = 58;
    const trophyCx = cx;
    const trophyCy = trophyY + trophySize / 2;
    const trophyPath = `
      <g class="trophySvg" transform="translate(${trophyCx},${trophyCy}) scale(1.2)" aria-hidden="true">
        <!-- Copa: taza ancha arriba, estrecha abajo -->
        <path fill="rgba(255,215,100,.95)" stroke="rgba(180,120,0,.5)" stroke-width="0.8" d="M -14 -20 L -12 2 Q -12 8 0 8 Q 12 8 12 2 L 14 -20 Q 14 -24 0 -24 Q -14 -24 -14 -20 Z"/>
        <!-- Borde superior de la copa -->
        <ellipse cx="0" cy="-20" rx="12" ry="4" fill="rgba(255,235,160,.9)" stroke="rgba(180,120,0,.4)"/>
        <!-- Asas -->
        <path fill="none" stroke="rgba(255,200,80,.9)" stroke-width="2" d="M -12 0 Q -22 -4 -22 -12 Q -22 -20 -12 -18"/>
        <path fill="none" stroke="rgba(255,200,80,.9)" stroke-width="2" d="M 12 0 Q 22 -4 22 -12 Q 22 -20 12 -18"/>
        <!-- Pedestal -->
        <path fill="rgba(220,160,40,.85)" stroke="rgba(160,100,0,.4)" d="M -4 8 L -6 14 L 6 14 L 4 8 Z"/>
        <path fill="rgba(200,140,30,.9)" stroke="rgba(140,80,0,.35)" d="M -8 14 L -10 18 L 10 18 L 8 14 Z"/>
      </g>`;

    return `
      <div class="bracketSvgWrap" title="Bracket estilo Luma">
        <svg class="bracketSvg" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="Llave del torneo">
          <text class="centerBadge" x="${cx}" y="${badgeY}" text-anchor="middle">GANADOR</text>
          ${trophyPath}
          ${links.join("\n")}
          ${nodes.join("\n")}
          ${
            champ
              ? `<path class="nodeRect winner" d="${chipPath(170, 22, 5)}" transform="translate(${cx - 170 / 2},${svgH - 44})"/>
                 <text class="nodeText" x="${cx}" y="${svgH - 28}" text-anchor="middle">CAMPEÓN: ${truncateSvgText(escapeHtml(champ), 18)}</text>`
              : `<path class="nodeRect dim" d="${chipPath(170, 22, 5)}" transform="translate(${cx - 170 / 2},${svgH - 44})"/>
                 <text class="nodeText" x="${cx}" y="${svgH - 28}" text-anchor="middle">CAMPEÓN: por definir</text>`
          }
        </svg>
      </div>
    `;
  }

  function getChampionNameFromBracket(bracket) {
    const rounds = bracket?.rounds ?? [];
    const last = rounds[rounds.length - 1];
    const fm = last?.matches?.[0];
    const w = fm?.result?.winner;
    if (w === "a") return fm?.a?.teamName ?? null;
    if (w === "b") return fm?.b?.teamName ?? null;
    return null;
  }

  function truncateSvgText(text, maxLen) {
    const t = String(text ?? "");
    if (t.length <= maxLen) return t;
    return t.slice(0, Math.max(0, maxLen - 1)) + "…";
  }

  function initials(name) {
    const n = String(name ?? "").trim();
    if (!n || n === "—" || n === "Por definir") return "?";
    if (n.toUpperCase() === "BYE") return "BY";
    const parts = n.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "?";
    const b = parts.length > 1 ? parts[1]?.[0] : (parts[0]?.[1] ?? "");
    return (a + b).toUpperCase().slice(0, 2);
  }

  function render() {
    renderTournamentList();
    renderSelectedTournament();
  }

  async function loadFromPublicJson() {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || typeof json !== "object" || !Array.isArray(json.tournaments)) throw new Error("Formato inválido");
      data = json;
      selectedId = data.tournaments[0]?.id ?? null;
      render();
    } catch {
      data = { exportedAt: Date.now(), tournaments: [] };
      selectedId = null;
      render();
      // Si el fetch inicial falla (o cae con lista vacía), igual intentamos en background.
      startPolling();
    }
  }

  async function pollOnce() {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || typeof json !== "object" || !Array.isArray(json.tournaments)) return;

      data = json;
      if (!selectedId) selectedId = data.tournaments[0]?.id ?? null;
      if (selectedId && !data.tournaments.some((t) => t.id === selectedId)) {
        selectedId = data.tournaments[0]?.id ?? null;
      }
      render();
    } catch {
      // ignore
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollOnce();
    pollTimer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      pollOnce();
    }, 4000);
  }

  function connectStream() {
    try {
      const es = new EventSource("/api/stream");
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === "data" || msg?.type === "hello") {
            const next = msg.data;
            if (next && Array.isArray(next.tournaments)) {
              data = next;
              if (!selectedId) selectedId = data.tournaments[0]?.id ?? null;
              // si el torneo seleccionado ya no existe, elegimos el primero
              if (selectedId && !data.tournaments.some((t) => t.id === selectedId)) {
                selectedId = data.tournaments[0]?.id ?? null;
              }
              render();
            }
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        // SSE en Vercel puede fallar por streaming. Usamos polling como fallback.
        try {
          es.close();
        } catch {}
        startPolling();
      };
    } catch {
      // ignore
    }
  }

  el.tournamentList.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const item = target.closest(".item[data-tid]");
    if (!item) return;
    setSelected(item.getAttribute("data-tid"));
  });

  el.btnFull.addEventListener("click", () => {
    document.body.classList.toggle("fullscreen");
  });

  // Init
  loadFromPublicJson();
  connectStream();
  // Fallback adicional en caso de que SSE no actualice.
  startPolling();
})();

