import { invoke } from "@tauri-apps/api/core";

interface SystemStatus {
  app_name: string;
  app_version: string;
  platform: string;
  backend_status: string;
}

const el = (id: string): HTMLElement | null => document.getElementById(id);

async function loadStatus(): Promise<void> {
  try {
    const s = await invoke<SystemStatus>("get_system_status");
    const appEl = el("s-app");
    const verEl = el("s-ver");
    const platEl = el("s-plat");
    const backEl = el("s-back");
    const footerVer = el("footer-ver");
    if (appEl) appEl.textContent = s.app_name;
    if (verEl) verEl.textContent = s.app_version;
    if (platEl) platEl.textContent = s.platform;
    if (backEl) backEl.textContent = s.backend_status;
    if (footerVer) footerVer.textContent = `v${s.app_version}`;
  } catch (e) {
    const backEl = el("s-back");
    if (backEl) backEl.textContent = "error";
    console.error("get_system_status failed:", e);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  void loadStatus();
});