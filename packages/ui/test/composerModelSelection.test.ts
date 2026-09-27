import assert from "node:assert/strict";
import test from "node:test";
import { resolveModelSelectTriggerDisplay } from "../src/chat-input-toolbar/modelSelection.js";
import type { ModelSelectGroup } from "../src/ModelConfigSelect.js";

const groups: ModelSelectGroup[] = [
  {
    key: "bigmodel",
    label: "BigModel",
    items: [{ key: "m1", value: "custom:provider-a:GLM-5.3", name: "GLM-5.3" }],
  },
];

test("命中候选列表时返回当前选择值", () => {
  const result = resolveModelSelectTriggerDisplay("custom:provider-a:GLM-5.3", groups);
  assert.equal(result.value, "custom:provider-a:GLM-5.3");
  assert.equal(result.placeholder, undefined);
});

test("候选列表为空时触发器回落默认「选择模型」，不再显示「管理模型」", () => {
  // 回归：空列表曾把「管理模型」动作文案当触发器标签，无凭据部署（官方 Web）下
  // 用户无法区分待选择状态与管理入口。
  const result = resolveModelSelectTriggerDisplay("", []);
  assert.equal(result.value, undefined);
  assert.equal(result.placeholder, undefined);
});

test("候选列表为空且当前值未命中时同样回落默认文案", () => {
  const result = resolveModelSelectTriggerDisplay("enc/provider/gone", []);
  assert.equal(result.value, undefined);
  assert.equal(result.placeholder, undefined);
});

test("<synthetic> 恢复合成模型不直显协议占位符", () => {
  const result = resolveModelSelectTriggerDisplay("<synthetic>", groups);
  assert.equal(result.value, undefined);
  assert.equal(result.placeholder, undefined);
});

test("不可用自定义模型按 options 显示模型名占位", () => {
  const result = resolveModelSelectTriggerDisplay("custom:provider-a:m1", [], {
    allowUnavailableCustomModelPlaceholder: true,
  });
  assert.equal(result.value, undefined);
  assert.equal(result.placeholder, "m1");
});

test("不可用裸模型 id 按 options 显示展示标签占位", () => {
  const result = resolveModelSelectTriggerDisplay("some-provider/m2", [], {
    allowUnavailableModelPlaceholder: true,
  });
  assert.equal(result.value, undefined);
  assert.equal(result.placeholder, "m2");
});
