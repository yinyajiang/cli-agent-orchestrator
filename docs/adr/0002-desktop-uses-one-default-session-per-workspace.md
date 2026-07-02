# Desktop uses one default session per workspace

The desktop app presents a Workspace as a list of Agents and keeps the underlying CAO Session as an internal grouping. A Workspace starts its default Session when the first Agent is launched, and additional Agents join that Session, because exposing Sessions as a first-class desktop navigation level would duplicate the Workspace concept for the common case while making multi-agent collaboration less direct.
