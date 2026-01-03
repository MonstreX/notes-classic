import "jodit/es2015/jodit.min.css";
import "highlight.js/styles/github.css";
import "./styles/main.scss";
import iconsSprite from "./assets/icons.svg?raw";
import { mountApp } from "./ui/appShell";
import { initI18n, detectSystemLanguage, isSupportedLanguage } from "./services/i18n";
import { invoke } from "@tauri-apps/api/core";

const ensureIconSprite = () => {
  if (document.getElementById("app-icons")) return;
  document.body.insertAdjacentHTML("afterbegin", iconsSprite);
};

const initLanguage = async (): Promise<"restart" | "ready"> => {
  try {
    const stored = await invoke<any>("get_settings");
    const storedLang = stored?.language;
    if (storedLang && isSupportedLanguage(storedLang)) {
      await initI18n(storedLang);
      return "ready";
    }
    const systemLang = detectSystemLanguage();
    await initI18n(systemLang);
    await invoke("set_settings", { settings: { language: systemLang } });
    return "restart";
  } catch {
    const systemLang = detectSystemLanguage();
    await initI18n(systemLang);
    return "ready";
  }
};

const root = document.getElementById("root");
if (root) {
  ensureIconSprite();
  initLanguage().then((result) => {
    if (result === "restart") {
      invoke("restart_app");
      return;
    }
    mountApp(root);
  });
}
