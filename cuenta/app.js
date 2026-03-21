import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

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

async function main() {
  const loadingEl = $("loading");
  const configError = $("configError");
  const appMain = $("appMain");

  const res = await fetch("/api/public-config");
  const cfg = await res.json();

  if (!cfg.ok) {
    loadingEl.classList.add("hidden");
    configError.classList.remove("hidden");
    configError.textContent =
      "Supabase no está configurado en el servidor. Añadí SUPABASE_URL y SUPABASE_ANON_KEY al entorno (archivo .env o variables del host) y reiniciá el servidor.";
    return;
  }

  const redirectUrl = `${window.location.origin}/cuenta/`;

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

  async function refreshUI() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      authSection.classList.remove("hidden");
      loggedSection.classList.add("hidden");
      return;
    }

    const { data: prof } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();

    setText("loggedEmail", user.email ?? "—");
    setText("loggedUsername", prof?.username ?? "…");
    const nu = $("newUsername");
    if (nu) nu.value = prof?.username ?? "";
    authSection.classList.add("hidden");
    loggedSection.classList.remove("hidden");
  }

  supabase.auth.onAuthStateChange(() => {
    refreshUI();
  });

  await supabase.auth.getSession();
  await refreshUI();

  loadingEl.classList.add("hidden");
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
}

main().catch((err) => {
  console.error(err);
  const loadingEl = $("loading");
  const configError = $("configError");
  if (loadingEl) loadingEl.classList.add("hidden");
  if (configError) {
    configError.classList.remove("hidden");
    configError.textContent = "Error al iniciar la cuenta. Revisá la consola del navegador.";
  }
});
