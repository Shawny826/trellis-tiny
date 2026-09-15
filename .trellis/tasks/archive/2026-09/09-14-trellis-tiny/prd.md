# 构建 trellis-tiny 简化版：精简平台适配、零任务直通、移除 Channel

## Goal

基于上游 Trellis 源码（`./Trellis`，v0.6.17）构建一个可日常使用的简化发行版 **trellis-tiny**：只支持用户实际使用的平台（codex / zcode / dsh，预留 claude-code 扩展位），消除 skill 物理重复分发，为简单任务提供"零任务直通"工作流档位，并整体移除 Channel 多 Agent 协作系统。目标是把维护面和每次会话的上下文开销降到显著低于上游的水平。

## Confirmed Facts（调研已确认）

- **skill 源头单一**：上游所有 skill 模板只有一份（`packages/cli/src/templates/common/skills/` + `common/bundled-skills/`），平台差异靠占位符渲染。所谓"重复"是安装产物层：`.agents/skills/` 与 `.zcode/skills/` 两份字节级相同的拷贝（当前项目 md5 实测）。
- **ZCode 双根扫描已实证**：当前 ZCode 会话同时发现 `.zcode/skills/` 和 `.agents/skills/` 两个根的 skill（每个 skill 在列表中出现两次）。因此 `.zcode/skills/` 拷贝可整体取消，只写 `.agents/skills/` 单一根。
- **dsh 原生支持共享根**：DeepSeek Harness 按 rank 100（`.dsh/skills`）/ rank 200（`.agents/skills`）两级发现 skill，共享根是其设计内路径。
- **Codex 原生读 `.agents/skills/`**：上游 codex configurator 本来就把 skill 写到共享根（neutral 渲染）。
- **Channel 系统足迹**：`packages/core/src/channel/` 4,544 行 + `packages/cli/src/commands/channel/` 8,383 行 ≈ 13,000 行 TS；`.trellis/scripts/` Python 层对 channel 零依赖，移除不影响工作流脚本。
- **平台差异面很小**：三个目标平台中，codex/zcode 有 hooks + 子代理定义；dsh 无 hooks、无子代理面（实现最薄，~110 行 configurator）。
- **workflow.md 是运行时契约**：`[workflow-state:*]` 标签块由 hook 每轮解析注入，改档位 = 改标签块文本，无需改解析器。

## Requirements

### R1 平台收敛：仅保留 codex / zcode / dsh（+claude-code 扩展位）

- 移除其余 19 个平台的 configurator、模板目录、AI_TOOLS 注册项、init/update 分支。
- 保留 claude-code 的注册数据与模板结构作为可选扩展位（默认不启用、不安装），后续可低成本恢复。
- init/update/uninstall 逻辑只针对 3 平台矩阵维护。

### R2 skill 单一根分发

- 所有 trellis-* skill 只写入 `.agents/skills/`，三个平台共用。
- 取消 `.zcode/skills/` 写入；`.zcode/` 仅保留 hooks、config.json、agents、commands/trellis。
- `.dsh/skills/` 仅保留 dsh 私有的 3 个命令入口 skill（start/continue/finish-work）；`.codex/skills/` 保持空目录约定。
- 升级/重装后不残留旧的 `.zcode/skills/` 目录（uninstall/init 收敛时清理）。

### R3 零任务直通档（simple fast path）

- 简单任务（AI 自行判定：单包、少量文件、无架构影响）不创建任务目录、不写 PRD、不走 `task.py`，直接 inline 实现。
- 直通路径仍保留质量底线：实现前加载 `trellis-before-dev` 相关 spec，实现后跑 lint/typecheck（`trellis-check` 的轻量内联形态）。
- 复杂任务仍走完整三阶段任务制（brainstorm → prd/design/implement → implement/check → finish）。
- 判定权在 AI，但用户可在任意一轮把任务升级为任务制；升级后任务制工件从头建。
- workflow.md 的 `no_task` 面包屑改写为"默认直通、复杂才建任务"，与现有 triage 文案相反。

