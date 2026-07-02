# Desktop first targets macOS

The first desktop release targets macOS only, even though Tauri can package other platforms. CAO's runtime depends on local terminal behavior, tmux, PTY attachment, and provider CLIs, so narrowing the initial platform keeps the desktop work focused on the existing supported operator environment before expanding to Linux or Windows.
