(() => {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  if (window.BoxingCoachAndroid) return;

  let waitingWorker = null;
  let reloading = false;
  const banner = document.querySelector("#updateBanner");
  const message = document.querySelector("#updateBannerMessage");
  const applyButton = document.querySelector("#applyWebUpdate");

  const sessionIsActive = () => Boolean(state.activeSessionId);
  const syncBanner = () => {
    if (banner.dataset.desktopCompatibility === "error") return;
    if (!waitingWorker) {
      banner.classList.add("hidden");
      return;
    }
    const blocked = sessionIsActive();
    message.textContent = blocked
      ? t("진행 중인 운동을 종료하면 업데이트할 수 있습니다.")
      : t("지금 적용하면 새 웹 화면으로 다시 시작합니다.");
    applyButton.disabled = blocked;
    banner.classList.remove("hidden");
  };

  applyButton.addEventListener("click", () => {
    if (!waitingWorker || sessionIsActive()) return;
    applyButton.disabled = true;
    waitingWorker.postMessage({ type: "ACTIVATE_UPDATE" });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("/service-worker.js").then((registration) => {
    if (registration.waiting) {
      waitingWorker = registration.waiting;
      syncBanner();
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorker = installing;
          syncBanner();
        }
      });
    });
    window.setInterval(() => {
      registration.update().catch(() => {});
      syncBanner();
    }, 60_000);
  }).catch((error) => console.warn("PWA service worker registration failed", error));
})();
