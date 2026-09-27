import type {
  IModelSelectionService,
  ModelSelectionView,
  ModelSelectionViewInput,
} from "@zcode/services";
import { BUILTIN_MODEL_PROVIDER_IDS, type ModelSelection } from "@zcode/shared";

function createFallbackModelConfig(supportsImage = false) {
  return {
    enabled: true,
    properties: {
      requiresMfjsToolSchema: false,
      contextWindow: 128000,
      inputFormat: {
        supportsText: true,
        supportsImage,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
      supportsJsonSchemaOutput: true,
      supportsNativeWebSearch: true,
      supportsMidConversationSystem: true,
    },
    optionSpecs: {
      reasoningLevel: { values: ["high", "middle", "low"], map: "" },
      maxOutputTokens: { max: 128000, map: "" },
    },
  };
}

// 官方默认预置模型列表（当远端/Host 尚未就绪或返回空列表时兜底）
export const DEFAULT_BUILTIN_MODEL_SELECTION_VIEW: ModelSelectionView = Object.freeze({
  revision: 1,
  preferredSelection: {
    providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    modelId: "GLM-5.3",
  },
  providers: Object.freeze([
    {
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      providerName: "BigModel",
      templateId: "zai-api",
      config: {
        access: {
          type: "zhipu-account" as const,
          accountType: "bigmodel" as const,
          mode: "individual-coding-plan" as const,
        },
        api: {
          type: "anthropic-messages" as const,
          baseUrl: "https://api.z.ai/api/anthropic",
        },
        builtinModelIds: ["GLM-5.3", "GLM-5.3-Flash"],
      },
      models: [
        {
          modelId: "GLM-5.3",
          config: createFallbackModelConfig(false),
        },
        {
          modelId: "GLM-5.3-Flash",
          config: createFallbackModelConfig(true),
        },
      ],
    },
    {
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      providerName: "Start Plan",
      templateId: "zai-api",
      config: {
        access: {
          type: "zhipu-account" as const,
          accountType: "bigmodel" as const,
          mode: "start-plan" as const,
        },
        api: {
          type: "anthropic-messages" as const,
          baseUrl: "https://api.z.ai/api/anthropic",
        },
        builtinModelIds: ["GLM-5.3-Flash"],
      },
      models: [
        {
          modelId: "GLM-5.3-Flash",
          config: createFallbackModelConfig(true),
        },
      ],
    },
  ]),
});

/**
 * 包装目标 IModelSelectionService，保证即便宿主返回空列表或通信异常，
 * 网页端也能始终拥有可用的官方模型列表，避免触发器回落至「管理模型」。
 */
export function wrapModelSelectionServiceWithFallback(
  baseService?: IModelSelectionService | null,
): IModelSelectionService {
  let preferredUserSelection: ModelSelection | undefined = undefined;

  return {
    getView: async (input?: ModelSelectionViewInput) => {
      if (input?.selection) {
        preferredUserSelection = input.selection;
      }
      try {
        if (baseService) {
          const remoteView = await baseService.getView(input);
          if (Array.isArray(remoteView.providers) && remoteView.providers.length > 0) {
            return remoteView;
          }
        }
      } catch (err) {
        console.warn(
          "[web-remote] base modelSelectionService.getView() failed, using fallback:",
          err,
        );
      }

      return {
        ...DEFAULT_BUILTIN_MODEL_SELECTION_VIEW,
        preferredSelection:
          preferredUserSelection ?? DEFAULT_BUILTIN_MODEL_SELECTION_VIEW.preferredSelection,
        effectiveSelection:
          preferredUserSelection ?? DEFAULT_BUILTIN_MODEL_SELECTION_VIEW.preferredSelection,
      };
    },
    onDidChange: (listener: (view: ModelSelectionView) => void) => {
      if (baseService) {
        return baseService.onDidChange((view: ModelSelectionView) => {
          if (Array.isArray(view.providers) && view.providers.length > 0) {
            listener(view);
          } else {
            listener({
              ...DEFAULT_BUILTIN_MODEL_SELECTION_VIEW,
              preferredSelection:
                preferredUserSelection ?? DEFAULT_BUILTIN_MODEL_SELECTION_VIEW.preferredSelection,
            });
          }
        });
      }
      return { dispose: () => {} };
    },
  };
}
