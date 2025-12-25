
<h1>MindSync v2.0 - AI 本地知识库智能整理中心</h1>
<p><b>人机协作型智能文件管理利器 | AI 分类建议 + 人工最终决策</b></p>
</div>

---

## 🌟 项目简介

**MindSync** 是一款专为解决个人电脑“搜索弱、分类乱、整理难”而设计的 AI 驱动本地文件管理系统。它利用先进的大语言模型（LLM）对本地文件进行内容感知分析，自动生成摘要、标签，并提出精准的分类建议。

不同于传统的全自动化整理工具，MindSync 坚持 **“AI 为辅，人为核心”** 的原则。系统提供了一个类似 Git Staging 的“审阅面板”，让用户在物理文件被移动之前，对 AI 的所有操作拥有绝对的审核和修正权。

---

## 🚀 核心特性

### 1. AI 智能内容感知 (AI-Powered Insights)
- **多模型支持**：内置对接 **Google Gemini** (1.5 Flash/Pro, 2.0 Flash Exp) 与 **DeepSeek** (V3 Chat, R1 Reasoner)。
- **深度分析**：支持分析文本、PDF、Office文档、代码文件等多种格式，自动提取 200 字摘要及 3-5 个精准标签。
- **分类理由**：AI 会解释为什么将文件归为某类（如：“检测到关键词‘发票’，归入‘财务/报销’”）。

### 2. 人机协作审阅工作流 (Review & Commit)
- **预处理沙箱**：AI 分析结果首先进入“待审阅”状态，不直接改动硬盘文件，确保数据安全。
- **可视化对比**：清晰展示“原始路径 ➔ 建议目标路径”的变换。
- **批量修正**：支持多选操作，一键批量修改分类或标签。

### 3. 可视化脑图视图 (Interactive Mindmap)
- **知识库地图**：以交互式脑图形式展现您的文件夹层级结构。
- **拖拽归类**：直接在脑图中拖动文件节点到不同分类下，触发物理移动。
- **沉浸式交互**：支持缩放、平移，通过可视化手段洞察您的知识分布。

### 4. 受控分类体系 (Taxonomy Control)
- **严格模式 (Strict Mode)**：强制 AI 遵循您预设的目录结构，或通过相似度算法匹配最接近的已有分类，防止目录膨胀。
- **灵活模式 (Flexible Mode)**：允许 AI 根据内容创造新分类，支持配置最大文件夹深度和单层最大子项数。
- **忽略规则**：内置类似 `.gitignore` 的规则管理，排除日志、`node_modules` 等无关文件。

### 5. 深度复合适用引擎 (Advanced Search)
- **多维召回**：支持文件名、AI 摘要、关键标签、以及文件内容的混合匹配搜索。
- **高级过滤**：按时间范围、文件类型、各级分类快速锁定目标。
- **极速响应**：毫秒级搜索反馈，高亮关键词命中的摘要片段。

### 6. 桌面端深度集成 (Electron)
- **本地存储**：数据全流程不经过云端（除 API 调用），元数据以 v3.0 JSON 格式存储于本地。
- **投喂区 (Drop Zone)**：支持将桌面文件批量拖入软件。
- **内容查重**：基于 MD5 哈希的精准查重，自动识别完全重复或同内容不同名的文件。

---

## 🛠️ 技术栈

- **Frontend**: React, TypeScript, Vite
- **Desktop Framework**: Electron
- **Styling**: Vanilla CSS (Modern UI Design)
- **Icons**: Lucide React
- **AI Models**: Google GenAI SDK, DeepSeek API
- **State Management**: Zustand

---

## 📦 安装与运行

### 环境准备
- Node.js (建议 v18+)

### 步骤
1. **克隆项目**:
   ```bash
   git clone https://github.com/PuJes/Mindsync_version2.git
   cd Mindsync_version2
   ```

2. **安装依赖**:
   ```bash
   npm install
   ```

3. **配置 API Key**:
   - 方式 A：在项目根目录创建 `.env.local` 文件，填入：
     `GEMINI_API_KEY=your_key_here`
   - 方式 B：启动应用后，在 UI 右上角的“设置”面板中直接填入 Gemini 或 DeepSeek 的 Key。

4. **启动开发环境**:
   ```bash
   npm run dev
   ```

5. **构建正式版本**:
   ```bash
   npm run build
   ```

---

## 📅 版本更新记录

### v3.0 (当前版本)
- 重构了核心分类逻辑，引入“严格/灵活”双模式。
- 升级审阅面板布局，支持批量编辑。
- 引入 MD5 哈希查重机制。
- 增加了对 DeepSeek R1 (Reasoner) 模型的兼容支持。

---

## ⚠️ 注意事项

- **数据备份**：本软件主要负责移动和组织文件。建议在对极为重要的旧知识库进行大规模“一键整理”前，先进行全手动备份。
- **API 消耗**：大批量文件的初次扫描会消耗较多 Token，建议对大型仓库分批次进行整理。
- **隐私保护**：虽然程序逻辑完全本地运行，但文件内容会被发送给对应的 AI 服务商（Google/DeepSeek）进行分析。如涉及极度敏感数据，请在设置中通过忽略模式排除。

---

<div align="center">
Made with ❤️ by PuJes
</div>