### R4 移除 Channel 系统

- 不打包 `packages/core` 的 channel 模块、CLI 的 `channel` 命令树、supervisor、`.trellis/agents/` 中仅服务 channel 运行时的角色定义。
- 移除 `trellis-channel` skill 及其 references。
- `trellis spawn`/多 Agent 编排相关 workflow 文案（channel-driven 模板引用）一并清理。
- 子代理派发（trellis-implement / trellis-check / trellis-research）保留——它们走平台原生 Agent/Task 机制，不依赖 channel。

### R5 Python 脚本层保持兼容

- `.trellis/scripts/` 的 task.py / get_context.py / hook 脚本原样保留（上游已是 channel-free），仅随 R3 调整 workflow_phase 文案相关内容。
- 保持 `python3 ./.trellis/scripts/...` 调用约定不变，避免破坏 hook 注册。

## Out of Scope

- 模板系统重构（自研占位符语言 → Handlebars 等）——保持现状。
- Python/TS 双语言边界统一——保持现状。
- 19 个非目标平台的任何兼容/迁移路径。
- Channel 功能的"可选包化"（直接删除，不做拆包保留）。
- marketplace / docs-site / 仓库级周边（husky、release 脚本按需精简，不做系统性重构）。

## Key Decisions（已全部确认，2026-09-14）

- **D1 命名**：包名 `trellis-tiny`，bin `tt`（+别名 `trellis-tiny`）。✅ 用户确认。
- **D2 `trellis mem`（会话记忆检索）**：**保留**——workspace 记忆价值的核心，`core/mem` 零 channel 依赖（已验证），trellis-session-insight skill 依赖它。✅ 用户确认。
- **D3 ablate/restore（消融对比）**：**移除**——实验性功能，与日常使用无关。✅ 用户确认。
- **D4 构建形态**：**方案 B（重建最小包）**——新起单包，Python 脚本层原样移植，TS 侧只实现 3 平台最小 init/update/uninstall + mem，接受重写 hash 跟踪机制的代价。✅ 用户确认。
- **D5 既有项目收敛**：实现最小收敛路径——tiny init 识别并清理上游产物（首个用例即本仓库）。✅ 用户确认。

## Acceptance Criteria

- [ ] AC1 `trellis-tiny init` 在干净项目中只产出 3 个平台目录 + `.trellis/`，不出现第 4 个平台的任何文件。
- [ ] AC2 init 后 `.agents/skills/` 是唯一 trellis skill 目录；`.zcode/skills/` 不存在；dsh 三入口在 `.dsh/skills/`；md5 检查各 skill 全项目唯一。
- [ ] AC3 在 zcode / codex 会话中，skill 列表每个 trellis skill 只出现一次（无双根重复）。
- [ ] AC4 简单任务请求（如"修个 typo"）全程不产生 `.trellis/tasks/` 新目录；复杂任务请求正常走任务制。
- [ ] AC5 全仓库无 channel 代码路径：`grep -ri channel` 在 tiny 源码中无实质命中（文档历史除外）；CLI 无 `channel` 子命令。
- [ ] AC6 `.trellis/scripts/` 原样可用：task.py create/start/finish/archive、get_context.py 三种 mode、session-start / inject-workflow-state hook 在 zcode 会话正常工作。
- [ ] AC7 `trellis-tiny update` 在 tiny 安装的项目上幂等重跑，无 diff 产生。
- [ ] AC8 `trellis-tiny init` 在当前仓库（上游 trellis 初始化过）运行后收敛：`.zcode/skills/` 被清理，其余上游产物与 tiny 产物一致。

## Change Log

- 2026-09-14：Q1 经用户决断为方案 B；D1/D2/D3/D5 经用户确认。PRD 收敛完成，无阻塞问题。
