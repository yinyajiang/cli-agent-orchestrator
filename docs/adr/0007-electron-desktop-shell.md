# Electron desktop shell

The desktop app uses Electron for the macOS shell instead of Tauri. Electron gives the app direct access to the host-installed `cao-server` process lifecycle, native file selection, preload-mediated IPC, and macOS visual effects while keeping the renderer as React and Tailwind; the trade-off is a larger desktop runtime in exchange for simpler Node-based integration with local developer tooling.
