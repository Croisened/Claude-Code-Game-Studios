# Agent Coordination Rules

1. **Vertical Delegation**: Leadership agents delegate to department leads, who
   delegate to specialists. Never skip a tier for complex decisions.
2. **Horizontal Consultation**: Agents at the same tier may consult each other
   but must not make binding decisions outside their domain.
3. **Conflict Resolution**: When two agents disagree, escalate to the shared
   parent. If no shared parent, escalate to `creative-director` for design
   conflicts or `technical-director` for technical conflicts.
4. **Change Propagation**: When a design change affects multiple domains, the
   `producer` agent coordinates the propagation.
5. **No Unilateral Cross-Domain Changes**: An agent must never modify files
   outside its designated directories without explicit delegation.
6. **Sprint Plan Live-Status Convention**: Each sprint plan's task table
   includes a **Status** column with values `Pending` → `In Progress` →
   `Done (<commit hash>)`. The plan is updated as work lands so it reads
   as a live status doc mid-sprint, not a static intent doc. When picking
   up a sprint mid-stream, scan `git log --oneline --grep="^SN-"` first
   and reconcile against the plan's task table before starting work — this
   avoids the redo pattern documented in Sprint 5 retro AI #1. The
   canonical example is `production/sprints/sprint-06.md`. Codified by
   Sprint 5 retro AI #2.
