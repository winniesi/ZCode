import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { decodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";

export function shouldShowManageModelsAction(onManageModels?: () => void): boolean {
  return typeof onManageModels === "function";
}

function resolveModelValueDisplayLabel(value: string): string {
  const customSelection = decodeCustomModelValue(value);
  if (customSelection?.modelName?.trim()) {
    return customSelection.modelName.trim();
  }

  const normalizedValue = value.trim();
  const separatorIndex = normalizedValue.indexOf("/");
  if (separatorIndex > 0 && separatorIndex < normalizedValue.length - 1) {
    const modelName = normalizedValue.slice(separatorIndex + 1).trim();
    if (modelName) return modelName;
  }
  return normalizedValue;
}

export function resolveModelSelectTriggerDisplay(
  normalizedValue: string,
  modelGroups: readonly ModelSelectGroup[],
  options?: {
    allowUnavailableCustomModelPlaceholder?: boolean;
    allowUnavailableModelPlaceholder?: boolean;
  },
): { value: string | undefined; placeholder: string | undefined } {
  if (normalizedValue.trim().toLocaleLowerCase() === "<synthetic>") {
    return { value: undefined, placeholder: undefined };
  }
  if (modelGroups.some((group) => group.items.some((item) => item.value === normalizedValue))) {
    return { value: normalizedValue, placeholder: undefined };
  }

  const customSelection = decodeCustomModelValue(normalizedValue);
  if (options?.allowUnavailableCustomModelPlaceholder && customSelection?.modelName?.trim()) {
    return { value: undefined, placeholder: customSelection.modelName.trim() };
  }
  if (options?.allowUnavailableModelPlaceholder && normalizedValue.trim()) {
    return {
      value: undefined,
      placeholder: resolveModelValueDisplayLabel(normalizedValue),
    };
  }
  // 修复：候选列表为空时触发器曾显示「管理模型」。动作文案被当成状态标签后，
  // 无凭据部署（如官方 Web）的用户会把待选择状态误读成管理动作，也无法与
  // 「已选模型失效」区分。「管理模型」只保留为菜单项（见 docs/ui/composer-model-selection.md），
  // 触发器统一回落到调用方的默认「选择模型」文案。
  return { value: undefined, placeholder: undefined };
}
