# Desktop uses the host-installed CAO server

The desktop app starts the `cao-server` already installed on the user's machine instead of bundling a Python runtime or launching the repository checkout with `uv run`. This keeps the desktop package focused on orchestration and UI, while making installation responsibility explicit: users must have a compatible CAO CLI/server available on the host path or configure the command in desktop settings. If the command is missing, the desktop app prompts the user to install CAO before opening a Workspace.
