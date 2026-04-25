# Claude Code Game Studios -- Game Studio Agent Architecture

Indie game development managed through 48 coordinated Claude Code subagents.
Each agent owns a specific domain, enforcing separation of concerns and quality.

## Technology Stack

- **Engine**: Three.js r168+ (web 3D rendering — scene graph, materials, animation)
- **UI Framework**: Preact 10.22+ via `@preact/preset-vite` (single-page app shell, hash routing)
- **Language**: TypeScript (strict mode, browser target)
- **Version Control**: Git with trunk-based development
- **Build System**: Vite
- **Asset Pipeline**: GLB models (Three.js GLTFLoader) + PNG texture sets

> **Note**: This project uses Three.js (not Godot/Unity/Unreal). Engine-specialist
> subagents (godot-specialist, unity-specialist, etc.) do not apply. Use
> `gameplay-programmer` and `engine-programmer` agents for implementation work.
>
> **Pivot history**: Sprints 1–3 used Three.js + enable3d + Rapier physics for an
> endless-runner prototype. After the Sprint 3 retrospective the project pivoted
> to Robo Rhapsody Sim (a passive-watch event simulator) and the runner stack is
> archived under `archive/endless-runner/`. v1 has no physics — robots are
> kinematic, position-driven by the sim.

## Project Structure

@.claude/docs/directory-structure.md

## Engine Version Reference

@docs/engine-reference/three-js/VERSION.md

## Technical Preferences

@.claude/docs/technical-preferences.md

## Coordination Rules

@.claude/docs/coordination-rules.md

## Collaboration Protocol

**User-driven collaboration, not autonomous execution.**
Every task follows: **Question -> Options -> Decision -> Draft -> Approval**

- Agents MUST ask "May I write this to [filepath]?" before using Write/Edit tools
- Agents MUST show drafts or summaries before requesting approval
- Multi-file changes require explicit approval for the full changeset
- No commits without user instruction

See `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` for full protocol and examples.

> **First session?** If the project has no engine configured and no game concept,
> run `/start` to begin the guided onboarding flow.

## Coding Standards

@.claude/docs/coding-standards.md

## Context Management

@.claude/docs/context-management.md
