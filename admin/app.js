(() => {
  // Panel privado (cliente). Nota: esto NO es seguridad “real” como un backend,
  // pero sirve para ocultarlo y pedir contraseña en tu navegador.

  const STORAGE_KEY = "cs_admin_tournaments_v2";
  const ADMIN_PASS_HASH_KEY = "cs_admin_pass_hash_v1";
  const ADMIN_UNLOCK_KEY = "cs_admin_unlocked_v1";

  /** @typedef {{id:string,name:string,confirmed:boolean,createdAt:number,players:string[],repNumber?:string|null,discord?:string|null}} Team */
  /** @typedef {{aScore:number|null,bScore:number|null,winner:"a"|"b"|null,updatedAt:number|null}} MatchResult */
  /** @typedef {{round:number,match:number}} MatchRef */
  /** @typedef {{seed:number,teamId:string|null,teamName:string,bye:boolean,from?:{ref:MatchRef,side:"a"|"b"}}} BracketSlot */
  /** @typedef {{match:number,a:BracketSlot,b:BracketSlot,result:MatchResult}} BracketMatch */
  /** @typedef {{size:number,rounds:{round:number,title:string,matches:BracketMatch[]}[],generatedAt:number}} Bracket */
  /** @typedef {{id:string,name:string,mode:"1v1"|"2v2"|"5v5",cap:number,createdAt:number,dateAt?:string,platform?:string,server?:string,isFree:boolean,fee?:number|null,teams:Team[],bracket?:Bracket}} Tournament */

  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

  const el = {
    createTournamentForm: $("createTournamentForm"),
    tournamentName: $("tournamentName"),
    tournamentMode: $("tournamentMode"),
    tournamentCap: $("tournamentCap"),
    tournamentDate: $("tournamentDate"),
    tournamentPlatform: $("tournamentPlatform"),
    tournamentServer: $("tournamentServer"),
    tournamentIsFree: $("tournamentIsFree"),
    tournamentFee: $("tournamentFee"),
    tournamentList: $("tournamentList"),

    selectedTournamentEmpty: $("selectedTournamentEmpty"),
    selectedTournamentPanel: $("selectedTournamentPanel"),
    selectedTournamentTitle: $("selectedTournamentTitle"),
    selectedTournamentMeta: $("selectedTournamentMeta"),
    tournamentIsFreeEdit: $("tournamentIsFreeEdit"),
    tournamentFeeEdit: $("tournamentFeeEdit"),
    tournamentPlatformEdit: $("tournamentPlatformEdit"),
    tournamentServerEdit: $("tournamentServerEdit"),
    addTeamHeader: $("addTeamHeader"),

    addTeamForm: $("addTeamForm"),
    teamName: $("teamName"),
    teamList: $("teamList"),

    btnGenerateBracket: $("btnGenerateBracket"),
    btnClearTeams: $("btnClearTeams"),
    btnReset: $("btnReset"),
    btnSeedDemo: $("btnSeedDemo"),
    btnExportPublic: $("btnExportPublic"),
    shuffleToggle: $("shuffleToggle"),

    bracket: $("bracket"),
    bracketHint: $("bracketHint"),
  };

  /** @type {{tournaments:Tournament[],selectedTournamentId:string|null}} */
  let state = loadState();

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function uuid() {
    return (crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}_${Date.now()}`);
  }

  function loadState() {
    // Migración desde v1 si existe
    const v1 = localStorage.getItem("cs_tournaments_v1");
    const v2 = localStorage.getItem(STORAGE_KEY);
    const raw = v2 ?? v1;
    try {
      if (!raw) return { tournaments: [], selectedTournamentId: null };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { tournaments: [], selectedTournamentId: null };
      if (!Array.isArray(parsed.tournaments)) parsed.tournaments = [];
      if (typeof parsed.selectedTournamentId !== "string") parsed.selectedTournamentId = null;
      for (const t of parsed.tournaments) {
        if (typeof t.isFree !== "boolean") t.isFree = true;
        if (t.isFree) t.fee = null;
        if (!t.isFree) {
          const feeNum = Number(t.fee);
          t.fee = Number.isFinite(feeNum) ? feeNum : null;
        }
        if (typeof t.platform !== "string" || !t.platform.trim()) t.platform = "xplay.gg";
        if (typeof t.server !== "string" || !t.server.trim()) t.server = "Buenos Aires";
        for (const team of t.teams ?? []) {
          if (!Array.isArray(team.players)) team.players = [];
        }
      }
      // Normalizar estructura de bracket/result si viene de v1
      for (const t of parsed.tournaments) {
        if (t?.bracket?.rounds) {
          for (const r of t.bracket.rounds) {
            for (const m of r.matches ?? []) {
              if (!m.result) m.result = { aScore: null, bScore: null, winner: null, updatedAt: null };
              if (m.result.updatedAt === undefined) m.result.updatedAt = null;
              // Si viene de una versión vieja sin "from", dejamos tal cual (se regenerará si creas llave de nuevo)
            }
          }
        }
      }
      // Si venía de v1, lo guardamos ya en v2 y limpiamos v1
      if (v1 && !v2) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        localStorage.removeItem("cs_tournaments_v1");
      }
      return parsed;
    } catch {
      return { tournaments: [], selectedTournamentId: null };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // Intento de sincronización automática con el servidor (si existe).
    queueServerSync();
  }

  function clampTournamentCap(cap) {
    const allowed = new Set([4, 8, 16, 32]);
    return allowed.has(cap) ? cap : 8;
  }

  function modeToPlayers(mode) {
    if (mode === "1v1") return 1;
    if (mode === "2v2") return 2;
    return 5;
  }

  function getSelectedTournament() {
    if (!state.selectedTournamentId) return null;
    return state.tournaments.find((t) => t.id === state.selectedTournamentId) ?? null;
  }

  function setSelectedTournament(id) {
    state.selectedTournamentId = id;
    saveState();
    render();
  }

  function removeTournament(id) {
    state.tournaments = state.tournaments.filter((t) => t.id !== id);
    if (state.selectedTournamentId === id) state.selectedTournamentId = null;
    saveState();
    render();
  }

  function upsertTournament(t) {
    const idx = state.tournaments.findIndex((x) => x.id === t.id);
    if (idx === -1) state.tournaments.unshift(t);
    else state.tournaments[idx] = t;
    saveState();
    render();
  }

  function normalizeName(name) {
    return name.trim().replace(/\s+/g, " ");
  }

  function formatTournamentDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T12:00:00");
      return d.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return dateStr;
    }
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  function roundTitle(round, totalRounds) {
    const remaining = totalRounds - round + 1;
    if (remaining === 1) return "Final";
    if (remaining === 2) return "Semifinales";
    if (remaining === 3) return "Cuartos";
    if (remaining === 4) return "Octavos";
    return `Ronda ${round}`;
  }

  /** @returns {MatchResult} */
  function emptyResult() {
    return { aScore: null, bScore: null, winner: null, updatedAt: null };
  }

  /**
   * Genera bracket (estructura; resultados editables desde el panel)
   * @param {Tournament} t
   */
  function generateBracket(t) {
    const confirmed = t.teams.filter((x) => x.confirmed);
    const minTeams = 2;
    if (confirmed.length < minTeams) {
      return { bracket: null, reason: `Confirma al menos ${minTeams} equipos para generar la llave.` };
    }
    if (confirmed.length > t.cap) {
      return { bracket: null, reason: `Hay más equipos confirmados (${confirmed.length}) que el cupo (${t.cap}).` };
    }

    const order = el.shuffleToggle?.checked ? shuffle(confirmed) : [...confirmed];
    const size = nextPow2(Math.min(t.cap, Math.max(2, order.length)));
    const totalRounds = Math.log2(size);

    /** @type {BracketSlot[]} */
    const slots = [];
    for (let i = 0; i < size; i++) {
      const team = order[i] ?? null;
      slots.push({
        seed: i + 1,
        teamId: team?.id ?? null,
        teamName: team?.name ?? "BYE",
        bye: !team,
      });
    }

    /** @type {Bracket["rounds"]} */
    const rounds = [];

    // Round 1 matches
    /** @type {BracketMatch[]} */
    const r1 = [];
    let matchNo = 1;
    for (let i = 0; i < slots.length; i += 2) {
      r1.push({ match: matchNo++, a: slots[i], b: slots[i + 1], result: emptyResult() });
    }
    rounds.push({ round: 1, title: roundTitle(1, totalRounds), matches: r1 });

    // Next rounds: only structure (winners placeholders)
    let prevMatchCount = r1.length;
    for (let r = 2; r <= totalRounds; r++) {
      const matchCount = Math.max(1, Math.floor(prevMatchCount / 2));
      /** @type {BracketMatch[]} */
      const matches = [];
      for (let m = 1; m <= matchCount; m++) {
        /** @type {MatchRef} */
        const leftRef = { round: r - 1, match: (m - 1) * 2 + 1 };
        /** @type {MatchRef} */
        const rightRef = { round: r - 1, match: (m - 1) * 2 + 2 };
        matches.push({
          match: m,
          a: { seed: (m - 1) * 2 + 1, teamId: null, teamName: "Por definir", bye: false, from: { ref: leftRef, side: "a" } },
          b: { seed: (m - 1) * 2 + 2, teamId: null, teamName: "Por definir", bye: false, from: { ref: rightRef, side: "b" } },
          result: emptyResult(),
        });
      }
      rounds.push({ round: r, title: roundTitle(r, totalRounds), matches });
      prevMatchCount = matchCount;
    }

    /** @type {Bracket} */
    const bracket = { size, rounds, generatedAt: Date.now() };
    // Auto-propagar BYE y estados iniciales
    propagateAll(bracket);
    return { bracket, reason: null };
  }

  function formatDate(ts) {
    try {
      return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  function renderTournamentList() {
    const list = state.tournaments;
    if (list.length === 0) {
      el.tournamentList.innerHTML = `<div class="empty"><p><strong>Sin torneos</strong>. Crea uno arriba.</p></div>`;
      return;
    }

    el.tournamentList.innerHTML = list
      .map((t) => {
        const selected = t.id === state.selectedTournamentId;
        const confirmedCount = t.teams.filter((x) => x.confirmed).length;
        const totalCount = t.teams.length;
        const dateStr = t.dateAt ? formatTournamentDate(t.dateAt) : "";
        const meta = [
          t.mode,
          dateStr,
          `cupo ${t.cap}`,
          `equipos ${totalCount} (confirmados ${confirmedCount})`,
          `plataforma ${t.platform ?? "xplay.gg"}`,
          `servidor ${t.server ?? "Buenos Aires"}`,
        ]
          .filter(Boolean)
          .join(" · ");
        const inscriptionPill = t.isFree
          ? `<span class="pill"><strong>Gratis</strong></span>`
          : `<span class="pill"><strong>Pago</strong> $${escapeHtml(t.fee ?? 0)}</span>`;
        return `
          <div class="item" data-tid="${t.id}">
            <div class="item__main">
              <p class="item__title">${escapeHtml(t.name)}</p>
              <p class="item__meta">${meta}</p>
            </div>
            <div class="item__right">
              ${inscriptionPill}
              <button class="btn btn--ghost btn--mini" data-action="select" data-tid="${t.id}" type="button">${selected ? "Seleccionado" : "Elegir"}</button>
              <button class="btn btn--danger btn--mini" data-action="delete" data-tid="${t.id}" type="button">Eliminar</button>
            </div>
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

    const inscriptionText = t.isFree ? "inscripción gratis" : `inscripción $${t.fee ?? 0}`;
    el.selectedTournamentMeta.textContent = `${t.mode} · ${modeToPlayers(t.mode)} jugadores por equipo · cupo ${t.cap} · creado ${formatDate(t.createdAt)} · ${inscriptionText} · ${t.platform ?? "xplay.gg"} · ${t.server ?? "Buenos Aires"}`;
    if (el.addTeamHeader) {
      el.addTeamHeader.textContent = t.isFree ? "Registrar equipo (gratis)" : `Registrar equipo (pago: $${t.fee ?? 0})`;
    }

    // Editor de inscripción (toggle + costo) en el panel
    if (el.tournamentIsFreeEdit) {
      el.tournamentIsFreeEdit.checked = Boolean(t.isFree);
    }
    if (el.tournamentFeeEdit) {
      el.tournamentFeeEdit.disabled = Boolean(t.isFree);
      el.tournamentFeeEdit.value = t.isFree ? "" : String(t.fee ?? "");
    }
    if (el.tournamentPlatformEdit) {
      el.tournamentPlatformEdit.value = t.platform ?? "xplay.gg";
    }
    if (el.tournamentServerEdit) {
      el.tournamentServerEdit.value = t.server ?? "Buenos Aires";
    }

    renderTeamList(t);
    renderBracket(t);
  }

  function renderTeamList(t) {
    if (t.teams.length === 0) {
      el.teamList.innerHTML = `<div class="empty"><p><strong>Sin equipos</strong>. Agrega equipos y confirma los que participen.</p></div>`;
      return;
    }

    const confirmedCount = t.teams.filter((x) => x.confirmed).length;
    const maxPlayers = modeToPlayers(t.mode);
    el.teamList.innerHTML = `
      <div class="pill" style="justify-content:space-between">
        <span>Confirmados</span>
        <strong>${confirmedCount}/${t.cap}</strong>
      </div>
      ${t.teams
        .slice()
        .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.createdAt - b.createdAt)
        .map((team, idx) => {
          const status = team.confirmed ? "Confirmado" : "Pendiente";
          const players = team.players ?? [];
          return `
            <div class="item item--team" data-teamid="${team.id}">
              <div class="teamRow">
                <div class="teamLeft">
                  <span class="badge">#${idx + 1}</span>
                  <div class="teamName">${escapeHtml(team.name)}</div>
                  <span class="pill">${escapeHtml(status)}</span>
                </div>
                <div class="teamActions">
                  <button class="btn btn--mini ${team.confirmed ? "btn--warn" : "btn--ok"}" data-action="toggle-confirm" data-teamid="${team.id}" type="button">
                    ${team.confirmed ? "Desconfirmar" : "Confirmar"}
                  </button>
                  <button class="btn btn--mini btn--danger" data-action="delete-team" data-teamid="${team.id}" type="button">Quitar</button>
                </div>
              </div>
              <div class="teamPlayers">
                <span class="teamPlayers__label">Jugadores (${players.length}/${maxPlayers}):</span>
                ${team.repNumber || team.discord ? `
                  <div class="teamPlayers__label" style="margin-top:8px">
                    Rep: ${escapeHtml(team.repNumber ?? "—")} · Discord: ${escapeHtml(team.discord ?? "—")}
                  </div>
                ` : ``}
                <div class="teamPlayers__list">
                  ${players.map((p, i) => `<span class="playerChip">${escapeHtml(p)} <button type="button" class="playerChip__remove" data-action="remove-player" data-teamid="${team.id}" data-index="${i}" aria-label="Quitar">×</button></span>`).join("")}
                  ${players.length < maxPlayers ? `
                    <form class="teamPlayers__add" data-teamid="${team.id}">
                      <input type="text" class="input input--small" placeholder="Nombre jugador" maxlength="32" />
                      <button type="submit" class="btn btn--mini btn--primary">+</button>
                    </form>
                  ` : ""}
                </div>
              </div>
            </div>
          `;
        })
        .join("")}
    `;
  }

  function renderBracket(t) {
    const bracket = t.bracket ?? null;
    if (!bracket) {
      el.bracket.innerHTML = `<div class="empty"><p><strong>Sin llave</strong>. Confirma equipos y presiona “Generar llave”.</p></div>`;
      el.bracketHint.textContent = "";
      return;
    }

    el.bracketHint.textContent = `Generada: ${formatDate(bracket.generatedAt)} · Tamaño: ${bracket.size} (eliminación directa)`;
    el.bracket.innerHTML = bracket.rounds
      .map((r) => {
        return `
          <div class="round">
            <p class="roundTitle">
              <span>${escapeHtml(r.title)}</span>
              <span class="muted" style="font-family:var(--mono)">R${r.round}</span>
            </p>
            ${r.matches
              .map((m) => renderMatch(r.round, m))
              .join("")}
          </div>
        `;
      })
      .join("");

    const champ = getChampion(bracket);
    if (champ) {
      el.bracket.innerHTML += `
        <div class="round">
          <p class="roundTitle"><span>Campeón</span><span class="muted" style="font-family:var(--mono)">🏆</span></p>
          <div class="match">
            <div class="slot">
              <div class="slot__name">${escapeHtml(champ.teamName)}</div>
              <div class="winnerTag">GANADOR DEL TORNEO</div>
            </div>
          </div>
        </div>
      `;
    }
  }

  function renderMatch(round, match) {
    const canEditScores =
      !(match.a.bye && match.b.bye) &&
      !match.a.bye &&
      !match.b.bye &&
      Boolean(match.a.teamId) &&
      Boolean(match.b.teamId);
    const res = match.result ?? emptyResult();
    const winner = res.winner;
    const showWinner = winner === "a" || winner === "b";

    return `
      <div class="match" data-round="${round}" data-match="${match.match}">
        ${renderSlot(match.a, canEditScores ? res.aScore : null, canEditScores ? "a" : null, winner === "a", !canEditScores)}
        ${renderSlot(match.b, canEditScores ? res.bScore : null, canEditScores ? "b" : null, winner === "b", !canEditScores)}
        ${showWinner ? `<div class="slot" style="border-top:1px solid rgba(255,255,255,.10)"><span class="muted">Ganador</span><span class="winnerTag">${escapeHtml(winner === "a" ? match.a.teamName : match.b.teamName)}</span></div>` : ""}
      </div>
    `;
  }

  function renderSlot(slot, score, side, isWinner, disableScore) {
    const klass = slot.bye ? "slot slot--bye" : "slot";
    const name = slot.teamName;
    const tag = slot.bye ? "BYE" : `Seed ${slot.seed}`;
    const scoreUi =
      side
        ? `<div class="scoreBox">
            <input class="scoreInput" inputmode="numeric" pattern="[0-9]*" placeholder="-" value="${score ?? ""}" data-action="score" data-side="${side}" ${disableScore ? "disabled" : ""} />
            ${isWinner ? `<span class="winnerTag">WIN</span>` : ``}
          </div>`
        : ``;
    return `
      <div class="${klass}">
        <div style="display:flex;flex-direction:column;min-width:0">
          <div class="slot__name">${escapeHtml(name)}</div>
          <div class="slot__tag">${escapeHtml(tag)}</div>
        </div>
        ${scoreUi}
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render() {
    syncCreateInscriptionUI?.();
    renderTournamentList();
    renderSelectedTournament();
  }

  function computeWinner(match) {
    const aBye = !!match.a.bye;
    const bBye = !!match.b.bye;
    if (aBye && !bBye) return "b";
    if (bBye && !aBye) return "a";

    const { aScore, bScore } = match.result;
    if (typeof aScore !== "number" || typeof bScore !== "number") return null;
    if (aScore === bScore) return null; // empate: no definimos ganador
    return aScore > bScore ? "a" : "b";
  }

  function clearScores(match) {
    match.result.aScore = null;
    match.result.bScore = null;
    match.result.winner = null;
    match.result.updatedAt = null;
  }

  /** @param {Bracket} bracket */
  function propagateAll(bracket) {
    // 1) Asegurar que todos los matches tengan result
    for (const r of bracket.rounds) {
      for (const m of r.matches) {
        if (!m.result) m.result = emptyResult();
      }
    }

    // 2) Propagar ganadores hacia adelante, ronda por ronda
    for (let i = 0; i < bracket.rounds.length; i++) {
      const round = bracket.rounds[i];
      for (const match of round.matches) {
        // Auto winner por BYE
        const w = computeWinner(match);
        if (w && match.result.winner !== w) {
          match.result.winner = w;
          if (!match.result.updatedAt) match.result.updatedAt = Date.now();
        }
      }

      const next = bracket.rounds[i + 1];
      if (!next) continue;

      for (const nextMatch of next.matches) {
        // Next match slots: winners from prev round (2m-1) y (2m)
        const left = findMatch(bracket, nextMatch.a?.from?.ref ?? null) ?? findMatch(bracket, { round: next.round - 1, match: (nextMatch.match - 1) * 2 + 1 });
        const right = findMatch(bracket, nextMatch.b?.from?.ref ?? null) ?? findMatch(bracket, { round: next.round - 1, match: (nextMatch.match - 1) * 2 + 2 });

        applyWinnerToSlot(nextMatch.a, left);
        applyWinnerToSlot(nextMatch.b, right);

        // si cambian participantes, limpiamos resultado del próximo match
        const canFight = Boolean(nextMatch.a.teamId) && Boolean(nextMatch.b.teamId) && !nextMatch.a.bye && !nextMatch.b.bye;
        if (!canFight) {
          // dejamos que BYE autoavance; si ninguno puede jugar, limpiamos
          clearScores(nextMatch);
          const auto = computeWinner(nextMatch);
          if (auto) {
            nextMatch.result.winner = auto;
            nextMatch.result.updatedAt = Date.now();
          }
        } else {
          // si había ganador pero ahora hay empate o cambio, recalcular
          const recalced = computeWinner(nextMatch);
          if (recalced !== nextMatch.result.winner) {
            // no borramos scores si siguen válidos; solo actualizamos winner
            nextMatch.result.winner = recalced;
            nextMatch.result.updatedAt = Date.now();
          }
        }
      }
    }
  }

  /** @param {Bracket} bracket @param {MatchRef|null} ref */
  function findMatch(bracket, ref) {
    if (!ref) return null;
    const r = bracket.rounds.find((x) => x.round === ref.round);
    return r?.matches.find((m) => m.match === ref.match) ?? null;
  }

  /** @param {BracketSlot} slot @param {BracketMatch|null} sourceMatch */
  function applyWinnerToSlot(slot, sourceMatch) {
    if (!slot) return;
    if (!sourceMatch) {
      slot.teamId = null;
      slot.teamName = "Por definir";
      slot.bye = false;
      return;
    }
    const w = sourceMatch.result?.winner;
    if (w === "a") {
      slot.teamId = sourceMatch.a.teamId;
      slot.teamName = sourceMatch.a.teamName;
      slot.bye = sourceMatch.a.bye;
      return;
    }
    if (w === "b") {
      slot.teamId = sourceMatch.b.teamId;
      slot.teamName = sourceMatch.b.teamName;
      slot.bye = sourceMatch.b.bye;
      return;
    }
    slot.teamId = null;
    slot.teamName = "Por definir";
    slot.bye = false;
  }

  /** @param {Bracket} bracket */
  function getChampion(bracket) {
    const lastRound = bracket.rounds[bracket.rounds.length - 1];
    if (!lastRound) return null;
    const finalMatch = lastRound.matches?.[0];
    if (!finalMatch) return null;
    const w = finalMatch.result?.winner;
    if (w === "a") return { teamId: finalMatch.a.teamId, teamName: finalMatch.a.teamName };
    if (w === "b") return { teamId: finalMatch.b.teamId, teamName: finalMatch.b.teamName };
    return null;
  }

  function sanitizeScore(value) {
    const s = String(value ?? "").trim();
    if (s === "") return null;
    if (!/^\d{1,2}$/.test(s)) return null;
    return Number(s);
  }

  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 250);
  }

  function buildPublicData() {
    // Solo lo que necesita la web pública (sin llaves internas del panel)
    return {
      exportedAt: Date.now(),
      tournaments: state.tournaments.map((t) => ({
        id: t.id,
        name: t.name,
        mode: t.mode,
        cap: t.cap,
        createdAt: t.createdAt,
        platform: t.platform ?? "xplay.gg",
        server: t.server ?? "Buenos Aires",
        isFree: t.isFree ?? true,
        fee: t.fee ?? null,
        teams: t.teams.map((x) => ({
          id: x.id,
          name: x.name,
          confirmed: x.confirmed,
          players: x.players ?? [],
          repNumber: x.repNumber ?? null,
          discord: x.discord ?? null,
        })),
        dateAt: t.dateAt,
        bracket: t.bracket ?? null,
      })),
    };
  }

  // --- Sync en vivo hacia el servidor (para /public sin exportar) ---
  let syncTimer = null;
  function queueServerSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      // Protección: no sobreescribimos el estado remoto con "[]" cuando el panel
      // está inicializando o el usuario tiene el panel vacío en local.
      if (!state.tournaments || state.tournaments.length === 0) return;
      syncToServer().catch(() => {
        // si no hay servidor, no molestamos
      });
    }, 350);
  }

  async function syncToServer() {
    const payload = buildPublicData();
    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
  }

  // --- Bloqueo por contraseña (cliente) ---
  async function ensureLock() {
    async function checkAdminSession() {
      try {
        const res = await fetch("/api/admin/me", { credentials: "same-origin" });
        const json = await res.json();
        return Boolean(json?.ok);
      } catch {
        return false;
      }
    }

    // Si ya hay sesión válida, no mostramos el lock.
    if (await checkAdminSession()) return;

    const overlay = document.createElement("div");
    overlay.className = "lock";
    overlay.innerHTML = `
      <div class="lockCard">
        <h2 class="lockTitle">Acceso al panel</h2>
        <p class="lockHint">
          Si es tu primera vez, crea una contraseña. Si ya existe, ingrésala.
          (Esto es un bloqueo en el navegador; para seguridad real se necesita backend.)
        </p>
        <form id="lockForm" class="form">
          <label class="field">
            <span class="field__label">Contraseña</span>
            <input id="lockPass" class="input" type="password" minlength="4" required />
          </label>
          <div class="form__actions" style="justify-content:space-between">
            <span class="muted small" style="font-family:var(--font-display); font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted)">Nivel 2</span>
            <button class="btn btn--primary" type="submit">Entrar</button>
          </div>
          <p class="muted small">Consejo: no compartas la URL de <code>/admin</code>.</p>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = /** @type {HTMLFormElement} */ (overlay.querySelector("#lockForm"));
    const passInput = /** @type {HTMLInputElement} */ (overlay.querySelector("#lockPass"));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = passInput.value;

      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password: pass }),
      });

      if (!res.ok) {
        alert("Contraseña incorrecta.");
        return;
      }

      overlay.remove();
      // Cargamos datos reales desde el servidor (Supabase) y desbloqueamos UI.
      await mergeFromServer();
      render();
      queueServerSync();
    });

    passInput.focus();
  }

  // Events
  function syncCreateInscriptionUI() {
    if (!el.tournamentIsFree || !el.tournamentFee) return;
    const isFree = Boolean(el.tournamentIsFree.checked);
    el.tournamentFee.disabled = isFree;
    if (isFree) el.tournamentFee.value = "";
  }

  el.createTournamentForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = normalizeName(el.tournamentName.value);
    const mode = /** @type {Tournament["mode"]} */ (el.tournamentMode.value);
    const cap = clampTournamentCap(Number(el.tournamentCap.value));
    const dateAt = (el.tournamentDate && el.tournamentDate.value) ? el.tournamentDate.value : undefined;
    const platform = (el.tournamentPlatform?.value ?? "xplay.gg").trim() || "xplay.gg";
    const server = (el.tournamentServer?.value ?? "Buenos Aires").trim() || "Buenos Aires";
    const isFree = Boolean(el.tournamentIsFree?.checked);
    const feeRaw = el.tournamentFee?.value ?? "";
    const feeNum = feeRaw === "" ? null : Number(feeRaw);
    if (!isFree && (feeNum === null || !Number.isFinite(feeNum) || feeNum < 0)) {
      alert("Para inscripción pago, ingresá un costo válido (>= 0).");
      el.tournamentFee?.focus?.();
      return;
    }

    const t = /** @type {Tournament} */ ({
      id: uuid(),
      name,
      mode,
      cap,
      createdAt: Date.now(),
      dateAt: dateAt || undefined,
      platform,
      server,
      isFree,
      fee: isFree ? null : feeNum,
      teams: [],
    });
    state.tournaments.unshift(t);
    state.selectedTournamentId = t.id;
    saveState();

    el.createTournamentForm.reset();
    el.tournamentMode.value = "5v5";
    el.tournamentCap.value = "8";
    if (el.tournamentDate) el.tournamentDate.value = "";
    if (el.tournamentPlatform) el.tournamentPlatform.value = "xplay.gg";
    if (el.tournamentServer) el.tournamentServer.value = "Buenos Aires";
    if (el.tournamentIsFree) el.tournamentIsFree.checked = true;
    if (el.tournamentFee) el.tournamentFee.value = "";
    syncCreateInscriptionUI();
    render();
  });

  el.tournamentIsFree?.addEventListener("change", () => {
    syncCreateInscriptionUI();
  });

  el.tournamentIsFreeEdit?.addEventListener("change", () => {
    const t = getSelectedTournament();
    if (!t) return;

    const nextFree = Boolean(el.tournamentIsFreeEdit.checked);
    if (nextFree) {
      t.isFree = true;
      t.fee = null;
      upsertTournament(t);
      return;
    }

    const feeRaw = el.tournamentFeeEdit?.value ?? "";
    const feeNum = feeRaw === "" ? null : Number(feeRaw);
    if (feeNum === null || !Number.isFinite(feeNum) || feeNum < 0) {
      alert("Para inscripción pago, ingresá un costo válido (>= 0).");
      // revertimos a la UI real del torneo actual
      el.tournamentIsFreeEdit.checked = Boolean(t.isFree);
      renderSelectedTournament();
      return;
    }

    t.isFree = false;
    t.fee = feeNum;
    upsertTournament(t);
  });

  el.tournamentFeeEdit?.addEventListener("change", () => {
    const t = getSelectedTournament();
    if (!t || t.isFree) return;
    const feeRaw = el.tournamentFeeEdit?.value ?? "";
    if (feeRaw === "") {
      t.fee = null;
      upsertTournament(t);
      return;
    }
    const feeNum = Number(feeRaw);
    if (!Number.isFinite(feeNum) || feeNum < 0) {
      alert("El costo debe ser un número (>= 0).");
      el.tournamentFeeEdit.value = String(t.fee ?? "");
      return;
    }
    t.fee = feeNum;
    upsertTournament(t);
  });

  el.tournamentPlatformEdit?.addEventListener("change", () => {
    const t = getSelectedTournament();
    if (!t) return;
    t.platform = (el.tournamentPlatformEdit?.value ?? "xplay.gg").trim() || "xplay.gg";
    upsertTournament(t);
  });

  el.tournamentServerEdit?.addEventListener("change", () => {
    const t = getSelectedTournament();
    if (!t) return;
    t.server = (el.tournamentServerEdit?.value ?? "Buenos Aires").trim() || "Buenos Aires";
    upsertTournament(t);
  });

  el.tournamentList.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const tid = btn.getAttribute("data-tid");
    if (!tid) return;
    if (action === "select") setSelectedTournament(tid);
    if (action === "delete") removeTournament(tid);
  });

  el.addTeamForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = getSelectedTournament();
    if (!t) return;

    const name = normalizeName(el.teamName.value);
    if (name.length < 2) return;

    const exists = t.teams.some((x) => x.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      alert("Ya existe un equipo con ese nombre.");
      return;
    }

    const team = /** @type {Team} */ ({ id: uuid(), name, confirmed: false, createdAt: Date.now(), players: [] });
    t.teams.push(team);
    delete t.bracket;
    upsertTournament(t);

    el.addTeamForm.reset();
    el.teamName.focus();
  });

  el.teamList.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest("button[data-action]");
    if (!btn) return;
    const t = getSelectedTournament();
    if (!t) return;

    const action = btn.getAttribute("data-action");
    const teamId = btn.getAttribute("data-teamid");
    if (!teamId) return;

    const team = t.teams.find((x) => x.id === teamId);
    if (!team) return;

    if (action === "toggle-confirm") {
      const confirmedCount = t.teams.filter((x) => x.confirmed).length;
      const next = !team.confirmed;
      if (next && confirmedCount >= t.cap) {
        alert(`No puedes confirmar más equipos. Cupo: ${t.cap}.`);
        return;
      }
      team.confirmed = next;
      delete t.bracket;
      upsertTournament(t);
      return;
    }

    if (action === "delete-team") {
      t.teams = t.teams.filter((x) => x.id !== teamId);
      delete t.bracket;
      upsertTournament(t);
      return;
    }

    if (action === "remove-player") {
      const index = Number(btn.getAttribute("data-index"));
      if (!Number.isFinite(index) || !team.players) return;
      team.players = team.players.filter((_, i) => i !== index);
      upsertTournament(t);
      return;
    }
  });

  el.teamList.addEventListener("submit", (e) => {
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (form.classList.contains("teamPlayers__add")) {
      e.preventDefault();
      const t = getSelectedTournament();
      if (!t) return;
      const teamId = form.getAttribute("data-teamid");
      const team = t.teams.find((x) => x.id === teamId);
      if (!team) return;
      const input = form.querySelector('input[type="text"]');
      const name = normalizeName(/** @type {HTMLInputElement} */ (input).value);
      if (name.length < 2) return;
      const maxPlayers = modeToPlayers(t.mode);
      if (!Array.isArray(team.players)) team.players = [];
      if (team.players.length >= maxPlayers) {
        alert(`Máximo ${maxPlayers} jugadores por equipo (${t.mode}).`);
        return;
      }
      team.players.push(name);
      /** @type {HTMLInputElement} */ (input).value = "";
      upsertTournament(t);
    }
  });

  el.btnGenerateBracket.addEventListener("click", () => {
    const t = getSelectedTournament();
    if (!t) return;
    const { bracket, reason } = generateBracket(t);
    if (!bracket) {
      el.bracketHint.textContent = "";
      el.bracket.innerHTML = `<div class="empty"><p><strong>No se pudo generar</strong>. ${escapeHtml(reason ?? "Revisa equipos confirmados.")}</p></div>`;
      // Igual sincronizamos el estado actual (equipos/confirmaciones) al público
      syncToServer().catch(() => {});
      return;
    }
    t.bracket = bracket;
    upsertTournament(t);
    // Sync inmediato para que el público lo vea al instante
    syncToServer().catch(() => {});
  });

  el.bracket.addEventListener("input", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const inp = target.closest("input[data-action='score']");
    if (!inp) return;
    const t = getSelectedTournament();
    if (!t?.bracket) return;

    const matchEl = target.closest(".match");
    if (!matchEl) return;
    const round = Number(matchEl.getAttribute("data-round"));
    const matchNo = Number(matchEl.getAttribute("data-match"));
    const side = inp.getAttribute("data-side");
    if (!round || !matchNo || (side !== "a" && side !== "b")) return;

    const r = t.bracket.rounds.find((x) => x.round === round);
    const m = r?.matches.find((x) => x.match === matchNo);
    if (!m) return;

    const score = sanitizeScore(/** @type {HTMLInputElement} */ (inp).value);
    if (side === "a") m.result.aScore = score;
    if (side === "b") m.result.bScore = score;
    m.result.winner = computeWinner(m);
    m.result.updatedAt = Date.now();
    // Propagar ganador hacia siguientes rondas
    propagateAll(t.bracket);
    saveState();

    // Re-render solo panel (simple)
    renderSelectedTournament();
  });

  el.btnClearTeams.addEventListener("click", () => {
    const t = getSelectedTournament();
    if (!t) return;
    if (!confirm("¿Vaciar equipos de este torneo?")) return;
    t.teams = [];
    delete t.bracket;
    upsertTournament(t);
  });

  el.btnReset.addEventListener("click", () => {
    if (!confirm("¿Borrar todos los torneos guardados en este navegador?")) return;
    state = { tournaments: [], selectedTournamentId: null };
    saveState();
    render();
  });

  el.btnExportPublic.addEventListener("click", () => {
    // Publicar al servidor (la web pública se actualiza por stream)
    syncToServer()
      .then(() => alert("Publicado: la web pública se actualizó."))
      .catch(() => alert("No pude publicar. Asegúrate de correr el servidor con npm run dev."));
  });

  el.btnSeedDemo.addEventListener("click", () => {
    const now = Date.now();
    const t = /** @type {Tournament} */ ({
      id: uuid(),
      name: "Torneo 1",
      mode: "2v2",
      cap: 8,
      createdAt: now,
      dateAt: new Date(now).toISOString().slice(0, 10),
      isFree: true,
      fee: null,
      teams: [
        { id: uuid(), name: "AWP Kings", confirmed: true, createdAt: now + 1, players: ["Player1", "Player2"] },
        { id: uuid(), name: "Entry Fraggers", confirmed: true, createdAt: now + 2, players: [] },
        { id: uuid(), name: "Eco Warriors", confirmed: true, createdAt: now + 3, players: [] },
        { id: uuid(), name: "One Tap Squad", confirmed: true, createdAt: now + 4, players: [] },
        { id: uuid(), name: "Retake Unit", confirmed: false, createdAt: now + 5, players: [] },
      ],
    });
    state.tournaments.unshift(t);
    state.selectedTournamentId = t.id;
    saveState();
    render();
  });

  /** Carga torneos completos desde el servidor (fuente de verdad: Supabase). */
  async function mergeFromServer() {
    try {
      const res = await fetch("/api/data");
      const remote = await res.json();
      if (!remote || !Array.isArray(remote.tournaments)) return;
      const nextTournaments = remote.tournaments;
      state.tournaments = nextTournaments;
      const currentSelected = state.selectedTournamentId;
      const stillExists = currentSelected && nextTournaments.some((t) => t.id === currentSelected);
      state.selectedTournamentId = stillExists ? currentSelected : nextTournaments[0]?.id ?? null;
      saveState();
      render();
    } catch {
      // sin servidor: no hacer nada
    }
  }

  // Init
  (async () => {
    // Render normal solo si la cookie del backend es válida.
    async function checkAdminSession() {
      try {
        const res = await fetch("/api/admin/me", { credentials: "same-origin" });
        const json = await res.json();
        return Boolean(json?.ok);
      } catch {
        return false;
      }
    }

    if (await checkAdminSession()) {
      await mergeFromServer();
      render();
      queueServerSync();
      return;
    }

    await ensureLock();
  })();
})();
