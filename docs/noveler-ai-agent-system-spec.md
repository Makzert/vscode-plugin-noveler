# Noveler AI Agent System – Implementation Spec

Version: v1.0
Target: 基于 vscode-plugin-noveler 构建内嵌 MCP Server + AI Client 的小说 Agent 写作系统
架构原则：插件内部双层结构（MCP Server + AI Client），无外部强依赖

---

# 0. 总体架构

```
VSCode Extension Host
│
├── MCP Server Layer
│   ├── ProjectContextService
│   ├── AgentOrchestrator
│   ├── TaskQueue
│   ├── EvaluationEngine
│   └── ToolRegistry
│
└── AI Client Layer
    ├── LLMClient
    ├── PromptBuilder
    ├── ModelRouter
    └── ResponseParser
```

数据流：

UI Command → MCP Server → AgentOrchestrator → AI Client → LLM → 结果回传 → 文档写入

---

# 1. 版本规划

| 版本   | 目标              | 说明           |
| ---- | --------------- | ------------ |
| v0.1 | AI 基础能力接入       | 单 prompt 调用  |
| v0.2 | MCP Server 基础框架 | tool call 架构 |
| v0.3 | 单 Agent 写作流程    | 大纲 → 草稿      |
| v0.3.x | 手写辅助体验层      | 侧边栏 + 当前文档优先 |
| v0.4 | 多轮生成与评分选择       | 多候选机制        |
| v0.5 | 精改与风格统一         | 重写系统         |
| v0.6 | 全流程自动化 Pipeline | 一键生成章节       |

---

# 2. Commit 级实现步骤

---

# v0.1 – AI Client 基础能力

## Commit 1

feat(ai): add LLMClient wrapper

新增文件：

src/ai/LLMClient.ts

功能：

* 支持 OpenAI 兼容接口
* 支持 streaming
* 支持 temperature/max_tokens

接口：

```ts
generate(prompt: string, options?: ModelOptions): Promise<string>
```

---

## Commit 2

feat(ai): add PromptBuilder

新增：

src/ai/PromptBuilder.ts

功能：

* system + user 拼接
* 支持变量模板

---

## Commit 3

feat(ui): add test AI command

新增 command：

noveler.ai.test

功能：

* 输入 prompt
* 调用 LLM
* 输出到新 markdown 文件

---

# v0.2 – MCP Server 层

## Commit 4

feat(mcp): add MCPServer skeleton

新增：

src/mcp/MCPServer.ts

功能：

* registerTool()
* handleRequest()
* JSON-RPC 格式通信（内部）

---

## Commit 5

feat(mcp): add ToolRegistry

新增：

src/mcp/ToolRegistry.ts

功能：

* 存储所有 tool
* tool schema 描述

---

## Commit 6

feat(mcp): integrate AI as tool

新增 tool：

generate_text

参数：

```
{
  system: string
  prompt: string
  temperature: number
}
```

实现：内部调用 LLMClient

---

# v0.3 – 单 Agent 写作流程

## Commit 7

feat(agent): add OutlineAgent

新增：

src/agents/OutlineAgent.ts

职责：

* 输入：小说主题
* 输出：三幕结构大纲

---

## Commit 8

feat(agent): add DraftAgent

新增：

src/agents/DraftAgent.ts

职责：

* 输入：大纲 + 章节
* 输出：章节草稿

---

## Commit 9

feat(orchestrator): add simple pipeline

新增：

src/mcp/AgentOrchestrator.ts

功能：

```
createOutline()
createChapterDraft()
```

---

## Commit 10

feat(ui): add generate outline command

命令：

noveler.generate.outline

效果：

* 生成 outline.md

---

# v0.4 – 多候选生成 + 自动评分

## Commit 11

feat(agent): add MultiDraftGenerator

功能：

* 同 prompt 生成 N 个候选

---

## Commit 12

feat(agent): add EvaluatorAgent

职责：

