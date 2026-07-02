import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const runtimeChildren = new Map();
const defaultSettings = {
    serverCommand: 'cao-server',
    defaultProvider: 'claude_code',
    portStart: 19889,
    portEnd: 19989,
    cleanupOnExit: true,
};
function userDataDir() {
    return app.getPath('userData');
}
function statePath() {
    return join(userDataDir(), 'desktop-state.json');
}
function defaultState() {
    return {
        settings: defaultSettings,
        workspaces: [],
    };
}
function loadState() {
    try {
        const path = statePath();
        if (!existsSync(path))
            return defaultState();
        return { ...defaultState(), ...JSON.parse(readFileSync(path, 'utf8')) };
    }
    catch {
        return defaultState();
    }
}
function saveState(state) {
    mkdirSync(userDataDir(), { recursive: true });
    writeFileSync(statePath(), JSON.stringify(state, null, 2));
}
function workspaceId(path) {
    return createHash('sha256').update(path).digest('hex').slice(0, 12);
}
function workspaceName(path) {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Workspace';
}
function upsertWorkspace(state, record) {
    const index = state.workspaces.findIndex((workspace) => workspace.id === record.id);
    if (index >= 0)
        state.workspaces[index] = record;
    else
        state.workspaces.push(record);
}
async function choosePort(start, end) {
    if (start > end)
        throw new Error('Port range start must be less than or equal to end.');
    for (let port = start; port <= end; port += 1) {
        if (await isPortFree(port))
            return port;
    }
    throw new Error(`No free port found in range ${start}-${end}.`);
}
function isPortFree(port) {
    return new Promise((resolvePort) => {
        const server = createServer();
        server.once('error', () => resolvePort(false));
        server.once('listening', () => {
            server.close(() => resolvePort(true));
        });
        server.listen(port, '127.0.0.1');
    });
}
function splitCommand(command) {
    const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
    const [binary, ...args] = parts;
    if (!binary)
        throw new Error('cao-server command is empty.');
    return { binary, args };
}
function spawnCaoServer(command, port, dataDir, workspacePath) {
    const { binary, args } = splitCommand(command);
    const child = spawn(binary, [...args, '--host', '127.0.0.1', '--port', String(port)], {
        cwd: workspacePath,
        detached: false,
        stdio: 'ignore',
        env: {
            ...process.env,
            CAO_HOME_DIR: dataDir,
            CAO_API_HOST: '127.0.0.1',
            CAO_API_PORT: String(port),
            CAO_MCP_APPS_ENABLED: 'true',
            CAO_CORS_ORIGINS: 'http://localhost:1420,http://127.0.0.1:1420,file://,null',
        },
    });
    child.on('error', () => undefined);
    return child;
}
async function waitForHealth(port) {
    const started = Date.now();
    let lastError = 'cao-server did not respond.';
    while (Date.now() - started < 20_000) {
        try {
            await healthProbe(port);
            return;
        }
        catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
        }
    }
    throw new Error(lastError);
}
function healthProbe(port) {
    return new Promise((resolveHealth, rejectHealth) => {
        const req = request({
            host: '127.0.0.1',
            port,
            path: '/health',
            method: 'GET',
            timeout: 2000,
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    rejectHealth(new Error('cao-server /health did not return 200.'));
                    return;
                }
                try {
                    const json = JSON.parse(body);
                    const capabilities = json.capabilities;
                    for (const name of [
                        'configurable_cao_home',
                        'terminal_ws',
                        'events_sse',
                        'workspace_scoped_server',
                    ]) {
                        if (capabilities?.[name] !== true) {
                            rejectHealth(new Error(`Installed cao-server is missing capability: ${name}`));
                            return;
                        }
                    }
                    resolveHealth();
                }
                catch (error) {
                    rejectHealth(error);
                }
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error('cao-server /health timed out.'));
        });
        req.on('error', rejectHealth);
        req.end();
    });
}
async function httpDelete(url) {
    await new Promise((resolveDelete) => {
        const req = request(url, { method: 'DELETE', timeout: 5000 }, () => resolveDelete());
        req.on('timeout', () => {
            req.destroy();
            resolveDelete();
        });
        req.on('error', () => resolveDelete());
        req.end();
    });
}
async function cleanupWorkspace(state, id) {
    const workspace = state.workspaces.find((item) => item.id === id);
    if (workspace?.baseUrl && workspace.sessionName) {
        await httpDelete(`${workspace.baseUrl}/sessions/${encodeURIComponent(workspace.sessionName)}`);
    }
    const child = runtimeChildren.get(id);
    if (child) {
        runtimeChildren.delete(id);
        child.kill();
    }
}
async function cleanupAll() {
    const state = loadState();
    if (!state.settings.cleanupOnExit)
        return;
    for (const id of Array.from(runtimeChildren.keys())) {
        await cleanupWorkspace(state, id);
    }
    state.workspaces = state.workspaces.map((workspace) => ({
        ...workspace,
        status: 'stopped',
        port: null,
        baseUrl: null,
        sessionName: null,
        agents: [],
    }));
    saveState(state);
}
function createWindow() {
    nativeTheme.themeSource = 'dark';
    const appRoot = app.getAppPath();
    const preloadPath = join(appRoot, 'dist-electron', 'electron', 'preload.js');
    const window = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 980,
        minHeight: 640,
        show: false,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 18, y: 18 },
        backgroundColor: '#111111',
        vibrancy: 'under-window',
        visualEffectState: 'active',
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    window.once('ready-to-show', () => window.show());
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
        void window.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
    else {
        void window.loadFile(join(appRoot, 'dist', 'index.html'));
    }
}
ipcMain.handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('list-workspaces', () => loadState().workspaces);
ipcMain.handle('get-settings', () => loadState().settings);
ipcMain.handle('save-settings', (_event, settings) => {
    const state = loadState();
    state.settings = settings;
    saveState(state);
    return settings;
});
ipcMain.handle('open-workspace', async (_event, rawPath) => {
    const canonical = realpathSync(resolve(rawPath));
    const state = loadState();
    const id = workspaceId(canonical);
    if (runtimeChildren.has(id)) {
        const existing = state.workspaces.find((workspace) => workspace.id === id);
        if (existing)
            return existing;
    }
    const port = await choosePort(state.settings.portStart, state.settings.portEnd);
    const baseUrl = `http://127.0.0.1:${port}`;
    const dataDir = join(userDataDir(), 'workspaces', id, 'cao-home');
    mkdirSync(dataDir, { recursive: true });
    const child = spawnCaoServer(state.settings.serverCommand, port, dataDir, canonical);
    runtimeChildren.set(id, child);
    let record = {
        id,
        name: workspaceName(canonical),
        path: canonical,
        port,
        baseUrl,
        status: 'starting',
        sessionName: state.workspaces.find((workspace) => workspace.id === id)?.sessionName ?? null,
        error: null,
        agents: state.workspaces.find((workspace) => workspace.id === id)?.agents ?? [],
    };
    upsertWorkspace(state, record);
    saveState(state);
    try {
        await waitForHealth(port);
        record = { ...record, status: 'ready', error: null };
    }
    catch (error) {
        child.kill();
        runtimeChildren.delete(id);
        record = {
            ...record,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
        };
    }
    const nextState = loadState();
    upsertWorkspace(nextState, record);
    saveState(nextState);
    return record;
});
ipcMain.handle('close-workspace', async (_event, id) => {
    const state = loadState();
    await cleanupWorkspace(state, id);
    state.workspaces = state.workspaces.map((workspace) => workspace.id === id
        ? {
            ...workspace,
            status: 'stopped',
            port: null,
            baseUrl: null,
            sessionName: null,
            error: null,
            agents: [],
        }
        : workspace);
    saveState(state);
    return state.workspaces;
});
ipcMain.handle('forget-workspace', async (_event, id) => {
    const state = loadState();
    await cleanupWorkspace(state, id);
    state.workspaces = state.workspaces.filter((workspace) => workspace.id !== id);
    saveState(state);
    return state.workspaces;
});
ipcMain.handle('update-workspace-session', (_event, workspaceId, sessionName) => {
    const state = loadState();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (workspace)
        workspace.sessionName = sessionName;
    saveState(state);
    return state.workspaces;
});
ipcMain.handle('record-agent', (_event, workspaceId, agent) => {
    const state = loadState();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (workspace) {
        workspace.sessionName = agent.sessionName;
        workspace.agents = workspace.agents.filter((item) => item.terminalId !== agent.terminalId);
        workspace.agents.push(agent);
    }
    saveState(state);
    return state.workspaces;
});
ipcMain.handle('remove-agent', (_event, workspaceId, terminalId) => {
    const state = loadState();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (workspace) {
        workspace.agents = workspace.agents.filter((item) => item.terminalId !== terminalId);
        if (workspace.agents.length === 0)
            workspace.sessionName = null;
    }
    saveState(state);
    return state.workspaces;
});
ipcMain.handle('update-agent-status', (_event, workspaceId, terminalId, status) => {
    const state = loadState();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    const agent = workspace?.agents.find((item) => item.terminalId === terminalId);
    if (agent)
        agent.status = status;
    saveState(state);
    return state.workspaces;
});
app.on('before-quit', (event) => {
    if (runtimeChildren.size === 0)
        return;
    event.preventDefault();
    cleanupAll()
        .catch(() => undefined)
        .finally(() => app.exit());
});
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});
