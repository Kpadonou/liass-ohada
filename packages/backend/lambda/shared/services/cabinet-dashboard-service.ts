import type { AccountingWorkStatus } from "@liass-ohada/shared";
import type {
  CabinetDashboardResponse,
  CabinetDashboardScope,
} from "@liass-ohada/shared/shared";
import { CabinetDashboardResponseSchema } from "@liass-ohada/shared/shared";
import { AppError } from "../app-error";
import type { CabinetRequestContext } from "./cabinet-authorization-service";
import { CabinetAuthorizationService } from "./cabinet-authorization-service";
import type {
  CabinetDeadlineRecord,
  CabinetWorkRecord,
  Page,
} from "../repositories/cabinet-operations-repository";
import { CabinetOperationsRepository } from "../repositories/cabinet-operations-repository";
import { CabinetDossierRepository } from "../repositories/cabinet-dossier-repository";
import type {
  CabinetDossierRecord,
  CabinetMemberRecord,
} from "../repositories/cabinet-team-repository";
import { CabinetTeamRepository } from "../repositories/cabinet-team-repository";
import { UserProfileRepository } from "../repositories/user-profile-repository";

const ACTIVE_WORK_STATUSES: AccountingWorkStatus[] = [
  "TO_PLAN",
  "TO_DO",
  "IN_PROGRESS",
  "WAITING",
];
const INACTIVE_WORK_STATUSES = new Set<AccountingWorkStatus>([
  "COMPLETED",
  "CANCELLED",
]);
const DEFAULT_ATTENTION_LIMIT = 5;
const MAX_DASHBOARD_AGGREGATION_ITEMS = 1_000;
const DASHBOARD_QUERY_PAGE_SIZE = 100;
const MAX_PARALLEL_DOSSIER_QUERIES = 5;

interface DashboardContext {
  userId: string;
  cabinetOrgId: string;
  cabinetId: string;
  role: NonNullable<CabinetMemberRecord["cabinetRole"]>;
  scope: CabinetDashboardScope;
  assignedDossierOrgIds?: Set<string>;
  activeDossiers: CabinetDossierRecord[];
  asOfDate: string;
  generatedAt: string;
}

type QueryPage<T> = (cursor?: string) => Promise<Page<T>>;

function currentDateOnly(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return currentDateOnly(date);
}

function scopeForRole(role: DashboardContext["role"]): CabinetDashboardScope {
  if (role === "CABINET_ADMIN") return "CABINET";
  if (role === "SUPERVISOR") return "SUPERVISED_DOSSIERS";
  if (role === "COLLABORATOR") return "PERSONAL_ACTIVITY";
  return "ASSIGNED_DOSSIERS_READ_ONLY";
}

function assertWithinLimit(count: number): void {
  if (count > MAX_DASHBOARD_AGGREGATION_ITEMS) {
    throw new AppError(413, "CABINET_DASHBOARD_AGGREGATION_LIMIT_EXCEEDED");
  }
}

async function collectAll<T>(query: QueryPage<T>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await query(cursor);
    items.push(...page.items);
    assertWithinLimit(items.length);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      results.push(...await mapper(value));
      assertWithinLimit(results.length);
    }
  });
  await Promise.all(workers);
  return results;
}

function isActiveWork(work: CabinetWorkRecord): boolean {
  return ACTIVE_WORK_STATUSES.includes(work.status);
}

function isOverdueWork(work: CabinetWorkRecord, asOfDate: string): boolean {
  return Boolean(
    work.dueDate &&
      work.dueDate < asOfDate &&
      !INACTIVE_WORK_STATUSES.has(work.status),
  );
}

function isDueSoonWork(work: CabinetWorkRecord, asOfDate: string): boolean {
  return Boolean(
    work.dueDate &&
      work.dueDate >= asOfDate &&
      work.dueDate <= addDays(asOfDate, 7) &&
      !INACTIVE_WORK_STATUSES.has(work.status),
  );
}

function isPendingDeadline(deadline: CabinetDeadlineRecord): boolean {
  return deadline.status === "PENDING";
}

function deadlineAttentionSort(
  left: CabinetDeadlineRecord,
  right: CabinetDeadlineRecord,
): number {
  return (
    left.dueDate.localeCompare(right.dueDate) ||
    left.deadlineId.localeCompare(right.deadlineId)
  );
}

function workAttentionSort(
  left: CabinetWorkRecord,
  right: CabinetWorkRecord,
): number {
  return (
    (left.dueDate ?? "").localeCompare(right.dueDate ?? "") ||
    left.workId.localeCompare(right.workId)
  );
}

