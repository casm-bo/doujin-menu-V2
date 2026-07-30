const { contextBridge, ipcRenderer } = require("electron");

const invokeChannels = new Set([
  "add-book-history",
  "add-book-to-series",
  "add-library-folder",
  "add-preset",
  "add-to-download-queue",
  "auto-detect-series-for-book",
  "backup-database",
  "check-book-exists-by-hitomi-id",
  "check-for-updates",
  "clear-book-history",
  "clear-completed-downloads",
  "clear-lock-password",
  "clear-temp-files",
  "create-companion-pairing-code",
  "create-series-collection",
  "delete-book",
  "delete-book-history",
  "delete-duplicate-books",
  "delete-preset",
  "delete-series-collection",
  "download-temp-thumbnail",
  "download-update",
  "generate-missing-info-files",
  "get-app-usage-stats",
  "get-app-version",
  "get-artists",
  "get-artists-with-count",
  "get-book",
  "get-book-current-page",
  "get-book-history",
  "get-book-page-paths",
  "get-books",
  "get-characters",
  "get-characters-with-count",
  "get-companion-devices",
  "get-companion-status",
  "get-companion-sync-status",
  "get-config",
  "get-config-value",
  "get-download-queue",
  "get-duplicate-groups",
  "get-gallery-details",
  "get-gallery-image-urls",
  "get-groups",
  "get-groups-with-count",
  "get-initial-lock-status",
  "get-languages",
  "get-library-folder-stats",
  "get-library-size",
  "get-next-book",
  "get-next-book-in-series",
  "get-presets",
  "get-prev-book",
  "get-previous-book-in-series",
  "get-random-book",
  "get-series",
  "get-series-books",
  "get-series-collection-by-id",
  "get-series-collections",
  "get-series-with-count",
  "get-statistics",
  "get-tags",
  "get-tags-with-count",
  "get-temp-files-size",
  "get-types",
  "get-window-maximized-state",
  "install-update",
  "is-fullscreen-window",
  "is-new-window",
  "open-book-folder",
  "open-book-with-external-viewer",
  "open-folder",
  "open-with-external-program",
  "pause-download",
  "regenerate-all-thumbnails",
  "remove-book-from-series",
  "remove-from-download-queue",
  "remove-library-folder",
  "reorder-books-in-series",
  "rescan-all-metadata",
  "rescan-book-metadata",
  "rescan-library-folder",
  "reset-all-data",
  "restore-database",
  "resume-download",
  "retry-download",
  "revoke-companion-device",
  "run-companion-sync",
  "run-series-detection",
  "search-galleries",
  "select-external-archive-viewer",
  "select-external-image-viewer",
  "select-folder",
  "set-config",
  "set-lock-password",
  "start-companion-server",
  "stop-companion-server",
  "toggle-book-favorite",
  "update-book-current-page",
  "update-preset",
  "update-series-collection",
  "verify-lock-password",
]);

const sendChannels = new Set([
  "close-current-window",
  "close-window",
  "fullscreen-toggle-window",
  "maximize-toggle-window",
  "minimize-window",
  "open-external-link",
  "open-log-folder",
  "open-new-window",
  "renderer-ready",
  "set-fullscreen-window",
  "set-window-title",
  "toggle-dev-tools",
]);

const eventChannels = new Set([
  "books-updated",
  "download-progress",
  "download-queue-updated",
  "info-generation-progress",
  "library-scan-progress",
  "series-collections-updated",
  "update-status",
  "window-maximized",
]);

function assertAllowed(channels, channel) {
  if (!channels.has(channel))
    throw new Error(`IPC channel not allowed: ${channel}`);
}

const ipcBridge = {
  invoke(channel, ...args) {
    assertAllowed(invokeChannels, channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel, ...args) {
    assertAllowed(sendChannels, channel);
    ipcRenderer.send(channel, ...args);
  },
  on(channel, listener) {
    assertAllowed(eventChannels, channel);
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.off(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld("ipcRenderer", ipcBridge);
