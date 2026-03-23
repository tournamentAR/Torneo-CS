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
      lastErr = new Error("createClient no disponible");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("No se pudo cargar @supabase/supabase-js");
}

const $ = (id) => document.getElementById(id);

function showMsg(text) {
  const el = $("msgReset");
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

/** Espera sesión tras abrir el enlace del correo (?code= o hash con tokens). */
async function getRecoverySession(supabase) {
  let {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return session;

  await new Promise((r) => setTimeout(r, 200));
  ({
    data: { session },
  } = await supabase.auth.getSession());
  if (session) return session;

  return await new Promise((resolve) => {
    let sub = null;
    const timeout = setTimeout(() => {
      if (sub) sub.unsubscribe();
      resolve(null);
    }, 3500);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (sess) {
        clearTimeout(timeout);
        subscription.unsubscribe();
        resolve(sess);
      }
    });
    sub = subscription;
  });
}

async function recuperarBoot() {
  let createClient;
  try {
    createClient = await loadSupabaseCreateClient();
  } catch (e) {
    console.error(e);
    throw new Error(
      "No se pudo cargar el sistema de sesión. Probá sin bloqueador de anuncios u otra red."
    );
  }

  const configError = $("configError");
  const appMain = $("appMain");
  const noSession = $("noSession");

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
        ? "No se encontró /api/public-config. Revisá el despliegue."
        : `El servidor respondió ${res.status}.`
    );
  }

  const cfg = await res.json();

  if (!cfg.ok) {
    configError.classList.remove("hidden");
    configError.textContent =
      "Supabase no está configurado en el servidor. Añadí SUPABASE_URL y SUPABASE_ANON_KEY al entorno y reiniciá el servidor.";
    return;
  }

  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const session = await getRecoverySession(supabase);

  if (!session) {
    noSession.classList.remove("hidden");
    return;
  }

  appMain.classList.remove("hidden");

  $("formNewPassword").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const p1 = $("newPass").value;
    const p2 = $("newPass2").value;
    if (p1.length < 8) {
      showMsg("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (p1 !== p2) {
      showMsg("Las contraseñas no coinciden.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) {
      showMsg(error.message || "No se pudo actualizar la contraseña.");
      return;
    }

    $("formWrap").classList.add("hidden");
    $("successPanel").classList.remove("hidden");
  });
}

async function main() {
  const configError = $("configError");
  try {
    await recuperarBoot();
  } catch (err) {
    console.error(err);
    if (configError && configError.classList.contains("hidden")) {
      const msg =
        err?.name === "AbortError"
          ? "La petición tardó demasiado. Revisá tu conexión."
          : err?.message || "Error al cargar la página.";
      configError.textContent = msg;
      configError.classList.remove("hidden");
    }
  } finally {
    $("loading")?.classList.add("hidden");
  }
}

main();
