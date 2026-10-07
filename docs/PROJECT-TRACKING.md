# Post-production project tracking

Backend: `convex/projects.ts`, tables in `convex/projectsTables.ts` (spread into `schema.ts`). Web: `/projects`, `/projects/[id]`, and a Projects card on the dashboard (`src/components/projects/today-card.tsx`).

## Access
- Permissions: `projects.read` (every studio role), `projects.edit` (owner, manager, engineer, assistant engineer, producer, artist relations). Mapped to the `projects` entitlement (Growth) in `lib/entitlements.ts`.
- Group view `projects:crossStudio` needs an agency viewer with `agency.viewAll`, on a group whose plan includes `crossStudioProjects` (Max). It lists only the group's own studios, inside the viewer's staff scope, that themselves hold `projects`.
- The org always comes from the signed-in viewer. No function takes an `orgId`.
- Errors the app can read from `ConvexError.data.code`: `UPGRADE_REQUIRED`, `CAPABILITY_DENIED`, `NO_WORKSPACE`, `NOT_FOUND`, `INVALID`. The app must not show plan wording; treat `UPGRADE_REQUIRED` as "not available" and hide the surface.

## Mirror (how iOS reads data)
`projects`, `projectTasks`, `projectLinks` are in `convex/lib/mirroredTables.ts` (`MIRRORED_TABLES`, gate `projects.read`). The app pulls them through `sync.snapshot` / `sync.pullChanges` like the other mirrored tables. Every column is safe to hold on a device (no money, no secrets). Rows written while a studio holds `projects` stay in the mirror if it later loses it; no new writes are accepted.

## Mutations the app calls (all plain, args are ids and scalars; dates are ms epoch)
| Function | Args | Returns |
|---|---|---|
| `projects:create` | `name`, `stage?`, `ownerMemberId?`, `dueDate?`, `notes?`, `songId?`, `links?: [{kind, refId}]` | project id |
| `projects:update` | `id`, `name?`, `ownerMemberId?` (null clears), `dueDate?` (null clears), `notes?` (null clears), `songId?` (null clears) | void |
| `projects:setStage` | `id`, `stage` | `{changed, songMoved?}` |
| `projects:archive` / `projects:remove` | `id` | void |
| `projects:addTask` | `projectId`, `title`, `stage?`, `ownerMemberId?`, `dueDate?` | task id |
| `projects:updateTask` | `id`, `title?`, `stage?` / `ownerMemberId?` / `dueDate?` (null clears) | void |
| `projects:setTaskDone` | `id`, `done` | void |
| `projects:removeTask` | `id` | void |
| `projects:addLink` | `projectId`, `kind`, `refId` | link id (existing id if already linked) |
| `projects:removeLink` | `id` | void |

Queries: `projects:board`, `projects:get`, `projects:todayCards` (returns `{enabled:false}` instead of throwing, so the Today screen just omits the card), `projects:linkCandidates`, `projects:crossStudio`.

Stages, in order: `tracking`, `editing`, `mixing`, `mastering`, `delivery`, `complete`. Link kinds: `session`, `song`, `room`, `engineer` (a member), `invoice` (needs `invoices.read`), `deliverable`, `opportunity`, `artist`. Every linked id is checked to belong to the caller's studio.

## Side effects
- `setStage` moves the linked song (tracking, editing, mixing, mastering, delivery becomes `delivered`) when the caller holds `songs.edit`; a released song is never moved. It writes `activity` rows and emails the project owner (fallback: studio owner) through `notifyTeam`.
- `projects:sendDueReminders` runs daily (`convex/crons.ts`): one note per live project that is overdue or due within 24 hours, or has such tasks, to the project owner; other task owners get their own note. At most one per project per 20 hours.
- Changes appear in the studio change log (area "Projects") through the audit trigger.
