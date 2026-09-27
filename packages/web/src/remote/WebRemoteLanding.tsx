import { useEffect, useState, useRef } from "react";
import { AppErrorBoundary, Root, ZCodeIntlProvider } from "@zcode/ui";
import "@zcode/ui/styles.css";
import type { IPlatformService } from "@zcode/shared";
import {
  WebRemoteRelayClient,
  type WebRemoteRelayState,
  type WorkspaceBridgeInfo,
} from "./webRemoteRelay.js";
import type { WebRemoteControlParams } from "./remoteParams.js";
import type { IServiceAccessor } from "@zcode/services";

interface WebRemoteLandingProps {
  params: WebRemoteControlParams;
  platform: IPlatformService;
}

export function WebRemoteLanding({ params, platform }: WebRemoteLandingProps) {
  const [relayState, setRelayState] = useState<WebRemoteRelayState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bridgeResult, setBridgeResult] = useState<{
    services: IServiceAccessor;
    bridge: WorkspaceBridgeInfo;
    initialTaskId?: string;
  } | null>(null);

  const clientRef = useRef<WebRemoteRelayClient | null>(null);

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

    client.connect().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    });

    return () => {
      sub.dispose();
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

      const workspaces = bootstrapResp.result?.workspaces ?? [];
      const activeWorkspaceKey =
        bootstrapResp.result?.mobileViewState?.activeWorkspaceKey ??
        bootstrapResp.result?.initialViewState?.activeWorkspaceKey;

      const activeTaskId =
        bootstrapResp.result?.mobileViewState?.activeTaskId ??
        bootstrapResp.result?.initialViewState?.activeTaskId ??
        bootstrapResp.result?.tasks?.[0]?.taskId;

      const primaryWorkspace =
        (activeWorkspaceKey
          ? workspaces.find(
              (w: any) => (w.workspaceIdentity?.trim() || w.workspacePath) === activeWorkspaceKey,
            )
          : null) ??
        workspaces.find(
          (w: any) => w.kind !== "remote" || (w.workspaceIdentity && w.remoteSessionId),
        ) ??
        workspaces[0];

      if (!primaryWorkspace) {
        throw new Error("桌面端当前没有可供远控打开的工作区。");
      }

      const workspaceKey =
        primaryWorkspace.workspaceIdentity?.trim() || primaryWorkspace.workspacePath;

      // 2. 发起 workspace bridge open，透传当前活跃任务 ID
      const bridgeConn = await client.openWorkspaceBridge(workspaceKey, activeTaskId);

      setBridgeResult({
        ...bridgeConn,
        initialTaskId: activeTaskId ?? bridgeConn.bridge.initialTaskId,
      });
    } catch (err) {
      console.error("[web-remote] bridge setup failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "连接桌面工作区失败，请确保桌面端保持运行。",
      );
    }
  }

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
        <Root
          services={services}
          platform={platform}
          initialWorkspaceAbsPath={bridge.workspacePath}
          initialWorkspaceIdentity={bridge.kind === "remote" ? bridge.workspaceIdentity : undefined}
          initialTaskId={bridgeResult.initialTaskId ?? bridge.initialTaskId}
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
      </ZCodeIntlProvider>
    </AppErrorBoundary>
  );
}
