import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { AppErrorBoundary, Root, ZCodeIntlProvider, useZCodeSessionStore } from "@zcode/ui";
import "@zcode/ui/styles.css";
import type { IPlatformService } from "@zcode/shared";
import { ChevronLeft } from "lucide-react";
import {
  WebRemoteRelayClient,
  type WebRemoteRelayState,
  type WorkspaceBridgeInfo,
} from "./webRemoteRelay.js";
import type { WebRemoteControlParams } from "./remoteParams.js";
import type { IServiceAccessor } from "@zcode/services";
import {
  WebRemoteMobileHome,
  type MobileWorkspaceItem,
  type MobileTaskItem,
} from "./WebRemoteMobileHome.js";

interface WebRemoteLandingProps {
  params: WebRemoteControlParams;
  platform: IPlatformService;
}

function checkIsMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(max-width: 768px)").matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );
}

export function WebRemoteLanding({ params, platform }: WebRemoteLandingProps) {
  const [relayState, setRelayState] = useState<WebRemoteRelayState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(checkIsMobileViewport);
  const [mobilePage, setMobilePage] = useState<"home" | "chat">(() => {
    return checkIsMobileViewport() ? "home" : "chat";
  });

  const [bridgeResult, setBridgeResult] = useState<{
    services: IServiceAccessor;
    bridge: WorkspaceBridgeInfo;
    initialTaskId?: string;
  } | null>(null);

  const [workspaces, setWorkspaces] = useState<MobileWorkspaceItem[]>([]);
  const [tasks, setTasks] = useState<MobileTaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [selectedWorkspace, setSelectedWorkspace] = useState<MobileWorkspaceItem | null>(null);

  const clientRef = useRef<WebRemoteRelayClient | null>(null);

  // 监听视口变化自适应移动端与桌面端
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 768px)");
    const handler = () => {
      setIsMobile(checkIsMobileViewport());
    };
    mql.addEventListener("change", handler);
    window.addEventListener("resize", handler);
    return () => {
      mql.removeEventListener("change", handler);
      window.removeEventListener("resize", handler);
    };
  }, []);

  // 监听 popstate 处理手机端系统返回键
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = (e: PopStateEvent) => {
      if (!e.state || e.state.zcodeMobilePage !== "chat") {
        setMobilePage("home");
      } else {
        setMobilePage("chat");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.title = `ZCode - Remote: ${params.deviceName ?? "Desktop"}`;
    const client = new WebRemoteRelayClient(params);
    clientRef.current = client;

    const sub = client.onStateChange((next: WebRemoteRelayState) => {
      setRelayState(next);
      if (next === "paired") {
        void initializeWorkspaceBridge(client);
      }
    });

    const appSub = client.onAppPayload((payload: any) => {
      if (payload?.zcode_type === "workspace-list-updated" && payload.result) {
        if (Array.isArray(payload.result.workspaces)) {
          setWorkspaces(payload.result.workspaces);
        }
        if (Array.isArray(payload.result.tasks)) {
          setTasks(payload.result.tasks);
        }
      }
    });

    client.connect().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    });

    return () => {
      sub.dispose();
      appSub.dispose();
      client.dispose();
    };
  }, [params]);

  async function initializeWorkspaceBridge(client: WebRemoteRelayClient) {
    try {
      // 1. 发起 bootstrap 请求获取当前打开的工作区与任务状态
      const bootstrapResp = await client.requestAppPayload(
        { zcode_type: "bootstrap-request" },
        (p) => Boolean(p.result?.workspaces || p.zcode_type === "bootstrap-response"),
        15000,
      );

      const rawWorkspaces: MobileWorkspaceItem[] = bootstrapResp.result?.workspaces ?? [];
      const rawTasks: MobileTaskItem[] = bootstrapResp.result?.tasks ?? [];
      setWorkspaces(rawWorkspaces);
      setTasks(rawTasks);

      const activeWorkspaceKey =
        bootstrapResp.result?.mobileViewState?.activeWorkspaceKey ??
        bootstrapResp.result?.initialViewState?.activeWorkspaceKey;

      const activeTaskId =
        bootstrapResp.result?.mobileViewState?.activeTaskId ??
        bootstrapResp.result?.initialViewState?.activeTaskId ??
        bootstrapResp.result?.tasks?.[0]?.taskId;

      const primaryWorkspace =
        (activeWorkspaceKey
          ? rawWorkspaces.find(
              (w) => (w.workspaceIdentity?.trim() || w.workspacePath) === activeWorkspaceKey,
            )
          : null) ??
        rawWorkspaces.find(
          (w) => w.kind !== "remote" || (w.workspaceIdentity && (w as any).remoteSessionId),
        ) ??
        rawWorkspaces[0];

      if (!primaryWorkspace) {
        throw new Error("桌面端当前没有可供远控打开的工作区。");
      }

      setSelectedWorkspace(primaryWorkspace);
      setSelectedTaskId(activeTaskId);

      const workspaceKey =
        primaryWorkspace.workspaceIdentity?.trim() || primaryWorkspace.workspacePath;

      // 2. 发起 workspace bridge open，透传当前活跃任务 ID
      const bridgeConn = await client.openWorkspaceBridge(workspaceKey, activeTaskId);

      setBridgeResult({
        ...bridgeConn,
        initialTaskId: activeTaskId ?? bridgeConn.bridge.initialTaskId,
      });

      if (activeTaskId) {
        useZCodeSessionStore
          .getState()
          .setActiveTaskId(
            bridgeConn.bridge.workspacePath,
            activeTaskId,
            bridgeConn.bridge.workspaceIdentity,
          );
      }
    } catch (err) {
      console.error("[web-remote] bridge setup failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "连接桌面工作区失败，请确保桌面端保持运行。",
      );
    }
  }

  // 手机端在首页选择任务后进入聊天页面
  const handleSelectTaskOnMobile = useCallback((ws: MobileWorkspaceItem, taskId: string) => {
    setSelectedWorkspace(ws);
    setSelectedTaskId(taskId);
    useZCodeSessionStore.getState().setActiveTaskId(ws.workspacePath, taskId, ws.workspaceIdentity);
    setMobilePage("chat");
    if (typeof window !== "undefined") {
      window.history.pushState({ zcodeMobilePage: "chat" }, "");
    }
  }, []);

  const handleBackHome = useCallback(() => {
    setMobilePage("home");
    if (typeof window !== "undefined" && window.history.state?.zcodeMobilePage === "chat") {
      window.history.back();
    }
  }, []);

  const handleEnterActiveChat = useCallback(() => {
    setMobilePage("chat");
    if (typeof window !== "undefined") {
      window.history.pushState({ zcodeMobilePage: "chat" }, "");
    }
  }, []);

  const currentTaskTitle = useMemo(() => {
    if (!selectedTaskId) return null;
    const found = tasks.find((t) => t.taskId === selectedTaskId);
    return found?.title || selectedTaskId;
  }, [selectedTaskId, tasks]);

  if (errorMessage) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="w-full max-w-md rounded-xl border border-destructive/20 bg-card p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-destructive" />
            <h1 className="text-ui-base font-semibold">远程连接失败</h1>
          </div>
          <p className="mt-3 text-ui-sm/relaxed text-foreground-subtle">{errorMessage}</p>
          <button
            type="button"
            className="mt-5 w-full rounded-lg bg-primary py-2 text-ui-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            重新连接
          </button>
        </div>
      </div>
    );
  }

  if (!bridgeResult) {
    const statusText =
      relayState === "connecting"
        ? "正在连接远控中继服务器..."
        : relayState === "authenticating"
          ? "正在向桌面端发起安全认证..."
          : relayState === "waiting"
            ? "桌面端离线或等待桌面授权..."
            : relayState === "paired"
              ? "已与桌面配对，正在打开工作区..."
              : "准备连接...";

    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="size-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-ui-sm font-medium text-foreground-subtle">{statusText}</p>
          {params.deviceName && (
            <span className="text-ui-xs text-foreground-muted">目标设备: {params.deviceName}</span>
          )}
        </div>
      </div>
    );
  }

  const { services, bridge } = bridgeResult;

  return (
    <AppErrorBoundary>
      <ZCodeIntlProvider
        settingService={services.settingService}
        broadcastService={services.broadcastService}
      >
        {isMobile && mobilePage === "home" ? (
          <WebRemoteMobileHome
            workspaces={workspaces}
            tasks={tasks}
            activeWorkspacePath={selectedWorkspace?.workspacePath ?? bridge.workspacePath}
            activeTaskId={selectedTaskId ?? bridgeResult.initialTaskId}
            onSelectTask={handleSelectTaskOnMobile}
            onEnterActiveChat={handleEnterActiveChat}
            deviceName={params.deviceName}
          />
        ) : (
          <div
            className="relative flex h-dvh w-screen flex-col overflow-hidden bg-background text-foreground"
            data-mobile-remote-chat={isMobile ? "true" : undefined}
          >
            {/* 移动端沉浸式会话顶栏 */}
            {isMobile && (
              <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-header px-3 shadow-xs">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-lg py-1 px-1.5 text-ui-xs font-medium text-foreground hover:bg-surface-hover active:scale-95"
                  onClick={handleBackHome}
                >
                  <ChevronLeft className="size-4.5 text-primary" />
                  <span className="text-primary font-medium">任务首页</span>
                </button>
                <div className="min-w-0 max-w-[60%] truncate text-center text-ui-xs font-semibold text-foreground">
                  {currentTaskTitle || "任务会话"}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex size-2 rounded-full bg-emerald-500" title="已连接" />
                </div>
              </header>
            )}

            <div className="min-h-0 flex-1 overflow-hidden">
              <Root
                services={services}
                platform={platform}
                initialWorkspaceAbsPath={selectedWorkspace?.workspacePath ?? bridge.workspacePath}
                initialWorkspaceIdentity={
                  selectedWorkspace?.kind === "remote"
                    ? selectedWorkspace.workspaceIdentity
                    : bridge.kind === "remote"
                      ? bridge.workspaceIdentity
                      : undefined
                }
                initialTaskId={selectedTaskId ?? bridgeResult.initialTaskId ?? bridge.initialTaskId}
                initialWorkspaceLoadingFallback={
                  <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      <span className="text-ui-xs text-foreground-subtle">正在进入工作区...</span>
                    </div>
                  </div>
                }
                restoreSession={true}
                allowOpenWorkspace={false}
                preferDirectoryBrowser
                supportsEmbeddedBrowser={false}
                allowRemoteWorkspace={false}
              />
            </div>

            {/* 移动端专属样式覆盖：在手机端隐藏 PC 侧栏及把手，消除双 Header 重叠，让 Chat 全屏沉浸且底部吸底 */}
            {isMobile && (
              <style>{`
                [data-mobile-remote-chat="true"] [data-desktop-window-frame="true"] {
                  height: 100% !important;
                  max-height: 100% !important;
                  border: none !important;
                  border-radius: 0 !important;
                }
                [data-mobile-remote-chat="true"] [data-workspace-sidebar-panel="true"],
                [data-mobile-remote-chat="true"] [data-panel-resize-handle],
                [data-mobile-remote-chat="true"] [role="separator"],
                [data-mobile-remote-chat="true"] [data-workspace-shell="true"] > [data-panel=""]:first-child {
                  display: none !important;
                  width: 0 !important;
                  min-width: 0 !important;
                  max-width: 0 !important;
                  flex: 0 0 0px !important;
                }
                [data-mobile-remote-chat="true"] header[data-testid="workspace-header"],
                [data-mobile-remote-chat="true"] header[data-testid="app-header"],
                [data-mobile-remote-chat="true"] .\\@container\\/workspace-header,
                [data-mobile-remote-chat="true"] .\\@container\\/topoverlayer,
                [data-mobile-remote-chat="true"] [data-testid="desktop-top-nav-back"],
                [data-mobile-remote-chat="true"] sectionheader,
                [data-mobile-remote-chat="true"] [data-workspace-header="true"],
                [data-mobile-remote-chat="true"] [data-desktop-window-frame="true"] > header {
                  display: none !important;
                  height: 0 !important;
                  min-height: 0 !important;
                  max-height: 0 !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  border: none !important;
                  overflow: hidden !important;
                  pointer-events: none !important;
                }
                [data-mobile-remote-chat="true"] [data-workspace-body="true"],
                [data-mobile-remote-chat="true"] [data-workspace-shell="true"] > div:last-child {
                  width: 100% !important;
                  flex: 1 1 100% !important;
                  max-width: 100% !important;
                }
                [data-mobile-remote-chat="true"] form {
                  max-width: 100% !important;
                  margin-bottom: 0.5rem !important;
                }
              `}</style>
            )}
          </div>
        )}
      </ZCodeIntlProvider>
    </AppErrorBoundary>
  );
}