async function resolveDashboardContext(
  context: CabinetRequestContext,
  now: Date,
): Promise<DashboardContext> {
  const authorized = await CabinetAuthorizationService.requireActiveMembership(context);
  const role = authorized.caller.cabinetRole;
  if (!role) throw new AppError(403, "CABINET_DASHBOARD_ACCESS_FORBIDDEN");
  const scope = scopeForRole(role);
  const asOfDate = currentDateOnly(now);
  const generatedAt = now.toISOString();

  if (role === "CABINET_ADMIN") {
    const activeDossiers = await CabinetTeamRepository.getCurrentDossiers(
      authorized.cabinetId,
      (await collectAll((cursor) =>
        CabinetDossierRepository.listClientDossiersForDashboard({
          cabinetOrgId: authorized.cabinetOrgId,
          cabinetId: authorized.cabinetId,
          cursor,
          limit: DASHBOARD_QUERY_PAGE_SIZE,
        }),
      )).map((dossier) => dossier.orgId),
    );
    return {
      activeDossiers: activeDossiers.filter((dossier) => dossier.status === "ACTIVE"),
      asOfDate,
      cabinetId: authorized.cabinetId,
      cabinetOrgId: authorized.cabinetOrgId,
      generatedAt,
      role,
      scope,
      userId: context.userId,
    };
  }

  const assignments = await CabinetTeamRepository.listMemberAssignments(
    authorized.cabinetOrgId,
    context.userId,
  );
  const assignedDossierOrgIds = new Set(
    assignments.map((assignment) => assignment.dossierOrgId),
  );
  const activeDossiers = (
    await CabinetTeamRepository.getCurrentDossiers(
      authorized.cabinetId,
      [...assignedDossierOrgIds],
    )
  ).filter((dossier) => dossier.status === "ACTIVE");
  return {
    activeDossiers,
    assignedDossierOrgIds: new Set(activeDossiers.map((dossier) => dossier.orgId)),
    asOfDate,
    cabinetId: authorized.cabinetId,
    cabinetOrgId: authorized.cabinetOrgId,
    generatedAt,
    role,
    scope,
    userId: context.userId,
  };
}

async function listWorksForScope(
  context: DashboardContext,
): Promise<CabinetWorkRecord[]> {
  if (context.scope === "CABINET") {
    return collectAll((cursor) =>
      CabinetOperationsRepository.listWorksByCabinet({
        cabinetOrgId: context.cabinetOrgId,
        cursor,
        limit: DASHBOARD_QUERY_PAGE_SIZE,
      }),
    );
  }
  return mapWithConcurrency(
    context.activeDossiers.map((dossier) => dossier.orgId),
    MAX_PARALLEL_DOSSIER_QUERIES,
    (dossierOrgId) =>
      collectAll((cursor) =>
        CabinetOperationsRepository.listWorksByDossier({
          cabinetOrgId: context.cabinetOrgId,
          cursor,
          dossierOrgId,
          limit: DASHBOARD_QUERY_PAGE_SIZE,
        }),
      ),
  ).then((works) =>
    context.scope === "PERSONAL_ACTIVITY"
      ? works.filter(
          (work) =>
            work.responsibleUserId === context.userId ||
            work.participantUserIds.includes(context.userId),
        )
      : works,
  );
}

async function listDeadlinesForScope(
  context: DashboardContext,
): Promise<CabinetDeadlineRecord[]> {
  if (context.scope === "CABINET") {
    return collectAll((cursor) =>
      CabinetOperationsRepository.listDeadlinesByCabinet({
        cabinetOrgId: context.cabinetOrgId,
        cursor,
        limit: DASHBOARD_QUERY_PAGE_SIZE,
      }),
    );
  }
  if (context.scope === "PERSONAL_ACTIVITY") {
    return collectAll((cursor) =>
      CabinetOperationsRepository.listDeadlinesByResponsibleUser({
        cabinetOrgId: context.cabinetOrgId,
        cursor,
        limit: DASHBOARD_QUERY_PAGE_SIZE,
        responsibleUserId: context.userId,
      }),
    );
  }
  return mapWithConcurrency(
    context.activeDossiers.map((dossier) => dossier.orgId),
    MAX_PARALLEL_DOSSIER_QUERIES,
    (dossierOrgId) =>
      collectAll((cursor) =>
        CabinetOperationsRepository.listDeadlinesByDossier({
          cabinetOrgId: context.cabinetOrgId,
          cursor,
          dossierOrgId,
          limit: DASHBOARD_QUERY_PAGE_SIZE,
        }),
      ),
  );
}

