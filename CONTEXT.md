# CLI Agent Orchestrator

CLI Agent Orchestrator coordinates CLI-based AI agents for human operators and external control surfaces.

## Language

**Workspace**:
A user-selected project directory that scopes the agents a human is currently managing.
_Avoid_: Project, workdir

**Agent**:
A running AI assistant instance managed by CAO within a Workspace.
_Avoid_: Terminal, window

**Agent Profile**:
A reusable role definition used when starting an Agent.
_Avoid_: Agent, role file

**Session**:
A CAO grouping of related Agents within a Workspace.
_Avoid_: Workspace, project, agent list
