const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/** Import dinámico: si esm.sh falla o está bloqueado, probamos jsDelivr (evita pantalla infinita en "Cargando"). */
async function loadSupabaseCreateClient() {
  const urls = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.99.3/+esm",
    "https://esm.sh/@supabase/supabase-js@2.99.3",
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const mod = await import(url);
      const fn = mod.createClient;
      if (typeof fn === "function") return fn;
      lastErr = new Error("createClient no disponible en el módulo");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("No se pudo cargar @supabase/supabase-js");
}

const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function showMsg(elId, text) {
  const el = $(elId);
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rpcErrorMessage(err) {
  if (!err) return "Error desconocido";
  const m = err.message || String(err);
  if (m.includes("No tenés")) return m;
  if (m.includes("Ya ")) return m;
  if (m.includes("No hay ninguna")) return m;
  if (m.includes("No encontramos")) return m;
  if (m.includes("No sos")) return m;
  if (m.includes("invitación")) return m;
  if (m.includes("equipo")) return m;
  if (m.includes("líder")) return m;
  if (m.includes("jugador")) return m;
  if (m.includes("Código")) return m;
  if (m.includes("iniciar sesión")) return m;
  return m.length > 120 ? "No se pudo completar la acción." : m;
}

async function cuentaBoot() {
  let createClient;
  try {
    createClient = await loadSupabaseCreateClient();
  } catch (e) {
    console.error(e);
    throw new Error(
      "No se pudo cargar el sistema de sesión (scripts desde internet bloqueados o sin conexión). Probá desactivar bloqueadores, otra red o la ventana normal si usás incógnito."
    );
  }

  const configError = $("configError");
  const appMain = $("appMain");

  const ac = new AbortController();
  const fetchTimer = window.setTimeout(() => ac.abort(), 20000);
  let res;
  try {
    res = await fetch("/api/public-config", { signal: ac.signal, cache: "no-store" });
  } finally {
    window.clearTimeout(fetchTimer);
  }

  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "No se encontró /api/public-config. Revisá el despliegue (Vercel / servidor)."
        : `El servidor respondió ${res.status} al pedir la configuración.`
    );
  }

  const cfg = await res.json();

  if (!cfg.ok) {
    configError.classList.remove("hidden");
    configError.textContent =
      "Supabase no está configurado en el servidor. Añadí SUPABASE_URL y SUPABASE_ANON_KEY al entorno (archivo .env o variables del host) y reiniciá el servidor.";
    return;
  }

  const redirectUrl = `${window.location.origin}/cuenta/`;
  const recoverRedirectUrl = `${window.location.origin}/cuenta/recuperar/`;

  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const authSection = $("authSection");
  const loggedSection = $("loggedSection");

  async function fetchUsernameMap(userIds) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return new Map();
    const { data, error } = await supabase.from("profiles").select("id, username").in("id", ids);
    if (error || !data) return new Map();
    return new Map(data.map((p) => [p.id, p.username ?? "—"]));
  }

  async function renderSquadPanels(user, prof) {
    const mode = prof?.account_mode === "leader" ? "leader" : "player";
    const btnL = $("btnModeLeader");
    const btnP = $("btnModePlayer");
    const panelLeader = $("panelLeader");
    const panelPlayer = $("panelPlayer");
    if (btnL) btnL.classList.toggle("is-active", mode === "leader");
    if (btnP) btnP.classList.toggle("is-active", mode === "player");
    if (panelLeader) panelLeader.classList.toggle("hidden", mode !== "leader");
    if (panelPlayer) panelPlayer.classList.toggle("hidden", mode !== "player");

    showMsg("msgLeader", "");
    showMsg("msgPlayer", "");

    const leaderNote = $("playerLeaderNote");
    if (leaderNote) {
      leaderNote.classList.add("hidden");
      leaderNote.textContent = "";
    }

    const { data: rows, error: memErr } = await supabase
      .from("squad_members")
      .select("squad_id, status, is_leader, squads(id, name, invite_code, leader_id)")
      .eq("user_id", user.id);

    if (memErr) {
      const hint =
        memErr.message?.includes("squad_members") || memErr.message?.includes("schema cache")
          ? "Falta aplicar la migración SQL de equipos en Supabase (archivo 002_squads_leader_player.sql)."
          : memErr.message || "No se pudieron cargar los equipos.";
      showMsg("msgLeader", mode === "leader" ? hint : "");
      showMsg("msgPlayer", mode === "player" ? hint : "");
      return;
    }

    const list = rows ?? [];
    const ledRow = list.find((r) => r.is_leader && r.status === "confirmed" && r.squads);
    const ledSquad = ledRow?.squads ?? null;

    if (leaderNote && ledSquad && mode === "player") {
      leaderNote.textContent = `Sos líder del equipo «${ledSquad.name}». Para unirte a otro como jugador, eliminá tu equipo en modo líder o usá otra cuenta.`;
      leaderNote.classList.remove("hidden");
    }

    const leaderCreate = $("leaderCreateWrap");
    const leaderManage = $("leaderManageWrap");
    if (mode === "leader") {
      if (ledSquad) {
        leaderCreate?.classList.add("hidden");
        leaderManage?.classList.remove("hidden");
        setText("leaderSquadName", ledSquad.name ?? "—");
        setText("leaderInviteCode", ledSquad.invite_code ?? "—");
        leaderManage?.dataset.squadId = ledSquad.id;

        const { data: squadMembers } = await supabase
          .from("squad_members")
          .select("user_id, is_leader, status")
          .eq("squad_id", ledSquad.id);

        const sm = squadMembers ?? [];
        const nameById = await fetchUsernameMap(sm.map((m) => m.user_id));
        const ul = $("leaderMemberList");
        if (ul) {
          ul.innerHTML = sm
            .map((m) => {
              const uname = escapeHtml(nameById.get(m.user_id) ?? m.user_id.slice(0, 8));
              let badge = "Jugador";
              let badgeClass = "memberList__badge--wait";
              if (m.is_leader) {
                badge = "Líder";
                badgeClass = "memberList__badge--ok";
              } else if (m.status === "confirmed") {
                badge = "Confirmó";
                badgeClass = "memberList__badge--ok";
              } else if (m.status === "pending") {
                badge = "Pendiente";
              } else if (m.status === "declined") {
                badge = "Rechazó";
                badgeClass = "";
              }
              return `<li><span class="memberList__name">${uname}</span><span class="memberList__badge ${badgeClass}">${badge}</span></li>`;
            })
            .join("");
        }
      } else {
        leaderCreate?.classList.remove("hidden");
        leaderManage?.classList.add("hidden");
      }
    }

    const pendingPlayer = list.filter((r) => !r.is_leader && r.status === "pending" && r.squads);
    const pendingWrap = $("playerPendingWrap");
    const pendingListEl = $("playerPendingList");
    if (mode === "player" && pendingPlayer.length > 0) {
      pendingWrap?.classList.remove("hidden");
      if (pendingListEl) {
        pendingListEl.innerHTML = pendingPlayer
          .map((r) => {
            const name = escapeHtml(r.squads?.name ?? "Equipo");
            const sid = r.squad_id;
            return `<div class="pendingCard" data-squad-id="${escapeHtml(sid)}">
              <p class="pendingCard__title">${name}</p>
              <p class="field__hint" style="margin:0 0 8px">Confirmá tu lugar en este equipo o rechazá la invitación.</p>
              <div class="pendingCard__actions">
                <button type="button" class="btn btn--primary btn--small js-confirm-squad" data-squad-id="${escapeHtml(sid)}">Confirmar mi lugar</button>
                <button type="button" class="btn btn--secondary btn--small js-decline-squad" data-squad-id="${escapeHtml(sid)}">Rechazar</button>
              </div>
            </div>`;
          })
          .join("");
      }
    } else {
      pendingWrap?.classList.add("hidden");
      if (pendingListEl) pendingListEl.innerHTML = "";
    }

    const confirmedPlayer = list.find((r) => !r.is_leader && r.status === "confirmed" && r.squads);
    const squadWrap = $("playerSquadWrap");
    if (mode === "player" && confirmedPlayer?.squads) {
      squadWrap?.classList.remove("hidden");
      setText("playerSquadName", confirmedPlayer.squads.name ?? "—");
      const sid = confirmedPlayer.squad_id;
      const { data: mates } = await supabase.from("squad_members").select("user_id, is_leader, status").eq("squad_id", sid);
      const nm = await fetchUsernameMap((mates ?? []).map((m) => m.user_id));
      const ul = $("playerTeammateList");
      if (ul) {
        ul.innerHTML = (mates ?? [])
          .filter((m) => m.status === "confirmed")
          .map((m) => {
            const label = m.is_leader ? " (líder)" : "";
            return `<li><span class="memberList__name">${escapeHtml(nm.get(m.user_id) ?? "—")}${label}</span></li>`;
          })
          .join("");
      }
    } else {
      squadWrap?.classList.add("hidden");
    }
  }

  async function refreshUI() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      authSection.classList.remove("hidden");
      loggedSection.classList.add("hidden");
      return;
    }

    const { data: prof } = await supabase.from("profiles").select("username, account_mode").eq("id", user.id).maybeSingle();

    setText("loggedEmail", user.email ?? "—");
    setText("loggedUsername", prof?.username ?? "…");
    const nu = $("newUsername");
    if (nu) nu.value = prof?.username ?? "";
    authSection.classList.add("hidden");
    loggedSection.classList.remove("hidden");

    await renderSquadPanels(user, prof);
  }

  supabase.auth.onAuthStateChange(() => {
    refreshUI();
  });

  await supabase.auth.getSession();
  await refreshUI();

  appMain.classList.remove("hidden");

  const tabLogin = $("tabLogin");
  const tabRegister = $("tabRegister");
  const panelLogin = $("panelLogin");
  const panelRegister = $("panelRegister");

  tabLogin.addEventListener("click", () => {
    tabLogin.classList.add("is-active");
    tabRegister.classList.remove("is-active");
    tabLogin.setAttribute("aria-selected", "true");
    tabRegister.setAttribute("aria-selected", "false");
    panelLogin.classList.remove("hidden");
    panelRegister.classList.add("hidden");
    showMsg("msgLogin", "");
    const rp = $("recoverPanel");
    const ro = $("recoverOk");
    const ra = $("recoverActions");
    if (rp) rp.classList.add("hidden");
    if (ro) ro.classList.add("hidden");
    if (ra) ra.classList.remove("hidden");
    const fr = $("formRecover");
    if (fr) fr.reset();
    const mr = $("msgRecover");
    if (mr) {
      mr.textContent = "";
      mr.classList.add("hidden");
    }
  });

  tabRegister.addEventListener("click", () => {
    tabRegister.classList.add("is-active");
    tabLogin.classList.remove("is-active");
    tabRegister.setAttribute("aria-selected", "true");
    tabLogin.setAttribute("aria-selected", "false");
    panelRegister.classList.remove("hidden");
    panelLogin.classList.add("hidden");
    const rs = $("registerSuccess");
    const ra = $("registerActions");
    if (rs) rs.classList.add("hidden");
    if (ra) ra.classList.remove("hidden");
    const fr = $("formRegister");
    if (fr) fr.reset();
    showMsg("msgRegister", "");
    const rp = $("recoverPanel");
    if (rp) rp.classList.add("hidden");
  });

  const btnToggleRecover = $("btnToggleRecover");
  const recoverPanel = $("recoverPanel");
  if (btnToggleRecover && recoverPanel) {
    btnToggleRecover.addEventListener("click", () => {
      recoverPanel.classList.toggle("hidden");
      if (!recoverPanel.classList.contains("hidden")) {
        $("recoverOk")?.classList.add("hidden");
        $("recoverActions")?.classList.remove("hidden");
        $("formRecover")?.reset();
        const mr = $("msgRecover");
        if (mr) {
          mr.textContent = "";
          mr.classList.add("hidden");
        }
        recoverPanel.querySelector("#recoverEmail")?.focus();
      }
    });
  }

  $("formRecover")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgEl = $("msgRecover");
    const okEl = $("recoverOk");
    const actions = $("recoverActions");
    if (msgEl) {
      msgEl.textContent = "";
      msgEl.classList.add("hidden");
    }
    if (okEl) okEl.classList.add("hidden");
    const email = $("recoverEmail")?.value.trim() ?? "";
    if (!email) return;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: recoverRedirectUrl,
    });

    if (error) {
      if (msgEl) {
        msgEl.textContent = error.message || "No se pudo enviar el enlace.";
        msgEl.classList.remove("hidden");
      }
      return;
    }

    if (okEl) okEl.classList.remove("hidden");
    if (actions) actions.classList.add("hidden");
  });

  $("formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("msgLogin", "");
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      let m = error.message || "No se pudo iniciar sesión.";
      if (m.toLowerCase().includes("email not confirmed")) {
        m = "Todavía no confirmaste el email. Revisá tu bandeja y el enlace de verificación.";
      }
      showMsg("msgLogin", m);
      return;
    }
  });

  $("formRegister").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("msgRegister", "");
    const rawUser = $("regUsername").value.trim().toLowerCase();
    const email = $("regEmail").value.trim();
    const password = $("regPassword").value;
    const password2 = $("regPassword2").value;

    if (!USERNAME_RE.test(rawUser)) {
      showMsg("msgRegister", "El nombre de usuario debe tener 3–24 caracteres (minúsculas, números y _).");
      return;
    }
    if (password.length < 8) {
      showMsg("msgRegister", "La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== password2) {
      showMsg("msgRegister", "Las contraseñas no coinciden.");
      return;
    }

    const { data: taken } = await supabase.from("profiles").select("id").eq("username", rawUser).maybeSingle();
    if (taken) {
      showMsg("msgRegister", "Ese nombre de usuario ya está en uso.");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { username: rawUser },
      },
    });

    if (error) {
      showMsg("msgRegister", error.message || "No se pudo crear la cuenta.");
      return;
    }

    $("registerSuccess").classList.remove("hidden");
    $("registerActions").classList.add("hidden");
  });

  $("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  $("formUsername").addEventListener("submit", async (e) => {
    e.preventDefault();
    const hint = $("usernameMsg");
    if (hint) {
      hint.textContent = "";
      hint.classList.remove("field__hint--error");
    }

    const raw = $("newUsername").value.trim().toLowerCase();
    if (!USERNAME_RE.test(raw)) {
      if (hint) {
        hint.textContent = "Usá 3–24 caracteres: minúsculas, números y _.";
        hint.classList.add("field__hint--error");
      }
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: taken } = await supabase.from("profiles").select("id").eq("username", raw).maybeSingle();
    if (taken && taken.id !== user.id) {
      if (hint) {
        hint.textContent = "Ese nombre ya está en uso.";
        hint.classList.add("field__hint--error");
      }
      return;
    }

    const { error } = await supabase.from("profiles").update({ username: raw }).eq("id", user.id);
    if (error) {
      if (hint) {
        hint.textContent = error.message || "No se pudo actualizar.";
        hint.classList.add("field__hint--error");
      }
      return;
    }

    if (hint) hint.textContent = "Nombre actualizado.";
    setText("loggedUsername", raw);
  });

  async function setAccountMode(mode) {
    showMsg("msgLeader", "");
    showMsg("msgPlayer", "");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ account_mode: mode }).eq("id", user.id);
    if (error) {
      showMsg("msgLeader", mode === "leader" ? error.message : "");
      showMsg("msgPlayer", mode === "player" ? error.message : "");
      return;
    }
    const { data: prof } = await supabase.from("profiles").select("username, account_mode").eq("id", user.id).maybeSingle();
    await renderSquadPanels(user, prof);
  }

  $("btnModeLeader")?.addEventListener("click", () => setAccountMode("leader"));
  $("btnModePlayer")?.addEventListener("click", () => setAccountMode("player"));

  $("formCreateSquad")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("msgLeader", "");
    const name = ($("squadNameInput")?.value ?? "").trim();
    const { error } = await supabase.rpc("create_squad", { p_name: name });
    if (error) {
      showMsg("msgLeader", rpcErrorMessage(error));
      return;
    }
    $("formCreateSquad")?.reset();
    await refreshUI();
  });

  $("formInvitePlayer")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("msgLeader", "");
    const squadId = $("leaderManageWrap")?.dataset.squadId;
    if (!squadId) return;
    const raw = ($("inviteUsernameInput")?.value ?? "").trim().toLowerCase();
    if (!USERNAME_RE.test(raw)) {
      showMsg("msgLeader", "Usuario invitado: 3–24 caracteres (minúsculas, números y _).");
      return;
    }
    const { error } = await supabase.rpc("invite_squad_member", {
      p_squad_id: squadId,
      p_username: raw,
    });
    if (error) {
      showMsg("msgLeader", rpcErrorMessage(error));
      return;
    }
    $("inviteUsernameInput").value = "";
    await refreshUI();
  });

  $("btnCopyInviteCode")?.addEventListener("click", async () => {
    const code = ($("leaderInviteCode")?.textContent ?? "").trim();
    if (!code || code === "—") return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      showMsg("msgLeader", "No se pudo copiar. Copiá el código a mano.");
      return;
    }
    showMsg("msgLeader", "Código copiado.");
    setTimeout(() => showMsg("msgLeader", ""), 2000);
  });

  $("btnDeleteSquad")?.addEventListener("click", async () => {
    if (!confirm("¿Eliminar este equipo? Se borran invitaciones y la lista de jugadores.")) return;
    showMsg("msgLeader", "");
    const { error } = await supabase.rpc("delete_my_squad");
    if (error) {
      showMsg("msgLeader", rpcErrorMessage(error));
      return;
    }
    await refreshUI();
  });

  $("formJoinCode")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("msgPlayer", "");
    const code = ($("joinCodeInput")?.value ?? "").trim();
    const { error } = await supabase.rpc("join_squad_by_code", { p_code: code });
    if (error) {
      showMsg("msgPlayer", rpcErrorMessage(error));
      return;
    }
    $("joinCodeInput").value = "";
    await refreshUI();
  });

  $("playerPendingList")?.addEventListener("click", async (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const btn = t.closest?.(".js-confirm-squad, .js-decline-squad");
    if (!btn) return;
    const squadId = btn.getAttribute("data-squad-id");
    if (!squadId) return;
    showMsg("msgPlayer", "");
    const isConfirm = btn.classList.contains("js-confirm-squad");
    const { error } = isConfirm
      ? await supabase.rpc("confirm_squad_membership", { p_squad_id: squadId })
      : await supabase.rpc("decline_squad_invite", { p_squad_id: squadId });
    if (error) {
      showMsg("msgPlayer", rpcErrorMessage(error));
      return;
    }
    await refreshUI();
  });
}

async function main() {
  const configError = $("configError");
  try {
    await cuentaBoot();
  } catch (err) {
    console.error(err);
    if (configError && configError.classList.contains("hidden")) {
      const msg =
        err?.name === "AbortError"
          ? "La petición al servidor tardó demasiado. Revisá tu conexión."
          : err?.message || "Error al iniciar la cuenta. Abrí la consola (F12) para más detalle.";
      configError.textContent = msg;
      configError.classList.remove("hidden");
    }
  } finally {
    $("loading")?.classList.add("hidden");
  }
}

main();
