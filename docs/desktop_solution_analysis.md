# 本地化桌面应用方案分析

## 1. 项目现状与目标
- **现状**: Vite + React + TypeScript 纯前端项目。
- **目标**: 转换为可本地运行的桌面应用（AI本地知识库）。
- **关键需求**:
  - 本地文件系统访问 (读取/索引用户文档)。
  - 可能的本地数据库支持 (向量库/SQLite)。
  - 本地模型调用 (可选，或调用API)。

## 2. 方案对比

| 特性 | 方案 A: Electron | 方案 B: Tauri |
| :--- | :--- | :--- |
| **架构** | Chromium + Node.js | 系统 Webview + Rust |
| **安装包体积** | 较大 (~150MB+) | 极小 (~10MB) |
| **内存占用** | 较高 (每个窗口独立进程) | 较低 (共享系统资源) |
| **开发语言** | TypeScript/JavaScript (全栈) | 前端 TS + 后端 Rust |
| **生态/成熟度** | 非常成熟，社区资源丰富 | 快速增长，V2 版本已趋稳定 |
| **本地能力** | 所谓 Node.js 能做的都可以做 | 需通过 Rust 插件或 Sidecar 实现 |

## 3. 详细推荐

### 推荐方案：Electron (推荐)
**理由**:
考虑到本项目是“知识库”类型，可能涉及复杂的文件遍历、文本解析（PDF/Word读取）、数据库操作等。
- **Node.js 生态优势**: Node.js 拥有庞大的文件处理和文本解析库（如 `pdf-parse`, `langchain` 等），直接在 Electron 主进程中使用非常方便。
- **开发效率**: 您已熟悉 TS/React，使用 Electron 无需学习 Rust，可以复用大量现有的 Node.js 逻辑。
- **兼容性**: Chromium 内核保证了 UI 在所有平台上的一致性，不受系统 Webview 版本影响。

### 备选方案：Tauri
**理由**:
如果您极致追求软件的“轻量化”和“启动速度”，且不需要极度复杂的 Node.js 依赖（或者愿意折腾 Rust/Sidecar）。
- 适合简单的“壳”应用或对性能极其敏感的工具。
- **注意**: 若需要强大的本地文件解析（如依赖特定 Node 库），在 Tauri 中可能需要打包 Node.js binary 作为 sidecar，这会抵消其体积优势并增加复杂度。

## 4. Electron 实施路线规划
如果您同意使用 Electron，后续步骤如下：
1.  **环境准备**: 安装 `electron` 及其开发依赖。
2.  **主进程搭建**:
    - 创建 `electron/main.ts`: 负责应用生命周期。
    - 创建 `electron/preload.ts`: 负责安全暴露 Node.js 能力给前端。
3.  **Vite 改造**: 使用 `electron-vite` 插件或手动配置 `vite.config.ts` 以支持多入口构建。
4.  **功能迁移**:
    - 将需要文件读写的逻辑从前端迁移到 Electron 主进程。
    - 定义 IPC (进程间通信) 接口。
5.  **构建打包**: 配置 `electron-builder` 生成 Mac 安装包 (`.dmg`)。
