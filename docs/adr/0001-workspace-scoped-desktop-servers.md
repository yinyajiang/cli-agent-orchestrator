# Workspace-scoped desktop servers

The desktop app manages each Workspace through its own local `cao-server` process instead of sharing the existing global `localhost:9889` server. This lets users keep multiple project directories open at the same time without their Agents, Sessions, logs, or memory colliding, while preserving the existing HTTP/WebSocket control plane inside each Workspace boundary; the desktop shell is responsible for assigning local ports and tracking which server belongs to which Workspace.
