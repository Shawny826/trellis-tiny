# trellis-tiny 技术设计

关联：`prd.md`（需求与验收）· `research/skill-roots-and-channel-footprint.md`（事实依据）

## 1. 总体形态

**单 TS 包，非 monorepo**。在本仓库新建 `tiny/` 目录作为 npm 包，上游 `Trellis/` 仅作参照源，不再参与构建。

```
trellis-tiny/                    # 本仓库（自身仍由 workflow 管理）
├── tiny/                        # ← 新建：trellis-tiny npm 包
│   ├── package.json             # name: trellis-tiny; bin: tt + trellis-tiny
│   ├── tsconfig.json
│   ├── scripts/copy-templates.js    # 构建时把 src/templates 拷入 dist（沿用上游模式）
│   ├── src/
│   │   ├── cli/index.ts             # commander 入口：init / update / uninstall / mem / --version
│   │   ├── commands/
│   │   │   ├── init.ts              # 重写：3 平台 + 收敛
│   │   │   ├── update.ts            # 重写：hash 清单 diff 重放
│   │   │   ├── uninstall.ts         # 重写：按清单逆向删除
│   │   │   └── mem.ts               # 移植：core/mem 的 CLI 包装（裁剪 channel 无关，本就无关）
│   │   ├── configurators/
│   │   │   ├── shared.ts            # 移植+裁剪：占位符解析 / filterCommands / skill 收集
│   │   │   ├── codex.ts             # 移植：agents TOML + hooks + config.toml
│   │   │   ├── zcode.ts             # 改造：去掉 .zcode/skills 写入
│   │   │   ├── dsh.ts               # 移植：DSH.md + .dsh/skills 三入口
│   │   │   └── index.ts             # 3 平台注册表（AI_TOOLS 精简版 + claude 休眠位）
│   │   ├── lib/
│   │   │   ├── mem/                 # 原样移植 core/src/mem（6,087 行，零 channel 依赖已验证）
│   │   │   ├── task/                # 原样移植 core/src/task（561 行，task-json.ts 依赖）
│   │   │   ├── python-resolver.ts   # 移植：Windows python/python3/py -3 探测
│   │   │   └── template-hash.ts     # 移植+简化：.template-hashes.json 读写
│   │   ├── utils/
│   │   │   ├── file-writer.ts       # 移植：写文件 + 写入记录（收敛/卸载依据）
│   │   │   ├── posix.ts / cwd-guard.ts  # 移植
│   │   │   └── task-json.ts         # 移植（import 改指 lib/task）
│   │   └── templates/               # 从上游 vendored，见 §2
│   └── test/                        # vitest：init/update/收敛/占位符/AC 断言
├── .trellis/                        # 本仓库工作流（不动；实现完成后用 tiny 重新收敛）
└── Trellis/                         # 上游源码，只读参照
```

依赖：`commander`、`chalk`、`inquirer`、`undici`（mem 用）——不引入上游的 figlet/giget/zod（无对应功能）。mem/task 移植如需 zod schema 再按需补。

## 2. 模板集（vendored from upstream）

