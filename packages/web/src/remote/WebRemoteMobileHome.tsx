import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  Check,
  Loader2,
  RefreshCw,
  Sun,
  Moon,
  Laptop,
} from "lucide-react";

export interface MobileWorkspaceItem {
  workspacePath: string;
  workspaceIdentity?: string;
  kind?: "local" | "remote";
  name?: string;
}

export interface MobileTaskItem {
  taskId: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
  updatedAt: number;
  displayStatus?: string;
  status?: string;
  hasBackgroundWork?: boolean;
}

interface WebRemoteMobileHomeProps {
  workspaces: MobileWorkspaceItem[];
  tasks: MobileTaskItem[];
  activeWorkspacePath?: string;
  activeTaskId?: string;
  onSelectTask: (workspace: MobileWorkspaceItem, taskId: string) => void;
  onEnterActiveChat?: () => void;
  onRefresh?: () => void;
  deviceName?: string;
}

function formatRelativeTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时`;
  return `${Math.floor(diff / 86400_000)}天`;
}

function resolveWorkspaceName(w: MobileWorkspaceItem): string {
  if (w.name?.trim()) return w.name.trim();
  const parts = w.workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || w.workspacePath;
}

export function WebRemoteMobileHome({
  workspaces,
  tasks,
  activeWorkspacePath,
  activeTaskId,
  onSelectTask,
  onEnterActiveChat,
  onRefresh,
  deviceName,
}: WebRemoteMobileHomeProps) {
  // 默认展开第一个或包含任务的工作区
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
    return (localStorage.getItem("zcode-theme") as any) ?? "system";
  });

  const toggleTheme = () => {
    const next = themeMode === "system" ? "dark" : themeMode === "dark" ? "light" : "system";
    setThemeMode(next);
    localStorage.setItem("zcode-theme", next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else if (next === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", isDark);
    }
  };

  // 按 workspace 分组任务
  const groupedWorkspaces = useMemo(() => {
    return workspaces.map((w) => {
      const wsTasks = tasks
        .filter((t) => {
          if (w.workspaceIdentity && t.workspaceIdentity) {
            return w.workspaceIdentity === t.workspaceIdentity;
          }
          return (
            t.workspacePath === w.workspacePath ||
            t.workspacePath.toLowerCase() === w.workspacePath.toLowerCase()
          );
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);

      return {
        ...w,
        name: resolveWorkspaceName(w),
        tasks: wsTasks,
      };
    });
  }, [workspaces, tasks]);

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

  const expandAll = () => {
    setExpandedKeys(new Set(workspaces.map((w) => w.workspacePath)));
  };

  const collapseAll = () => {
    setExpandedKeys(new Set());
  };

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null;
    return tasks.find((t) => t.taskId === activeTaskId) ?? null;
  }, [activeTaskId, tasks]);

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-background text-foreground antialiased selection:bg-primary/20">
      {/* 顶部标题栏 */}
      <header className="shrink-0 border-b border-border bg-header px-4 py-3 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-ui-base font-semibold text-foreground">
                ZCode 远程控制
              </span>
              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-ui-xs font-medium text-emerald-600 dark:text-emerald-400">
                已连接
              </span>
            </div>
            <div className="mt-0.5 truncate text-ui-xs text-foreground-subtle">
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

      {/* 快速回到当前会话悬浮横条 */}
      {activeTask && onEnterActiveChat && (
        <div className="shrink-0 border-b border-primary/20 bg-primary/5 px-4 py-2.5">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={onEnterActiveChat}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-ui-xs font-medium text-foreground">
                  当前会话：{activeTask.title || "未命名会话"}
                </div>
                <div className="truncate text-[11px] text-foreground-subtle">
                  点击直接进入聊天界面
                </div>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-ui-xs font-medium text-primary">
              进入 <ChevronRight className="size-3.5" />
            </span>
          </button>
        </div>
      )}

      {/* 主体卡片列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5 space-y-4">
        {/* 提示卡片 */}
        <div className="rounded-xl border border-border/60 bg-card/60 p-3 text-ui-xs/relaxed text-foreground-subtle backdrop-blur-xs">
          本次连接可以查看当前设备上已打开的项目、任务和会话；可在任意任务间随时切换。
        </div>

        {/* 汇总与操作 */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            <h1 className="text-ui-sm font-semibold text-foreground">当前设备上的工作区和任务</h1>
            <p className="mt-0.5 text-ui-xs text-foreground-subtle">
              {groupedWorkspaces.length} 个工作区 · {tasks.length} 个任务
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-ui-xs text-primary hover:underline"
              onClick={expandedKeys.size === groupedWorkspaces.length ? collapseAll : expandAll}
            >
              {expandedKeys.size === groupedWorkspaces.length ? "收起全部" : "展开全部"}
            </button>
          </div>
        </div>

        {/* 手风琴列表 */}
        <ul className="space-y-2.5 pb-8">
          {groupedWorkspaces.map((ws) => {
            const isExpanded = expandedKeys.has(ws.workspacePath);
            const isCurrentActive =
              activeWorkspacePath &&
              (ws.workspacePath === activeWorkspacePath ||
                ws.workspacePath.toLowerCase() === activeWorkspacePath.toLowerCase());

            return (
              <li
                key={ws.workspacePath}
                className="overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-shadow"
              >
                {/* 工作区卡片头部 */}
                <div
                  className="flex cursor-pointer items-center justify-between gap-2 p-3 transition-colors hover:bg-surface-hover/60"
                  onClick={() => toggleExpand(ws.workspacePath)}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                        isCurrentActive
                          ? "bg-primary/10 text-primary"
                          : "bg-surface text-foreground-subtle"
                      }`}
                    >
                      <Folder className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-ui-sm font-medium text-foreground">
                          {ws.name}
                        </span>
                        <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] text-foreground-subtle">
                          {ws.kind === "remote" ? "远程" : "本地"}
                        </span>
                        {isCurrentActive && (
                          <span className="inline-flex shrink-0 items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            当前工作区
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-foreground-subtlest">
                        {ws.workspacePath}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 text-foreground-subtle">
                    <span className="text-ui-xs">{ws.tasks.length} 个任务</span>
                    {isExpanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </div>
                </div>

                {/* 展开的任务列表 */}
                {isExpanded && (
                  <div className="border-t border-border/60 bg-surface/30 px-2 py-2">
                    {ws.tasks.length === 0 ? (
                      <div className="py-4 text-center text-ui-xs text-foreground-subtlest">
                        暂无历史任务
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {ws.tasks.map((task) => {
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
                                className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors active:scale-[0.99] ${
                                  isTaskActive
                                    ? "bg-selected text-foreground ring-1 ring-primary/30"
                                    : "hover:bg-surface-hover text-foreground/90"
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectTask(ws, task.taskId);
                                }}
                              >
                                <div className="flex min-w-0 flex-1 items-start gap-2">
                                  <MessageSquare
                                    className={`mt-0.5 size-3.5 shrink-0 ${
                                      isTaskActive ? "text-primary" : "text-foreground-subtle"
                                    }`}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-ui-sm font-medium">
                                      {task.title || "未命名任务"}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-foreground-subtle">
                                      {formatRelativeTime(task.updatedAt)}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex shrink-0 items-center gap-1.5">
                                  {isRunning ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                      <Loader2 className="size-3 animate-spin" />
                                      运行中
                                    </span>
                                  ) : isCompleted ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                                      <Check className="size-3" />
                                      已完成
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-foreground-subtle">
                                      空闲
                                    </span>
                                  )}
                                  <ChevronRight className="size-3.5 text-foreground-subtlest" />
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