* 输入：多个文本
* 输出：评分 JSON

评分维度：

* 连贯性
* 情绪张力
* 人物塑造
* 可读性

---

## Commit 13

feat(orchestrator): add auto-select best draft

逻辑：

* 调用 Evaluator
* 选择最高分
* 保存
* 其他版本存入 history/

---

# v0.3.x – 手写辅助体验层

目标：在全自动 Pipeline 完成前，先提供一个真正可用的手写辅助工作台，让作者在当前章节里无缝调用 AI。

## Writing Assistant Sidebar UI

新增：

* 侧边栏 / Webview 形式的 AI 写作助手
* 固定表单，不再依赖 `showInputBox` 承载核心写作流程
* 最近一次模式 / 目标 / 提示要求持久化
* 显示当前文档、选区、当前段落等上下文摘要
* 保持侧边栏作为状态面板，而不是唯一操作入口

核心字段：

* mode
* target
* extra prompt
* preview result

## Hand-Writing Assist Commands

基础模式：

* continue writing
* rewrite selection
* expand paragraph
* polish dialogue
* summarize current chapter

设计目标：

* 优先服务手写创作过程
* 不强迫用户先准备独立大纲文件
* 当前活动文档是第一上下文来源
* 支持纯键盘完成主要操作链路
* 用户可以不离开编辑器区域完成生成与应用

## In-Editor Destination Model

输出目标规则：

* insert at cursor
* replace selection / current paragraph
* append to current chapter

规则：

* 当前文档优先
* 非调试流程不应默认写入 `drafts/`
* `drafts/` 只用于测试命令或显式草稿流

## In-Editor Preview Model

预览要求：

* 生成预览应尽量直接显示在编辑器内，而不是迫使用户移开视线
* 可使用虚体、弱化颜色、特殊高亮或内联装饰表示“未正式应用”的 AI 结果
* 预览应锚定在当前光标 / 当前段落附近
* 应用成功后自动清除预览装饰
* 若预览内容过长，可在编辑器内展示截断版本，并保留完整结果用于应用
* 预览阶段不得显示 thinking / analysis 等内部推理内容

## Response Sanitization Pipeline

新增清洗层：

* 移除思考 / reasoning / analysis 片段
* 移除 Markdown 包裹代码块
* 移除 front matter
* 移除重复标题 / “以下是结果” 等元话语
* 正文模式只允许输出 body-only 内容

失败保护：

* 若清洗后仍检测到噪声，给出 warning
* 对替换类操作优先预览后应用

## Seamless Interaction Rules

交互要求：

* 侧边栏一键进入
* 编辑器标题栏应提供快捷入口
* 尽量减少 modal 弹窗
* 保持光标和选区语义
* 破坏性操作先预览，再应用
* 支持键盘优先操作：
  * `Ctrl/Cmd + Enter` 生成预览
  * 编辑器内支持 `Ctrl/Cmd + Alt + Enter` 生成
  * 编辑器内支持 `Ctrl/Cmd + Alt + I/R/P` 应用到插入 / 替换 / 追加
  * 编辑器内支持 `Ctrl/Cmd + Alt + S` 将选中文本设为补充提示
  * 编辑器内支持 `Ctrl/Cmd + Alt + M/T` 切换模式 / 应用目标
  * 提供快捷键直接打开 AI 写作助手
* 允许“编辑器不失焦”的纯键盘流程：设定状态 → 流式预览 → 应用结果

## Output Contract for Agents

所有手写辅助模式统一要求：

* 仅返回最终正文 / 最终摘要
* 不返回 chain-of-thought
* 不返回 prompt restatement
* 不返回标题、front matter、解释说明

## Streaming Generation Rules

流式生成要求：

* 写作生成任务默认支持 streaming
* 生成中应能看到“仍在输出”的明确状态
* 流式内容应同步更新到侧边栏和编辑器内联预览
* 生成结束后再经过清洗层与质量门槛检查
* 流式预览阶段也必须经过轻量清洗，禁止把 thinking 直接暴露给用户

