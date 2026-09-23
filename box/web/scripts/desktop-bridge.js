const desktopBridge = (() => {
  const native = window.chrome?.webview;
  if (!native) return null;

  const pending = new Map();
  let platformInfoPromise = null;
  native.addEventListener("message", (event) => {
    const message = event.data || {};
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.payload ?? null);
    else request.reject(new Error(message.error || t("Windows 요청을 처리하지 못했습니다.")));
  });

  return {
    request(type, payload = null) {
      const id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(t("Windows 보안 저장소 응답 시간이 초과되었습니다.")));
        }, 5000);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timeout);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timeout);
            reject(error);
          },
        });
        native.postMessage({ id, type, payload });
      });
    },

    platform() {
      platformInfoPromise ||= this.request("platform.get");
      return platformInfoPromise;
    },

    async ensureCompatible() {
      const platform = await this.platform();
      if (Number(platform.bridgeProtocol) !== 1) {
        throw new Error(t("웹과 Windows 앱의 연결 버전이 맞지 않습니다. Windows 앱을 업데이트하세요."));
      }
      if (platform.workerAvailable === false) {
        throw new Error(t("로컬 worker의 상태를 확인하지 못했습니다. Windows 앱을 다시 시작해주세요."));
      }
      if (!versionAtLeast(platform.engineVersion || "0.0.0", "0.3.0") || platform.capabilities?.contract_version !== 1) {
        throw new Error(t("로컬 엔진 버전이 오래되었습니다. Windows 앱을 업데이트하세요."));
      }
      return platform;
    },
  };
})();

const DESKTOP_LOCAL_API_PATHS = new Set([
  "/recordings/convert",
]);

async function platformApiFetch(path, options = {}) {
  if (desktopBridge && DESKTOP_LOCAL_API_PATHS.has(path)) {
    await desktopBridge.ensureCompatible();
    return fetch(`/__local_api${path}`, options);
  }
  return fetch(`/api${path}`, options);
}

function versionAtLeast(actual, minimum) {
  const left = String(actual).split(".").map((value) => Number(value) || 0);
  const right = String(minimum).split(".").map((value) => Number(value) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return true;
}

function showDesktopCompatibilityError(error) {
  const banner = document.querySelector("#updateBanner");
  const message = document.querySelector("#updateBannerMessage");
  const button = document.querySelector("#applyWebUpdate");
  if (!banner || !message || !button) return;
  banner.dataset.desktopCompatibility = "error";
  banner.querySelector("strong").textContent = t("Windows 앱 업데이트가 필요합니다.");
  message.textContent = t(error.message);
  button.disabled = true;
  button.textContent = t("업데이트 필요");
  banner.classList.remove("hidden");
}

if (desktopBridge) {
  desktopBridge.ensureCompatible().catch(showDesktopCompatibilityError);
}

const authSessionStorage = {
  async load() {
    if (desktopBridge) return desktopBridge.request("auth.get");
    const token = localStorage.getItem("boxing_token") || "";
    const refreshToken = localStorage.getItem("boxing_refresh_token") || "";
    return token ? { token, refreshToken, expiresAt: 0 } : null;
  },

  async save(session) {
    if (desktopBridge) {
      await desktopBridge.request("auth.set", session);
      return;
    }
    localStorage.setItem("boxing_token", session.token || "");
    if (session.refreshToken) localStorage.setItem("boxing_refresh_token", session.refreshToken);
  },

  async clear() {
    if (desktopBridge) {
      await desktopBridge.request("auth.clear");
      return;
    }
    localStorage.removeItem("boxing_token");
    localStorage.removeItem("boxing_refresh_token");
  },

  isSecureDesktop() {
    return Boolean(desktopBridge);
  },
};