function workMetrics(works: CabinetWorkRecord[], asOfDate: string) {
  const metrics = {
    totalActive: 0,
    toPlan: 0,
    toDo: 0,
    inProgress: 0,
    waiting: 0,
    overdue: 0,
    dueSoon: 0,
    unassigned: 0,
  };
  for (const work of works) {
    if (isActiveWork(work)) {
      metrics.totalActive += 1;
      if (work.status === "TO_PLAN") metrics.toPlan += 1;
      if (work.status === "TO_DO") metrics.toDo += 1;
      if (work.status === "IN_PROGRESS") metrics.inProgress += 1;
      if (work.status === "WAITING") metrics.waiting += 1;
      if (!work.responsibleUserId) metrics.unassigned += 1;
    }
    if (isOverdueWork(work, asOfDate)) metrics.overdue += 1;
    if (isDueSoonWork(work, asOfDate)) metrics.dueSoon += 1;
  }
  return metrics;
}

function deadlineMetrics(deadlines: CabinetDeadlineRecord[], asOfDate: string) {
  const plus7 = addDays(asOfDate, 7);
  const plus30 = addDays(asOfDate, 30);
  const metrics = {
    pending: 0,
    overdue: 0,
    dueToday: 0,
    next7Days: 0,
    next30Days: 0,
  };
  for (const deadline of deadlines) {
    if (!isPendingDeadline(deadline)) continue;
    metrics.pending += 1;
    if (deadline.dueDate < asOfDate) metrics.overdue += 1;
    if (deadline.dueDate === asOfDate) metrics.dueToday += 1;
    if (deadline.dueDate > asOfDate && deadline.dueDate <= plus7) {
      metrics.next7Days += 1;
    }
    if (deadline.dueDate > plus7 && deadline.dueDate <= plus30) {
      metrics.next30Days += 1;
    }
  }
  return metrics;
}

async function teamSummary(context: DashboardContext) {
  if (context.scope !== "CABINET") return undefined;
  const members = await CabinetTeamRepository.listAllMembers(context.cabinetOrgId);
  return members.reduce(
    (summary, member) => {
      if (member.status !== "ACTIVE") return summary;
      summary.activeMembers += 1;
      if (member.cabinetRole === "CABINET_ADMIN") summary.administrators += 1;
      if (member.cabinetRole === "SUPERVISOR") summary.supervisors += 1;
      if (member.cabinetRole === "COLLABORATOR") summary.collaborators += 1;
      if (member.cabinetRole === "READER") summary.readers += 1;
      return summary;
    },
    {
      activeMembers: 0,
      administrators: 0,
      supervisors: 0,
      collaborators: 0,
      readers: 0,
    },
  );
}

function dossierNameMap(dossiers: CabinetDossierRecord[]) {
  return new Map(
    dossiers.flatMap((dossier) =>
      dossier.displayName ? [[dossier.orgId, dossier.displayName] as const] : [],
    ),
  );
}

async function responsibleNameMap(
  works: CabinetWorkRecord[],
  deadlines: CabinetDeadlineRecord[],
) {
  const ids = [
    ...works.flatMap((work) => work.responsibleUserId ? [work.responsibleUserId] : []),
    ...deadlines.flatMap((deadline) =>
      deadline.responsibleUserId ? [deadline.responsibleUserId] : [],
    ),
  ];
  const profiles = await UserProfileRepository.batchGet(ids);
  return new Map([...profiles].map(([userId, profile]) => [userId, profile.displayName]));
}

function workAttentionItem(
  work: CabinetWorkRecord,
  dossiers: Map<string, string>,
  users: Map<string, string>,
) {
  return {
    workId: work.workId,
    dossierOrgId: work.dossierOrgId,
    dossierName: work.dossierName ?? dossiers.get(work.dossierOrgId),
    title: work.title,
    type: work.type,
    priority: work.priority,
    status: work.status,
    responsibleUserId: work.responsibleUserId,
    responsibleDisplayName:
      work.responsibleDisplayName ??
      (work.responsibleUserId ? users.get(work.responsibleUserId) : undefined),
    dueDate: work.dueDate,
  };
}