## Inline Accept / Discard Actions

预览交互要求：

* 章节标题区域应提供内联 `接受 AI 预览 / 丢弃 AI 预览 / Diff 对比`
* 这些动作应尽量减少鼠标位移，并与键盘快捷键并存

## Quality Gates for Assist Mode

最低质量门槛：

* 拒绝明显跑题输出
* 检测重复标题
* 检测解释性废话
* 尽量维持当前章节人称、时态、语气

## Character Sync Rules

人物信息同步原则：

* 人物同步改为手动触发，而不是每次保存或每次应用后自动执行
* 章节文本和章节 front matter 中的 `characters[]` 应在手动同步时保持一致
* 新人物可自动创建最小 stub 档案
* 已有人物档案可自动补 `firstAppearance` / `modified`
* 不做高风险的正文驱动自动删档
* 人物补全分两层：
  * 低级模型抽取人名
  * 中级模型补 appearance / personality / background

## Model Tier Routing

模型分级原则：

* `high`: 正文生成、扩写、改写、润色
* `medium`: 摘要、人物信息归纳、结构化补全
* `low`: 人名识别、轻量分类、低成本提取

默认策略：

* 写作质量优先的任务使用高等级模型
* 信息抽取与同步任务使用中低等级模型
* 保留回退策略：若某级模型未配置，则回退到默认模型

## State and Context Loading

上下文优先级：

1. active editor
2. current selection / current paragraph
3. nearby text around cursor
4. outline / characters / recent chapters

原则：

* 先服务当前写作现场
* 次级项目上下文只做辅助参考

## Adoption Path

推荐落地顺序：

1. usable manual assistant first
2. multi-candidate + evaluator
3. rewrite + style profile
4. full chapter pipeline

即：先解决“好不好用”，再叠加“自动化深度”。

---

# v0.5 – 精改与风格系统

## Commit 14

feat(agent): add RewriteAgent

模式：

* 精简
* 强化情绪
* 提升张力
* 统一风格

---

## Commit 15

feat(style): add StyleProfile system

新增：

src/style/StyleProfile.ts

内容：

```
{
  tone
  pacing
  target_audience
  taboo_rules
}
```

---

## Commit 16

feat(agent): rewrite draft using style profile

将 style 注入 prompt

---

# v0.6 – 全流程自动化

## Commit 17

feat(pipeline): add ChapterPipeline

流程：

```
1. 读取大纲
2. 生成草稿
3. 多候选
4. 自动评分
5. 选优
6. 精改
7. 最终输出
```

---

## Commit 18

feat(ui): add "Generate Full Chapter" command

命令：

noveler.generate.chapter.full

---

## Commit 19

feat(context): add ProjectContextService

功能：

* 读取已有章节
* 角色设定
* 世界观设定
* 自动注入上下文

---

## Commit 20

refactor: unify all agents as MCP tools

所有 agent 统一通过 MCPServer 调度

---

# 3. 最终能力矩阵

| 功能      | 是否支持 |
| ------- | ---- |
| 选题生成    | ✔    |
| 大纲生成    | ✔    |
| 单章写作    | ✔    |
| 多候选生成   | ✔    |
| 自动评分    | ✔    |
| 精改      | ✔    |
| 风格控制    | ✔    |
| 全流程一键执行 | ✔    |

---

# 4. 目录结构最终形态

```
src/
  ai/
  mcp/
  agents/
  style/
  pipeline/
  context/
```

---

# 5. 下一步建议

当 v0.6 完成后：

* 引入向量数据库记忆层
* 加入角色一致性检查 Agent
* 加入剧情冲突检测 Agent
* 引入人类评分反馈系统
* 支持不同模型路由（经济模式 / 高质量模式）

---

如果你愿意，我可以下一步：

* 给你每个 Agent 的 Prompt 精确模板
* 或给你完整 TypeScript
