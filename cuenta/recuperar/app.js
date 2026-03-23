import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

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

async function main() {
  const loadingEl = $("loading");
  const configError = $("configError");
  const appMain = $("appMain");
  const noSession = $("noSession");

  const res = await fetch("/api/public-config");
  const cfg = await res.json();

  if (!cfg.ok) {
    loadingEl.classList.add("hidden");
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

  loadingEl.classList.add("hidden");

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

main().catch((err) => {
  console.error(err);
  const loadingEl = $("loading");
  const configError = $("configError");
  if (loadingEl) loadingEl.classList.add("hidden");
  if (configError) {
    configError.classList.remove("hidden");
    configError.textContent = "Error al cargar la página. Revisá la consola del navegador.";
  }
});
