/* eslint-disable max-lines -- Web 移动端远控任务首页包含工作区分组、时间线、手风琴列表与偏好持久化 */
import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  Loader2,
  RefreshCw,
  Sun,
  Moon,
  Laptop,
  Plus,
  SlidersHorizontal,
  Clock,
  Calendar,
  Layers,
  CheckCircle2,
  Pin,
} from "lucide-react";

export interface MobileWorkspaceItem {
  workspacePath: string;
  workspaceIdentity?: string;
  kind?: "local" | "remote";
  name?: string;
  workspacePurpose?: string;
  connectionState?: string;
  lastConnectionError?: string;
}

export interface MobileTaskItem {
  taskId: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
  createdAt?: number;
  updatedAt: number;
  displayStatus?: string;
  status?: string;
  hasBackgroundWork?: boolean;
  pinned?: boolean;
  archived?: boolean;
  unreadAt?: number;
}

interface WebRemoteMobileHomeProps {
  workspaces: MobileWorkspaceItem[];
  tasks: MobileTaskItem[];
  activeWorkspacePath?: string;
  activeTaskId?: string;
  onSelectTask: (workspace: MobileWorkspaceItem, taskId: string) => void;
  onStartDraftInWorkspace?: (workspace: MobileWorkspaceItem) => void;
  onEnterActiveChat?: () => void;
  onRefresh?: () => void;
  deviceName?: string;
}

type OrganizeBy = "workspace" | "timeline";
type SortBy = "updated" | "created";

interface HomePreferences {
  organizeBy: OrganizeBy;
  sortBy: SortBy;
}

const PREF_STORAGE_KEY = "zcode-web-remote-control-mobile-task-home-preferences";

function loadPreferences(): HomePreferences {
  if (typeof window === "undefined") return { organizeBy: "workspace", sortBy: "updated" };
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) return { organizeBy: "workspace", sortBy: "updated" };
    const parsed = JSON.parse(raw);
    return {
      organizeBy: parsed.organizeBy === "timeline" ? "timeline" : "workspace",
      sortBy: parsed.sortBy === "created" ? "created" : "updated",
    };
  } catch {
    return { organizeBy: "workspace", sortBy: "updated" };
  }
}

function savePreferences(pref: HomePreferences) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(pref));
  } catch {}
}

function formatRelativeTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  if (diff < 86400_000 * 30) return `${Math.floor(diff / 86400_000)}天前`;
  return new Date(ts).toLocaleDateString();
}

function resolveWorkspaceName(w: MobileWorkspaceItem): string {
  if (w.workspacePurpose === "conversation") return "会话";
  if (w.name?.trim()) return w.name.trim();
  const parts = w.workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || w.workspacePath;
}

function getTimelineGroupKey(ts: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOf7Days = startOfToday - 6 * 86400000;

  if (ts >= startOfToday) return "今天";
  if (ts >= startOfYesterday) return "昨天";
  if (ts >= startOf7Days) return "最近 7 天";
  return "更早";
}

