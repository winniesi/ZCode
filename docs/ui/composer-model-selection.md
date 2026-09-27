# Composer 模型选择器显示规则

模型候选的唯一数据源是当前连接 Host 的 `IModelSelectionService.getView()`
（provider registry：账号凭据 + 个人 provider 配置 + 内置模板）。UI 不维护第二份模型
状态；「候选列表为空」是当前 Host 没有可用模型的事实，不是渲染层缺陷。桌面、Web、
手机/浏览器远控三条链路的 composer 共用本规则，UI 不做平台分支；模型数据差异只来自
各连接 Host 的 registry（桌面本机凭据 / server 数据根）。

## 触发器显示优先级

1. 当前选择命中候选列表 → 显示 provider/model（结构化前缀由
   `resolveV4ModelTriggerDisplay` 产出，密度由 composer 容器断点决定）。
2. 选择值为 `<synthetic>`（Claude SDK 恢复合成模型）→ 显示默认「选择模型」，
   不直显协议内部占位符。
3. 选择值不在候选列表（失效/下线/退登）→ 按 options 显示不可用占位
   （自定义模型名 / 原始值展示标签）。
4. 候选列表为空 → 显示默认「选择模型」。

## 空态与「管理模型」入口

- 历史行为：候选列表为空且存在管理入口时，触发器文案直接显示「管理模型」。
  问题：动作文案被当成状态标签，无凭据部署（如官方 Web）的用户会把「选择模型」
  误读成「管理模型」动作，也无法区分「Host 没有可用模型」和「待选择」。
  现行为：「管理模型」只作为菜单项存在，不再充当触发器文案。
- 菜单可见性保持 `modelGroups.length > 0 || showManageModelsAction`：
  零候选但存在管理入口时仍渲染菜单，保证无模型用户有明确去处。

## 相关代码

- `packages/ui/src/chat-input-toolbar/modelSelection.ts`：触发器显示解析。
- `packages/ui/src/v4/composer/V4ComposerToolbar.tsx`：菜单可见性与「管理模型」入口。
- `packages/ui/src/v4/composer/modelTriggerDisplay.ts`：触发器结构化文案。
