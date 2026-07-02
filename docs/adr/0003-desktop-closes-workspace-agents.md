# Desktop closes workspace agents

When the desktop app closes a Workspace or exits normally, it shuts down that Workspace's Agents instead of leaving them running in the terminal backend. This treats the Workspace as the user's explicit runtime boundary: open means managed and visible, closed means stopped, trading background continuity for predictable cleanup of local agent processes. Crash and force-quit recovery can detect leftovers on the next launch, but normal shutdown is responsible for cleanup.