| 目标 | 来源 | 修改 |
|---|---|---|
| `templates/trellis/scripts/` | 上游同名 | **原样**（已验证 channel-free；不含 linear_sync.py，上游模板本就不含） |
| `templates/trellis/workflow.md` | 上游同名 | **改写**：`[workflow-state:no_task]` 块 + Request Triage → 默认直通（R3） |
| `templates/trellis/{config.yaml,gitignore.txt,gitattributes.txt,agents/,tasks/,spec 模板}` | 上游同名 | agents/ 目录**不拷贝**（channel 运行时专用）；其余原样 |
| `templates/common/skills/ + commands/` | 上游同名 | 原样 |
| `templates/common/bundled-skills/` | 上游同名 | **剔除 trellis-channel/** |
| `templates/shared-hooks/`（5 个 Python hook） | 上游同名 | 原样（zcode/codex 共用） |
| `templates/codex/` | 上游同名 | 原样（agents TOML / hooks / hooks.json / config.toml） |
| `templates/zcode/` | 上游同名 | 原样（agents / config.json） |
| `templates/dsh/` | 上游同名 | 原样（DSH.md 指南） |
| `templates/claude/` | 上游同名 | **休眠拷贝**：文件存在但注册表标记 `available:false`（扩展位） |

`templates/trellis/agents/`（implement.md / check.md）**不移植**：它们是 channel spawn 的运行时角色（调研 §2），平台原生子代理定义（`.zcode/agents/`、`.codex/agents/`）在各自平台模板目录中，与此无关。

## 3. skill 单一根分发（R2）

三个 configurator 的 skill 写入策略：

- **codex**：`resolveAllAsSkillsNeutral` → `.agents/skills/`（与上游行为一致，含 3 个命令入口 skill，因 codex 无 SessionStart hook）。
- **zcode**：**改为**与 codex 相同——neutral 渲染写 `.agents/skills/`，**不再写 `.zcode/skills/`**。`.zcode/` 保留：`hooks/`、`config.json`、`agents/`、`commands/trellis/`。ZCode 双根扫描已实证（调研 §1）；skill 去重收益：每会话上下文中 9 个重复条目消失。
- **dsh**：`resolveSkillsNeutral` → `.agents/skills/`；`.dsh/skills/` 仅 3 个命令入口（平台化渲染）。

**回退开关**：`AI_TOOLS.zcode.templateContext` 增加运行时无需感知——若未来 ZCode 取消双根扫描，把 zcode configurator 的 skill 目标根改回 `.zcode/skills/` 即可，模板源不变。

**中性渲染的占位符约束**（沿用上游契约）：写 `.agents/skills/` 的文件必须用 neutral 渲染器保证字节一致；平台化占位符（`{{CLI_FLAG}}` 等）只允许出现在平台私有根文件中。

## 4. init / update / uninstall

### init（重写，目标 ≤600 行）

1. `cwd-guard`（禁止在 home 目录 init）。
2. Python 探测：`TRELLIS_PYTHON_CMD` > `TRELLIS_SKIP_PYTHON_CHECK` > 候选列表探测（逻辑移植）。
3. 平台选择：`--codex --zcode --dsh` 旗标或 inquirer 交互（默认勾选 zcode+codex，因 dsh 场景独立）。`--claude` 打印"扩展位未启用"。
4. 写 `.trellis/` 骨架：scripts（含执行位）、workflow.md、config、gitignore/gitattributes（journal merge=union 追加式）、spec 最小模板、workspace/、tasks/。
5. 按 §3 写平台文件；全程经 file-writer 记录写入清单。
6. **收敛（D5）**：检测上游遗留 → 删除清单见 §5。
7. 写 `.trellis/.template-hashes.json`（路径→sha256，含 schema 版本字段，沿用上游文件名与结构）。

### update（重写，目标 ≤500 行）

1. 读 `.template-hashes.json` + 重新渲染期望文件集。
2. 三路对比：
   - 清单内且盘上 hash == 期望 hash → 静默覆盖（模板更新）。
   - 清单内但盘上 hash ≠ 清单 hash → 用户本地改过 → 交互提示（保留/覆盖/show diff）。
   - 清单内但新文件集已不含 → 删除（模板下线）。
3. 新增文件直接写入；结束后重写清单。
4. 幂等性 = AC7：无模板变更时二跑零 diff。

### uninstall

按清单删除 + 平台目录若全部内容均为 tiny 写入则连目录一起删；`.trellis/tasks/`、`workspace/`（用户数据）保留并提示。

## 5. 上游产物收敛清单（硬编码遗留路径）

| 遗留路径 | 处理 |
|---|---|
| `.zcode/skills/trellis-*` | 删除（R2 核心；目录空则删目录） |
| 19 个非目标平台目录（`.claude/`、`.cursor/`…若存在且含 trellis 写入特征） | 提示后删除 |
| `.trellis/scripts/hooks/linear_sync.py`（若上游 init 写入过） | 删除 |
| `.trellis/.template-hashes.json` 中的非 tiny 条目 | 重建清单时自然丢弃 |

收敛仅在 init 显式检测到时执行，且逐项打印将要删除的路径（可 `--dry-run`）。**不动**用户数据：`.trellis/tasks/**`、`.trellis/workspace/**`、`.trellis/spec/**`（spec 视为用户资产，只增不删）。

## 6. workflow.md 直通档（R3）

改动面（三处同步，缺一会导致 AI 行为分裂）：

1. **`[workflow-state:no_task]` 块**：从"每轮先问是否建任务"改为：
   > 简单任务（单包、少文件、无架构影响、可即时验证）：**默认直通**——加载 `trellis-before-dev` 相关 spec → inline 实现 → `trellis-check` 验证 → 提交。不建任务目录、不问建任务。
   > 复杂/多交付物/架构影响：询问是否创建 Trellis 任务并进入 planning（原有 consent 语义保留于此档）。
   > 用户任意一轮可说"升级为任务"→ 走 Phase 1.0 从头建任务。
2. **Request Triage 段**：与新 no_task 块对齐（简单=不问、复杂=问）。
3. **`trellis-start` skill 模板**（`common/skills/start.md`）中的分流描述同步。

**不改动**：`planning / planning-inline / in_progress / in_progress-inline / completed` 各块（任务制内部流程不变）；步骤编号；`[required · once]` 标记体系。上游回归不变量（required 步骤必须在面包屑有强制行）继续成立——Phase 1/2/3 的块本就覆盖，no_task 块不承载 required 步骤。

**标签完整性校验**：TS 侧新增一个纯函数校验器 + 测试：所有 `[workflow-state:X]` 块闭合、STATUS 字符合法、五个必需 status 齐全。inject-workflow-state.py 不改（它只解析）。

## 7. 移除面（R4 落点）

- 不移植：`core/src/channel`、`cli/src/commands/channel`、`ablate/restore`、`upgrade`（npm 换版本直接 `npm i -g trellis-tiny@latest`）、`workflow.ts` 命令（marketplace 模板拉取）、`template-fetcher` / `registry-config` / `proxy` / `workflow-resolver`（远程模板体系）、`ablation-store` / `managed-removal` / `manifest-prune` / `uninstall-scrubbers`（23 平台矩阵的卸载/消融配套，由 §4 的清单机制替代）、`project-detector`（spec 模板改为通用最小集）。
- 模板剔除：`bundled-skills/trellis-channel`、`trellis/agents/`。
- workflow.md 中 channel-driven 相关引用：上游 native 模板正文无 channel 引用（channel-driven 是独立 marketplace workflow 模板），确认后无需正文清理。
- 保留但注意：`trellis-session-insight` skill 依赖 `trellis mem` CLI——mem 移植后该 skill 文案中的调用命令改为 `tt mem …`？**不改**——skill 文案引用的是 `trellis mem`，为兼容，`tt` 的 mem 子命令行为对齐，且 skill 模板中命令名在 vendored 时全局替换 `trellis mem` → `tt mem`（模板层面的机械替换，测试覆盖）。

## 8. 兼容性与风险

| 风险 | 缓解 |
|---|---|
| ZCode 未来取消 `.agents/skills/` 双根扫描 | §3 回退开关；AC3 在真机验证 |
| workflow.md 标签块改坏 → 面包屑降级 | §6 校验器 + 测试；dogfood 首轮会话即暴露 |
| 上游 `.template-hashes.json` 结构变化 | tiny 首版只面对本仓库存量；init 收敛时整表重建，不解析上游语义 |
| mem 移植的传递依赖 | 移植后 `pnpm typecheck + vitest` 全绿为准；mem 无 channel 依赖已验证 |
| 直通档被滥用（复杂任务也直通） | no_task 文案给出明确判定维度；用户可随时口头升级；journal 仍记录会话 |

## 9. 验证策略

- 单测（vitest，temp dir）：init 文件集断言（AC1/AC2）、update 幂等（AC7）、收敛删除（AC8 的 fs 部分）、占位符/neutral 渲染、workflow 标签校验器。
- 全局 grep 断言（AC5）：测试中扫描 dist + templates 无 channel 实质命中。
- 真机 dogfood（AC3/AC4/AC6/AC8）：在本仓库跑 `tt init` 收敛后，开新 zcode/codex 会话验证 skill 单例、直通行为、hook 注入。