export function WebRemoteMobileHome({
  workspaces,
  tasks,
  activeWorkspacePath,
  activeTaskId,
  onSelectTask,
  onStartDraftInWorkspace,
  onEnterActiveChat,
  onRefresh,
  deviceName,
}: WebRemoteMobileHomeProps) {
  const [preferences, setPreferences] = useState<HomePreferences>(loadPreferences);
  const [showOrganizeMenu, setShowOrganizeMenu] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    if (activeWorkspacePath) {
      keys.add(activeWorkspacePath);
    } else if (workspaces[0]) {
      keys.add(workspaces[0].workspacePath);
    }
    return keys;
  });

  const [themeMode, setThemeMode] = useState<"system" | "dark" | "light">(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem("zcode-theme") as any) ?? "system";
  });

  const handleUpdatePreferences = (next: Partial<HomePreferences>) => {
    const updated = { ...preferences, ...next };
    setPreferences(updated);
    savePreferences(updated);
  };

  const toggleTheme = () => {
    const next = themeMode === "system" ? "dark" : themeMode === "dark" ? "light" : "system";
    setThemeMode(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("zcode-theme", next);
      if (next === "dark") {
        document.documentElement.classList.add("dark");
      } else if (next === "light") {
        document.documentElement.classList.remove("dark");
      } else {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.classList.toggle("dark", isDark);
      }
    }
  };

  // 排序与分组
  const sortedTasks = useMemo(() => {
    const list = [...tasks].filter((t) => !t.archived);
    return list.sort((a, b) => {
      const aTime = preferences.sortBy === "created" ? (a.createdAt ?? a.updatedAt) : a.updatedAt;
      const bTime = preferences.sortBy === "created" ? (b.createdAt ?? b.updatedAt) : b.updatedAt;
      return bTime - aTime;
    });
  }, [tasks, preferences.sortBy]);

  const pinnedTasks = useMemo(() => {
    return sortedTasks.filter((t) => t.pinned);
  }, [sortedTasks]);

  // 按工作区分组
  const groupedWorkspaces = useMemo(() => {
    return workspaces.map((w) => {
      const wsTasks = sortedTasks.filter((t) => {
        if (w.workspaceIdentity && t.workspaceIdentity) {
          return w.workspaceIdentity === t.workspaceIdentity;
        }
        return (
          t.workspacePath === w.workspacePath ||
          t.workspacePath.toLowerCase() === w.workspacePath.toLowerCase()
        );
      });

      return {
        ...w,
        name: resolveWorkspaceName(w),
        tasks: wsTasks,
      };
    });
  }, [workspaces, sortedTasks]);

  // 按时间线分组
  const timelineGroups = useMemo(() => {
    const map = new Map<string, MobileTaskItem[]>();
    for (const task of sortedTasks) {
      const time =
        preferences.sortBy === "created" ? (task.createdAt ?? task.updatedAt) : task.updatedAt;
      const key = getTimelineGroupKey(time);
      const arr = map.get(key) ?? [];
      arr.push(task);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [sortedTasks, preferences.sortBy]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const collapseAll = () => setExpandedKeys(new Set());
  const expandAll = () => setExpandedKeys(new Set(workspaces.map((w) => w.workspacePath)));

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null;
    return tasks.find((t) => t.taskId === activeTaskId) ?? null;
  }, [activeTaskId, tasks]);

  return (
    <section className="flex h-dvh min-h-0 w-full flex-col bg-background text-foreground antialiased selection:bg-primary/20">
      {/* 1. 顶部 Header：对齐官方样式 */}
      <header className="shrink-0 border-b border-border bg-header px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-ui-lg font-medium text-foreground">
                ZCode 远程控制
              </span>
              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-ui-xs font-medium text-emerald-600 dark:text-emerald-400">
                已连接
              </span>
            </div>
            <div className="mt-1 truncate text-ui-base text-foreground-subtle">
              已连接到当前桌面窗口{deviceName ? ` (${deviceName})` : ""}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground active:scale-95"
              onClick={toggleTheme}
              title="切换主题"
            >
              {themeMode === "dark" ? (
                <Moon className="size-4" />
              ) : themeMode === "light" ? (
                <Sun className="size-4" />
              ) : (
                <Laptop className="size-4" />
              )}
            </button>
            {onRefresh && (
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground active:scale-95"
                onClick={onRefresh}
                title="刷新"
              >
                <RefreshCw className="size-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. 当前会话悬浮横条（若存在活跃任务） */}
      {activeTask && onEnterActiveChat && (
        <div className="shrink-0 border-b border-primary/20 bg-primary/5 px-4 py-2.5">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={onEnterActiveChat}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-ui-xs font-medium text-foreground">
                  当前会话：{activeTask.title || "未命名会话"}
                </div>
                <div className="truncate text-[11px] text-foreground-subtle">点击进入会话视图</div>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-ui-xs font-medium text-primary">
              进入 <ChevronRight className="size-3.5" />
            </span>
          </button>
        </div>
      )}

      {/* 3. 滚动主体内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3.5">
        {/* 说明卡片 */}
        <div className="rounded-lg border border-card-border bg-card p-3 text-ui-base/relaxed text-foreground-subtle">
          本次连接可以查看当前设备上已打开的项目、任务和会话；二维码失效后需要回到桌面端重新连接。
        </div>

        {/* 标题栏与操作控制（收起全部、整理菜单） */}
        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-ui-base font-medium text-foreground">当前设备上的工作区和任务</h1>
            <p className="mt-1 text-ui-base text-foreground-subtle">
              {workspaces.length} 个工作区 · {tasks.length} 个任务
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {preferences.organizeBy === "workspace" && (
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground-subtle hover:bg-surface-hover active:scale-95"
                onClick={expandedKeys.size === 0 ? expandAll : collapseAll}
                title={expandedKeys.size === 0 ? "展开全部工作区" : "收起全部工作区"}
              >
                <Layers className="size-3.5" />
              </button>
            )}

            {/* 整理任务下拉菜单 */}
            <div className="relative">
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground-subtle hover:bg-surface-hover active:scale-95"
                onClick={() => setShowOrganizeMenu((v) => !v)}
                title="整理任务"
              >
                <SlidersHorizontal className="size-3.5" />
              </button>

              {showOrganizeMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowOrganizeMenu(false)} />
                  <div className="absolute right-0 top-9 z-50 w-52 rounded-xl border border-border bg-card p-2 shadow-xl">
                    <div className="px-2 py-1 text-[11px] font-medium text-foreground-subtlest">
                      查看方式
                    </div>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-sm ${
                        preferences.organizeBy === "workspace"
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground hover:bg-surface-hover"
                      }`}
                      onClick={() => {
                        handleUpdatePreferences({ organizeBy: "workspace" });
                        setShowOrganizeMenu(false);
                      }}
                    >
                      <Folder className="size-4" />
                      <span>按工作区</span>
                    </button>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-sm ${
                        preferences.organizeBy === "timeline"
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground hover:bg-surface-hover"
                      }`}
                      onClick={() => {
                        handleUpdatePreferences({ organizeBy: "timeline" });
                        setShowOrganizeMenu(false);
                      }}
                    >
                      <Clock className="size-4" />
                      <span>按时间线</span>
                    </button>

                    <div className="my-1.5 border-t border-border/60" />

                    <div className="px-2 py-1 text-[11px] font-medium text-foreground-subtlest">
                      排序方式
                    </div>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-sm ${
                        preferences.sortBy === "updated"
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground hover:bg-surface-hover"
                      }`}
                      onClick={() => {
                        handleUpdatePreferences({ sortBy: "updated" });
                        setShowOrganizeMenu(false);
                      }}
                    >
                      <Calendar className="size-4" />
                      <span>更新时间</span>
                    </button>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-sm ${
                        preferences.sortBy === "created"
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground hover:bg-surface-hover"
                      }`}
                      onClick={() => {
                        handleUpdatePreferences({ sortBy: "created" });
                        setShowOrganizeMenu(false);
                      }}
                    >
                      <Clock className="size-4" />
                      <span>创建时间</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 置顶任务分区 */}
        {pinnedTasks.length > 0 && (
          <section className="mt-3">
            <h2 className="flex items-center gap-1.5 px-1 py-1 text-ui-xs font-medium text-foreground-subtle">
              <Pin className="size-3 text-primary" />
              <span>置顶任务</span>
            </h2>
            <ul className="space-y-1.5 mt-1">
              {pinnedTasks.map((task) => {
                const ws = workspaces.find((w) => w.workspacePath === task.workspacePath) ?? {
                  workspacePath: task.workspacePath,
                  workspaceIdentity: task.workspaceIdentity,
                };
                const isRunning =
                  task.displayStatus === "running" ||
                  task.status === "running" ||
                  task.hasBackgroundWork;
                const isCompleted =
                  task.displayStatus === "completed" || task.status === "completed";

                return (
                  <li key={task.taskId}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-left transition-colors hover:bg-surface-hover active:scale-[0.99]"
                      onClick={() => onSelectTask(ws, task.taskId)}
                    >
                      <span className="relative flex size-4 shrink-0 items-center justify-center text-foreground-subtle">
                        {isRunning ? (
                          <Loader2 className="size-4 animate-spin text-primary" />
                        ) : (
                          <MessageSquare className="size-4 text-primary" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui-sm font-medium text-foreground">
                          {task.title || "未命名任务"}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-ui-xs text-foreground-subtle">
                          <span className="truncate">{resolveWorkspaceName(ws)}</span>
                          <span className="shrink-0">·</span>
                          <span className="truncate">{formatRelativeTime(task.updatedAt)}</span>
                        </span>
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-ui-xs leading-none ${
                          isRunning
                            ? "border-primary/40 bg-accent text-primary"
                            : isCompleted
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-border bg-surface text-foreground-subtle"
                        }`}
                      >
                        {isRunning ? "运行中" : isCompleted ? "已完成" : "空闲"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* 4. 工作区卡片视图 */}
        {preferences.organizeBy === "workspace" && (
          <ul className="mt-3 space-y-2 pb-6">
            {groupedWorkspaces.map((ws) => {
              const isExpanded = expandedKeys.has(ws.workspacePath);
              const isCurrentActive =
                activeWorkspacePath &&
                (ws.workspacePath === activeWorkspacePath ||
                  ws.workspacePath.toLowerCase() === activeWorkspacePath.toLowerCase());

              return (
                <li
                  key={ws.workspacePath}
                  className="rounded-lg border border-card-border bg-card overflow-hidden"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2 p-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      onClick={() => toggleExpand(ws.workspacePath)}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-foreground-subtle">
                        {ws.workspacePurpose === "conversation" ? (
                          <MessageSquare className="size-4" />
                        ) : (
                          <Folder className="size-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-ui-base font-medium text-foreground">
                            {ws.name}
                          </span>
                          <span className="shrink-0 rounded-full border border-border bg-surface px-1.5 py-0.5 text-ui-xs leading-none text-foreground-subtle">
                            {ws.workspacePurpose === "conversation"
                              ? "对话"
                              : ws.kind === "remote"
                                ? "远程"
                                : "本地"}
                          </span>
                          {isCurrentActive && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-ui-xs leading-none text-primary font-medium">
                              当前
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block truncate font-mono text-ui-xs text-foreground-subtlest">
                          {ws.workspacePath}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-ui-xs text-foreground-subtle">
                        <span>{ws.tasks.length} 个任务</span>
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </span>
                    </button>

                    {/* 新建任务小按钮 */}
                    {onStartDraftInWorkspace && (
                      <button
                        type="button"
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground-subtle hover:text-foreground hover:bg-surface-hover active:scale-95"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartDraftInWorkspace(ws);
                        }}
                        title="在此工作区新建任务"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>

                  {/* 展开任务列表 */}
                  {isExpanded && (
                    <ul className="border-t border-card-border px-2 py-2 space-y-1 bg-surface/20">
                      {ws.tasks.length === 0 ? (
                        <li className="px-3 py-2 text-ui-xs text-foreground-subtlest">
                          该工作区暂无任务
                        </li>
                      ) : (
                        ws.tasks.map((task) => {
                          const isTaskActive = activeTaskId === task.taskId;
                          const isRunning =
                            task.displayStatus === "running" ||
                            task.status === "running" ||
                            task.hasBackgroundWork;
                          const isCompleted =
                            task.displayStatus === "completed" || task.status === "completed";

                          return (
                            <li key={task.taskId}>
                              <button
                                type="button"
                                className={`flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors active:scale-[0.99] ${
                                  isTaskActive
                                    ? "bg-selected text-foreground ring-1 ring-primary/30"
                                    : "hover:bg-surface-hover text-foreground/90"
                                }`}
                                onClick={() => onSelectTask(ws, task.taskId)}
                              >
                                <span className="relative flex size-4 shrink-0 items-center justify-center">
                                  {isRunning ? (
                                    <Loader2 className="size-4 animate-spin text-primary" />
                                  ) : isCompleted ? (
                                    <CheckCircle2 className="size-4 text-emerald-500" />
                                  ) : (
                                    <MessageSquare className="size-4 text-foreground-subtle" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-ui-sm font-medium">
                                    {task.title || "未命名任务"}
                                  </span>
                                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-subtle">
                                    <span className="truncate">
                                      {formatRelativeTime(task.updatedAt)}
                                    </span>
                                  </span>
                                </span>
                                <span
                                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-ui-xs leading-none ${
                                    isRunning
                                      ? "border-primary/40 bg-accent text-primary"
                                      : isCompleted
                                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                        : "border-border bg-surface text-foreground-subtle"
                                  }`}
                                >
                                  {isRunning ? "运行中" : isCompleted ? "已完成" : "空闲"}
                                </span>
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* 5. 时间线视图 */}
        {preferences.organizeBy === "timeline" && (
          <ul className="mt-3 space-y-3 pb-6">
            {timelineGroups.map((group) => (
              <li key={group.label} className="space-y-1.5">
                <div className="px-1 py-1 text-ui-xs font-semibold text-foreground-subtle">
                  {group.label}
                </div>
                <ul className="space-y-1.5">
                  {group.items.map((task) => {
                    const ws = workspaces.find((w) => w.workspacePath === task.workspacePath) ?? {
                      workspacePath: task.workspacePath,
                      workspaceIdentity: task.workspaceIdentity,
                    };
                    const isRunning =
                      task.displayStatus === "running" ||
                      task.status === "running" ||
                      task.hasBackgroundWork;
                    const isCompleted =
                      task.displayStatus === "completed" || task.status === "completed";

                    return (
                      <li key={task.taskId}>
                        <button
                          type="button"
                          className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-left transition-colors hover:bg-surface-hover active:scale-[0.99]"
                          onClick={() => onSelectTask(ws, task.taskId)}
                        >
                          <span className="relative flex size-4 shrink-0 items-center justify-center text-foreground-subtle">
                            {isRunning ? (
                              <Loader2 className="size-4 animate-spin text-primary" />
                            ) : (
                              <MessageSquare className="size-4" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-ui-sm font-medium text-foreground">
                              {task.title || "未命名任务"}
                            </span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-ui-xs text-foreground-subtle">
                              <span className="truncate">{resolveWorkspaceName(ws)}</span>
                              <span className="shrink-0">·</span>
                              <span className="truncate">{formatRelativeTime(task.updatedAt)}</span>
                            </span>
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-ui-xs leading-none ${
                              isRunning
                                ? "border-primary/40 bg-accent text-primary"
                                : isCompleted
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "border-border bg-surface text-foreground-subtle"
                            }`}
                          >
                            {isRunning ? "运行中" : isCompleted ? "已完成" : "空闲"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
