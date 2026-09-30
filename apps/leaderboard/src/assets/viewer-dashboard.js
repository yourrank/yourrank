(() => {
  let activeMount = null;

  function initViewerAccount() {
    const mount = document.getElementById("vd-app");
    if (!mount) return;
    if (activeMount?.mount === mount) return activeMount.ready;
    if (activeMount) activeMount.unmount();

    const controller = new AbortController();
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const instance = {
      mount,
      controller,
      ready,
      root: null,
      settled: false,
      resolve() {
        if (instance.settled) return;
        instance.settled = true;
        resolveReady();
      },
      reject(error) {
        if (instance.settled) return;
        instance.settled = true;
        rejectReady(error);
      },
      unmount() {
        if (activeMount === instance) activeMount = null;
        document.removeEventListener("yr:viewer-unmount", handleUnmount);
        controller.abort();
        instance.root?.unmount();
        instance.resolve();
      },
    };
    function handleUnmount() {
      instance.unmount();
    }

    activeMount = instance;
    window.__yrViewerReady = ready;
    document.addEventListener("yr:viewer-unmount", handleUnmount, { once: true });

    const loadBundle = window.__yrViewerAccountBundleLoader || (() => import("./react/viewer-account.js"));
    loadBundle()
      .then(({ mountViewerAccount }) => {
        if (controller.signal.aborted || document.getElementById("vd-app") !== mount) {
          instance.resolve();
          return;
        }
        instance.root = mountViewerAccount(mount, {
          signal: controller.signal,
          onFirstLoadCommitted: () => instance.resolve(),
        });
      })
      .catch((error) => {
        if (activeMount === instance) {
          document.removeEventListener("yr:viewer-unmount", handleUnmount);
          activeMount = null;
          controller.abort();
        }
        instance.reject(error);
      });

    return ready;
  }

  window.YRInitViewerAccount = initViewerAccount;
  const firstReady = initViewerAccount();
  if (firstReady) void firstReady.catch(() => {});
})();
