# Forbidden Behaviors

## Project Reality
Never invent:
- files,
- routes,
- APIs,
- fields,
- SDK methods,
- environment variables,
- package versions,
- tests,
- deployment behavior.

## Duplicate Implementations
Never create a second implementation because the first is difficult to change.

Do not create casual:
- `DashboardV2`,
- `DashboardNew`,
- `DashboardFinal`,
- `NewButton`,
- `ModernModal`,
- `NewUserContext`,
- `legacy/new` parallel state,

unless an intentional migration/versioning plan requires it.

## Fake Completion
Never hide missing work behind:
- mocks,
- hardcoded data,
- placeholder UI,
- TODOs,
- dummy callbacks,
- static success,
- unconnected buttons.

## Test Manipulation
Never:
- delete valid failing tests to get green,
- weaken assertions to match broken code,
- skip tests without justification,
- claim tests ran when they did not.

## Error Hiding
Never:
- use empty `catch`,
- suppress failures without handling,
- remove logs solely to hide errors,
- convert errors to success silently.

## Security
Never:
- hardcode secrets,
- expose private keys/tokens,
- trust client validation as authorization,
- bypass permissions,
- log sensitive information.

## Destructive Work
Never treat these as routine:
- data deletion,
- schema drops,
- account deletion,
- billing changes,
- permission changes,
- production configuration changes.

## Architecture
Never:
- fork architecture to avoid understanding it,
- keep old/new systems indefinitely without a migration requirement,
- create multiple sources of truth,
- rewrite unrelated code because another style is preferred.

## UI
Never:
- create parallel design systems casually,
- rebuild shared components differently per page,
- copy backend fields directly into UI without product reasoning,
- add gradients/shadows/cards merely to make a page look "modern."

## Stack Freshness
Never use a remembered old/deprecated API without first checking the repository's actual installed version when the behavior is version-sensitive.

## Generated / Machine-Managed Files

Never manually patch generated output as the permanent fix when a source generator/schema/config exists.

Do not hand-edit dependency lockfile internals to simulate a package-manager operation.

## Workspace Mistakes

Never run broad dependency upgrades or repository-wide commands before identifying the workspace/package boundary in a monorepo.

## Feature-Flag Fossils

Never leave old and new implementations permanently alive behind a completed rollout flag.

## Imported Skill Trust

Never execute a newly imported third-party skill's scripts before reviewing its permissions and behavior.

## Incident Scope Creep

Never perform unrelated cleanup/refactoring during an active production incident unless it is necessary to restore service safely.

## UI/UX Anti-Patterns

Never:
- turn every dashboard section into a card by default,
- create a marketing hero inside an operational dashboard without a product reason,
- hide primary actions inside overflow menus merely for visual cleanliness,
- expose implementation/database terminology when user-goal language exists,
- use a modal for a complex multi-step workflow merely to avoid navigation,
- use placeholders as labels,
- rely on color alone for status,
- hide critical functionality on mobile simply to make a screenshot cleaner,
- create hierarchy by making everything large and bold,
- use empty space as a substitute for information architecture,
- use fake metrics/data to make a dashboard appear complete,
- redesign one page into a different product identity than the rest of the application.

## Verification Overclaiming

Never:
- claim a whole class is fixed because one instance test passes,
- use a hand-written route list when route scope can be derived automatically,
- silently exclude untested routes/states/packages from a global claim,
- use "permanently fixed", "cannot regress", or equivalent without named enforcement,
- report `Verified` for a route or state that was not actually rendered/executed/checked,
- silently resolve a materially ambiguous requirement in favor of the easiest implementation.

## Recursive Hardening / Scope Drift

Never:
- create a new hardening phase merely because verification found optional debt,
- turn every new finding into mandatory current-scope work,
- silently move the finish line after acceptance criteria pass,
- transform a personal/internal project into a public-SaaS threat model without evidence,
- keep working because the repository could theoretically be improved further,
- block completion on speculative optimization or unrelated cleanup,
- use "production readiness" as an unbounded excuse for never finishing.

## v7 Design-over-Design / Instruction Conflicts

Never:
- treat the existence of a new UI as proof that the old UI was removed;
- stack CSS, providers, layouts or state branches over an unexplained legacy path;
- let imported aesthetic guidance override explicit product/task constraints;
- convert a product dashboard into a marketing composition merely because a reference or third-party skill favors it;
- use an AI-slop heuristic as an automatic design verdict without rendered/product evidence;
- make a third speculative implementation attempt after two failures without resetting the root-cause model.
