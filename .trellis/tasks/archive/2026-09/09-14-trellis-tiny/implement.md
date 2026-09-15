# trellis-tiny 实施计划

前置：`prd.md`（AC1-AC8）· `design.md`（§1-§9）。上游参照源固定为 `./Trellis`（v0.6.17），不追新。

## 执行清单（按序）

### M0 包脚手架
- [ ] `tiny/package.json`（name `trellis-tiny`，bin `tt` + `trellis-tiny`，deps: commander/chalk/inquirer/undici，engines node>=18）
- [ ] `tsconfig.json`（ESM、NodeNext，对齐上游 cli 包配置）
- [ ] `scripts/copy-templates.js`（dist 拷模板，参照上游同名脚本裁剪）
- [ ] vitest + 最小 eslint 配置
- 验证：`pnpm -C tiny build && pnpm -C tiny test` 空壳通过

### M1 模板 vendoring（先物 料后逻辑，后续里程碑才有可写内容）
- [ ] 拷 `templates/trellis/scripts/`（原样，含执行位语义）
- [ ] 拷 `templates/trellis/{config.yaml,gitignore.txt,gitattributes.txt}` + spec/tasks 骨架模板；**跳过 `agents/`**
- [ ] 拷 `templates/common/{skills,commands,bundled-skills}/`，剔除 `trellis-channel`
- [ ] 拷 `templates/shared-hooks/`、`templates/codex/`、`templates/zcode/`、`templates/dsh/`、`templates/claude/`（休眠）
- [ ] workflow.md 拷入并做 R3 三处改写（design §6：no_task 块 / Request Triage / start skill 文案同步——start skill 在 common/skills/start.md）
- [ ] vendored 全局替换 `trellis mem` → `tt mem`（design §7）
- 验证：workflow 标签块目视闭合；`grep -ri channel tiny/src/templates` 仅允许 markdown 般无害命中（应为零）

### M2 库移植
- [ ] `lib/task/`（561 行原样，改 import 相对路径）
- [ ] `lib/mem/`（6,087 行原样 + import 路径调整）
- [ ] `utils/{posix,cwd-guard,file-writer}.ts`、`lib/python-resolver.ts`、`lib/template-hash.ts`（`.template-hashes.json` 读写 + schema version）
- 验证：`pnpm -C tiny typecheck` 绿；mem/task 相关上游测试挑核心用例同步移植并通过

### M3 configurators
- [ ] `configurators/shared.ts`：resolvePlaceholders / neutral 变体 / filterCommands / wrapWithSkillFrontmatter / collectSkillTemplates（从上游裁剪，保留全部现有占位符）
- [ ] `configurators/codex.ts`：移植（含 preserveCodexAgentModelKeys —— update 需要）
- [ ] `configurators/zcode.ts`：改造——skill 目标根改 `.agents/skills/` neutral 渲染，其余四类输出不变
- [ ] `configurators/dsh.ts`：移植（三入口 + DSH.md）
- [ ] `configurators/index.ts`：3 平台注册 + claude `available:false` 休眠位
- 验证：单测——每平台 collect*Templates() 的文件集快照断言；`.agents/skills/` 内容与 codex/dsh 写入字节一致（neutral 契约）

### M4 init 命令
- [ ] 主流程（design §4：guard→python→平台选择→.trellis 骨架→平台文件→清单）
- [ ] 收敛逻辑（design §5 清单 + `--dry-run`）
- 验证：temp dir 单测覆盖 AC1、AC2（md5 唯一性断言）、AC8 fs 部分（预置 `.zcode/skills/` 假上游产物→init 后消失）

### M5 update / uninstall
- [ ] update 三路对比 + 交互（design §4）
- [ ] uninstall 按清单逆向删（保留 tasks/workspace/spec）
- 验证：AC7 单测（连续两次 update 第二次零写入）；用户本地修改场景的 keep/override 分支单测

### M6 mem 命令接线
- [ ] `commands/mem.ts` 移植，import 改 `lib/mem`
- [ ] `tt mem` 冒烟（对本地会话历史跑一次检索）
- 验证：真机 `tt mem` 返回结果

### M7 CLI 入口与校验器
- [ ] `cli/index.ts`（init/update/uninstall/mem/--version）
- [ ] workflow.md 标签校验器纯函数 + 测试（design §6）
- [ ] AC5 grep 断言测试（dist+templates 无 channel 实质命中）
- 验证：`pnpm -C tiny lint && pnpm -C tiny typecheck && pnpm -C tiny test` 全绿

### M8 dogfood（真机验收，本仓库）
- [ ] `node tiny/dist/cli/index.js init --zcode --codex`（含收敛，先 `--dry-run` 看清单）
- [ ] 确认 `.zcode/skills/` 已清、`.agents/skills/` 唯一（AC2/AC8）
- [ ] 开新 ZCode 会话：skill 列表单例（AC3）、简单请求直通不建任务（AC4）、hook 面包屑正常（AC6）
- [ ] Codex 会话同验 AC3/AC4/AC6（`features.hooks` 提示按上游文档处理）
- [ ] `tt update` 在本仓库幂等（AC7 真机）

### M9 收尾
- [ ] `tt` 全局 link 自用；README-tiny.md（简短：装、init、直通/任务制两档说明）
- [ ] 回填 spec：`.trellis/spec/` 新增 tiny 包层 guidelines（init/update 契约、neutral 渲染约束、收敛清单维护规则）
- [ ] 提交（按 3.4 批量提交流程）

## 验证命令汇总

```bash
pnpm -C tiny lint && pnpm -C tiny typecheck && pnpm -C tiny test   # 每个里程碑出口
node tiny/dist/cli/index.js init --dry-run                          # M8 前预演
grep -ri channel tiny/src --include="*.ts"                          # AC5（应为零命中）
```

## 风险文件与回滚点

| 文件/步骤 | 风险 | 回滚 |
|---|---|---|
| `templates/trellis/workflow.md` R3 改写 | 标签块破损→面包屑降级 | git revert 单文件；校验器先行的测试兜底 |
| zcode skill 根切换（M3） | ZCode 版本行为差异 | configurator 单文件改回 `.zcode/skills/`，无数据迁移 |
| M8 dogfood init | 本仓库现有 `.trellis/` 被误改 | init 前手动备份 `.zcode/ .agents/ .codex/ .trellis/`（脚本 tar）；spec/tasks/workspace 在收敛白名单内不动 |
| lib/mem 移植 | 隐藏传递依赖 | 独立 commit，typecheck 即时暴露 |

## 顺序依赖

M1→M3→M4→M5 严格串行（模板→配置器→写入器→更新器）；M2 可与 M1 并行；M6 依赖 M2；M7 依赖 M3-M6；M8 依赖全部；M9 收尾。