function deadlineAttentionItem(
  deadline: CabinetDeadlineRecord,
  dossiers: Map<string, string>,
  users: Map<string, string>,
) {
  return {
    deadlineId: deadline.deadlineId,
    dossierOrgId: deadline.dossierOrgId,
    dossierName: deadline.dossierName ?? dossiers.get(deadline.dossierOrgId),
    title: deadline.title,
    type: deadline.type,
    priority: deadline.priority,
    status: deadline.status,
    responsibleUserId: deadline.responsibleUserId,
    responsibleDisplayName:
      deadline.responsibleDisplayName ??
      (deadline.responsibleUserId ? users.get(deadline.responsibleUserId) : undefined),
    dueDate: deadline.dueDate,
    linkedWorkId: deadline.linkedWorkId,
  };
}

async function buildAttention(input: {
  context: DashboardContext;
  works: CabinetWorkRecord[];
  deadlines: CabinetDeadlineRecord[];
  limit: number;
}) {
  const overdueWorks = input.works
    .filter((work) => work.dueDate && isOverdueWork(work, input.context.asOfDate))
    .sort(workAttentionSort)
    .slice(0, input.limit);
  const unassignedWorks =
    input.context.scope === "CABINET" || input.context.scope === "SUPERVISED_DOSSIERS"
      ? input.works
          .filter((work) => work.dueDate && isActiveWork(work) && !work.responsibleUserId)
          .sort(workAttentionSort)
          .slice(0, input.limit)
      : [];
  const overdueDeadlines = input.deadlines
    .filter(
      (deadline) =>
        deadline.status === "PENDING" && deadline.dueDate < input.context.asOfDate,
    )
    .sort(deadlineAttentionSort)
    .slice(0, input.limit);
  const upcomingDeadlines = input.deadlines
    .filter(
      (deadline) =>
        deadline.status === "PENDING" &&
        deadline.dueDate >= input.context.asOfDate &&
        deadline.dueDate <= addDays(input.context.asOfDate, 30),
    )
    .sort(deadlineAttentionSort)
    .slice(0, input.limit);
  const users = await responsibleNameMap(
    [...overdueWorks, ...unassignedWorks],
    [...overdueDeadlines, ...upcomingDeadlines],
  );
  const dossiers = dossierNameMap(input.context.activeDossiers);
  return {
    overdueWorks: overdueWorks
      .map((work) => workAttentionItem(work, dossiers, users))
      .filter((item) => Boolean(item.dueDate)),
    overdueDeadlines: overdueDeadlines.map((deadline) =>
      deadlineAttentionItem(deadline, dossiers, users),
    ),
    upcomingDeadlines: upcomingDeadlines.map((deadline) =>
      deadlineAttentionItem(deadline, dossiers, users),
    ),
    ...((input.context.scope === "CABINET" ||
      input.context.scope === "SUPERVISED_DOSSIERS") && {
      unassignedWorks: unassignedWorks
        .map((work) => workAttentionItem(work, dossiers, users))
        .filter((item) => Boolean(item.dueDate)),
    }),
  };
}

export class CabinetDashboardService {
  static async getDashboard(
    context: CabinetRequestContext,
    input: { attentionLimit?: number; now?: Date } = {},
  ): Promise<CabinetDashboardResponse> {
    const attentionLimit = input.attentionLimit ?? DEFAULT_ATTENTION_LIMIT;
    const dashboardContext = await resolveDashboardContext(
      context,
      input.now ?? new Date(),
    );
    const [cabinetOrg, team, works, deadlines] = await Promise.all([
      CabinetTeamRepository.getOrganization(dashboardContext.cabinetOrgId),
      teamSummary(dashboardContext),
      listWorksForScope(dashboardContext),
      listDeadlinesForScope(dashboardContext),
    ]);

    const response = {
      generatedAt: dashboardContext.generatedAt,
      asOfDate: dashboardContext.asOfDate,
      scope: dashboardContext.scope,
      cabinet: {
        cabinetOrgId: dashboardContext.cabinetOrgId,
        displayName: cabinetOrg?.name ?? dashboardContext.cabinetOrgId,
      },
      portfolio: {
        accessibleDossiers: dashboardContext.activeDossiers.length,
        activeDossiers: dashboardContext.activeDossiers.length,
      },
      team,
      work: {
        ...workMetrics(works, dashboardContext.asOfDate),
        ...(dashboardContext.scope === "PERSONAL_ACTIVITY"
          ? { unassigned: undefined }
          : {}),
      },
      deadlines: deadlineMetrics(deadlines, dashboardContext.asOfDate),
      attention: await buildAttention({
        context: dashboardContext,
        deadlines,
        limit: attentionLimit,
        works,
      }),
    };

    return CabinetDashboardResponseSchema.parse(response);
  }
}
