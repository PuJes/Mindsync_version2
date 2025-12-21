import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';
import { storage } from './utils/fileStorage.ts';
import { ReviewDashboard } from './components/ReviewDashboard';
import { SearchPanel } from './components/SearchPanel';
import { useStagingStore } from './store/stagingStore';
import {
  FileText,
  Search,
  UploadCloud,
  Database,
  Cpu,
  Tag,
  MoreHorizontal,
  Loader2,
  CheckCircle2,
  BrainCircuit,
  Trash2,
  LayoutGrid,
  List,
  Network,
  ChevronRight,
  ChevronDown,
  FileCode,
  FileSpreadsheet,
  Presentation,
  File,
  Settings,
  X,
  Save,
  Download,
  Upload,
  KeyRound,
  AlertCircle,
  Edit2,
  Plus,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Move,
  Wand2,
  Sparkles,
  ArrowRight,
  FolderOpen,
  FolderTree,
  RefreshCw,
  Folder
} from 'lucide-react';
import { TaxonomySettingsPanel } from './components/TaxonomySettingsPanel';


// --- Error Boundary ---
class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if ((this.state as any).hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full border border-red-100">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6 mx-auto">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2 text-center">出错了</h1>
            <p className="text-slate-500 text-center mb-6">应用程序遇到意外错误。</p>

            <div className="bg-slate-50 p-4 rounded-xl mb-6 text-left overflow-auto max-h-40 border border-slate-200">
              <code className="text-xs text-red-600 font-mono break-all">
                {(this.state as any).error?.message}
              </code>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
              >
                <RotateCcw size={18} />
                重试加载
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 类型定义 ---

interface FileNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: FileNode[];
}

interface KnowledgeItem {
  id: string;
  fileName: string;
  fileType: string;
  summary: string;
  category: string;
  tags: string[];
  applicability: string; // 适用场景
  addedAt: string;
  filePath?: string; // 物理路径
}




// --- 文件读取助手 ---
const sanitizeAnalysisResult = (result: Partial<KnowledgeItem>): Partial<KnowledgeItem> => {
  const sanitized = { ...result };

  // 1. 强制分类不能为空
  sanitized.category = (String(sanitized.category || "").trim()) || "未分类";

  // 2. 强制标签去重、去空、去指令、截断为5个
  if (Array.isArray(sanitized.tags)) {
    // 过滤掉长度过长（可能是幻觉）或包含指令词的标签
    sanitized.tags = Array.from(new Set(
      sanitized.tags
        .map(t => String(t).trim())
        .filter(t => t && t.length < 20 && !t.includes("JSON") && !t.includes("注意") && !t.includes("禁止"))
    )).slice(0, 5);
  } else {
    sanitized.tags = [];
  }

  // 3. 摘要截断
  if (sanitized.summary && sanitized.summary.length > 100) {
    sanitized.summary = sanitized.summary.substring(0, 97) + "...";
  }

  return sanitized;
};

const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
};

// --- 智能判断是否可分析的后缀白名单 ---
const ANALYZABLE_EXTENSIONS = ['txt', 'md', 'pdf', 'doc', 'docx', 'py', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'json', 'csv', 'ppt', 'pptx', 'xlsx', 'xls', 'c', 'cpp', 'go', 'rs', 'java'];

const isAnalyzable = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext && ANALYZABLE_EXTENSIONS.includes(ext);
};

// --- API 调用逻辑 ---

async function analyzeContentWithDeepSeek(
  file: File,
  apiKey: string,
  modelName: string = "deepseek-chat",
  rawContent?: string,
  filePath?: string,
  existingCategories: string[] = []
): Promise<Partial<KnowledgeItem>> {
  if (!isAnalyzable(file.name)) {
    return {
      category: "无法分析",
      summary: "由于文件格式不支持或为二进制文件，AI 无法直接读取其详细内容。建议手动归类。",
      tags: ["二进制", "待处理"],
      applicability: "文件存档"
    };
  }

  const prompt = `你是一个专业的知识整理助手。请分析以下文件的内容，并将其整理为结构化的知识索引信息。

【已有分类参考】: ${existingCategories.length > 0 ? existingCategories.join(', ') : '无'}
【规则】:
1. 分类: 优先匹配相似的【已有分类】，若不匹配则创建新分类（如：技术文档/前端）。
2. 标签: 严格生成 3-5 个，去重，每个标签 2-4 字。
3. 摘要: 包含一句话概述 + 3个核心要点。
4. 返回格式: 纯 JSON，不含格式块。

文件名: ${file.name}
文件内容摘要: ${rawContent ? rawContent.substring(0, 5000) : "无法直接读取内容"}

请返回 JSON:
{
  "category": "分类名称",
  "summary": "详细摘要",
  "tags": ["标签1", "标签2", "标签3"],
  "applicability": "适用场景"
}`;

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: prompt }],
        response_format: modelName === "deepseek-chat" ? { type: "json_object" } : undefined
      })
    });

    const data = await response.json();
    let resultText = data.choices[0].message.content;
    resultText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(resultText);
  } catch (err) {
    console.error("DeepSeek Error:", err);
    throw err;
  }
}

async function analyzeContentWithGemini(
  file: File,
  apiKey: string,
  modelName: string = "gemini-2.0-flash-exp",
  rawContent?: string,
  filePath?: string,
  existingCategories: string[] = []
): Promise<Partial<KnowledgeItem>> {
  if (!isAnalyzable(file.name)) {
    return {
      category: "无法分析",
      summary: "该文件格式暂不支持深度内容分析或为加密/二进制文件。",
      tags: ["无法读取"],
      applicability: "归档"
    };
  }

  const client = new GoogleGenAI({ apiKey });
  const result = await (client as any).models.generateContent({
    model: modelName,
    contents: [{
      role: 'user', parts: [{
        text: `分析文件并返回 JSON。已有分类：${existingCategories.join(', ') || '无'}。
要求：分类优先匹配已有；标签精准 3-5 个；摘要包含核心点。
文件名: ${file.name}
预览: ${rawContent ? rawContent.substring(0, 5000) : "请根据文件名推测"}`
      }]
    }],
    config: { responseMimeType: "application/json" }
  });

  let text = "";
  if (result.response && typeof result.response.text === 'function') {
    text = await result.response.text();
  } else if (result.text && typeof result.text === 'string') {
    text = result.text;
  }

  return JSON.parse(text);
}
;

// --- 子组件：脑图树节点 (Tree Node) ---
interface TreeNodeProps {
  label: React.ReactNode;
  type: 'root' | 'category' | 'file' | 'tag';
  childrenNodes?: React.ReactNode[];
  defaultCollapsed?: boolean;
  // 拖拽相关属性
  dataId?: string; // 用于识别节点 ID
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDropOnCategory?: (e: React.DragEvent, categoryName: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  label,
  type,
  childrenNodes,
  defaultCollapsed = false,
  dataId,
  onDragStart,
  onDropOnCategory
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [isDragOver, setIsDragOver] = useState(false);
  const hasChildren = childrenNodes && childrenNodes.length > 0;

  const handleDragOver = (e: React.DragEvent) => {
    if (type === 'category') {
      e.preventDefault(); // 允许放置
      e.stopPropagation();
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (type === 'category') {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (type === 'category' && onDropOnCategory && dataId) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      onDropOnCategory(e, dataId); // 这里的 dataId 是 category 的名称
    }
  };

  const handleDragStartNode = (e: React.DragEvent) => {
    if (type === 'file' && onDragStart && dataId) {
      e.stopPropagation();
      onDragStart(e, dataId);
    }
  };

  const getNodeStyles = () => {
    let baseStyle = "relative flex flex-col justify-center transition-transform duration-300 ";

    if (type === 'root') return baseStyle + 'bg-slate-900 text-white shadow-lg border-slate-800 px-6 py-3 rounded-full text-base font-bold tracking-wide z-20';
    if (type === 'category') return baseStyle + `bg-white border-2 ${isDragOver ? 'border-blue-500 ring-4 ring-blue-100 scale-105' : 'border-blue-100'} text-blue-700 shadow-sm px-5 py-2.5 rounded-xl text-sm font-bold min-w-[120px] text-center z-10 hover:border-blue-300 hover:shadow-md transition-all`;
    if (type === 'file') return baseStyle + 'bg-white border border-slate-200 text-slate-700 shadow-sm px-4 py-3 rounded-xl text-sm font-medium min-w-[200px] max-w-[260px] text-left z-10 hover:border-blue-400 hover:shadow-md hover:-translate-y-0.5 transition-all group cursor-grab active:cursor-grabbing';
    if (type === 'tag') return baseStyle + 'bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-medium hover:bg-emerald-100 transition-colors cursor-pointer hover:border-emerald-300';
    return baseStyle + 'bg-white border border-slate-200';
  };

  return (
    <div className="flex items-center">
      <div
        className={`${getNodeStyles()} ${hasChildren ? 'cursor-pointer' : ''}`}
        onClick={() => hasChildren && setIsCollapsed(!isCollapsed)}
        draggable={type === 'file'}
        onDragStart={handleDragStartNode}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-2">
          {label}
          {hasChildren && type !== 'root' && (
            <div className={`w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}><ChevronRight size={10} /></div>
          )}
        </div>
        {!isCollapsed && hasChildren && <div className="absolute -right-8 top-1/2 w-8 h-px bg-slate-300"></div>}
      </div>
      {!isCollapsed && hasChildren && (
        <div className="flex flex-col ml-8 relative">
          <div className="flex flex-col gap-3 py-1">
            {childrenNodes.map((child, index) => {
              const isFirst = index === 0;
              const isLast = index === childrenNodes.length - 1;
              const isOnly = childrenNodes.length === 1;
              return (
                <div key={index} className="relative flex items-center">
                  {!isOnly && <div className={`absolute -left-4 w-px bg-slate-300 ${isFirst ? 'top-1/2 h-1/2' : ''} ${isLast ? 'top-0 h-1/2' : ''} ${!isFirst && !isLast ? 'top-0 h-full' : ''}`}></div>}
                  <div className={isFirst
                    ? "absolute -left-4 w-4 top-1/2 h-px bg-slate-300"
                    : "absolute -left-4 w-4 top-0 h-[calc(50%+1px)] border-l border-b border-slate-300 rounded-bl-xl"
                  }></div>
                  {!isFirst && !isLast && <><div className="absolute -left-4 top-0 bottom-0 w-px bg-slate-300"></div><div className="absolute -left-4 top-1/2 w-4 h-px bg-slate-300"></div></>}
                  {isOnly && <div className="absolute -left-8 top-1/2 w-8 h-px bg-slate-300"></div>}
                  {child}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// --- 图标助手 ---
const getFileIcon = (fileType: string, className?: string) => {
  const type = (fileType || '').toLowerCase();
  if (type.includes('pdf')) return <FileText className={`text-red-500 ${className}`} />;
  if (type.includes('ppt')) return <Presentation className={`text-orange-500 ${className}`} />;
  if (type.includes('code') || type.includes('py') || type.includes('js') || type.includes('ts')) return <FileCode className={`text-blue-500 ${className}`} />;
  if (type.includes('excel') || type.includes('sheet') || type.includes('csv')) return <FileSpreadsheet className={`text-emerald-600 ${className}`} />;
  if (type.includes('image')) return <FileText className={`text-purple-500 ${className}`} />;
  return <File className={`text-slate-400 ${className}`} />;
};

// --- 通用编辑模态框 (替代 Prompt) ---
const EditModal = ({
  isOpen,
  onClose,
  onSave,
  title,
  initialValue,
  placeholder
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
  title: string;
  initialValue: string;
  placeholder?: string;
}) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      // 延迟聚焦，确保动画完成
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[150] animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 transform scale-100 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-slate-800 mb-4">{title}</h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onSave(value);
            if (e.key === 'Escape') onClose();
          }}
          placeholder={placeholder}
          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-slate-800 font-medium transition-all mb-6"
        />
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-500 font-medium hover:bg-slate-100 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onSave(value)}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-md shadow-blue-200 transition-all"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 设置模态框组件 ---
const SettingsModal = ({
  isOpen,
  onClose,
  apiKey,
  setApiKey,
  deepSeekApiKey,
  setDeepSeekApiKey,
  provider,
  setProvider,
  geminiModel,
  setGeminiModel,
  deepSeekModel,
  setDeepSeekModel,
  onExport,
  onImport,
  onClear,
  handleOpenFolder,
  rootPath,
  setShowTaxonomySettings
}: any) => {
  if (!isOpen) return null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) onImport(e.target.files[0]);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Settings size={20} className="text-slate-500" /> 设置与数据
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* API Configuration */}
          <div className="space-y-4">
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <KeyRound size={16} /> 模型设置
            </label>

            {/* Provider Selection */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setProvider('gemini')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${provider === 'gemini' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Google Gemini
              </button>
              <button
                onClick={() => setProvider('deepseek')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${provider === 'deepseek' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                DeepSeek
              </button>
            </div>

            {/* Gemini Key & Model Input */}
            {provider === 'gemini' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Gemini API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="请输入 Gemini API Key"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                  <p className="text-xs text-slate-400">
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-blue-500 hover:underline">获取 Gemini Key</a>
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">选择模型版本</label>
                  <select
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash Exp (最新预览版 - 推荐)</option>
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash (快速、低延迟)</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (最强大、分析深)</option>
                    <option value="gemini-1.5-flash-8b">Gemini 1.5 Flash-8B (极速版本)</option>
                  </select>
                </div>
              </div>
            )}

            {/* DeepSeek Key & Model Input */}
            {provider === 'deepseek' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">DeepSeek API Key</label>
                  <input
                    type="password"
                    value={deepSeekApiKey}
                    onChange={(e) => setDeepSeekApiKey(e.target.value)}
                    placeholder="请输入 DeepSeek API Key"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                  <p className="text-xs text-slate-400">
                    <a href="https://platform.deepseek.com/api_keys" target="_blank" className="text-blue-500 hover:underline">获取 DeepSeek Key</a>
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">选择模型版本</label>
                  <select
                    value={deepSeekModel}
                    onChange={(e) => setDeepSeekModel(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option value="deepseek-chat">DeepSeek-V3 (Chat - 速度快)</option>
                    <option value="deepseek-reasoner">DeepSeek-R1 (Reasoner - 逻辑强)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100 my-2"></div>

          {/* Electron 文件夹选择 */}
          {storage.isElectron && (
            <>
              <div className="space-y-3">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <FolderOpen size={16} /> 存储文件夹
                </label>
                <button
                  onClick={() => {
                    handleOpenFolder();
                    onClose();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-sm font-medium transition-all border border-blue-200"
                >
                  <FolderOpen size={16} /> {rootPath ? '更换文件夹' : '选择存储文件夹'}
                </button>
                {rootPath && (
                  <p className="text-xs text-slate-500 break-all">
                    当前: {rootPath}
                  </p>
                )}
                <p className="text-xs text-slate-400">
                  所有上传的文件和知识库数据都会保存在此文件夹中
                </p>
              </div>
              <div className="h-px bg-slate-100 my-2"></div>
            </>
          )}

          {/* 分类控制中心 */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <FolderTree size={16} /> 分类控制中心
            </label>
            <button
              onClick={() => {
                onClose();
                setShowTaxonomySettings(true);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-sm font-medium transition-all border border-indigo-100"
            >
              <Settings size={16} /> 配置分类模式与规则
            </button>
            <p className="text-xs text-slate-400">
              严格/灵活模式切换、分类深度限制、忽略规则管理
            </p>
          </div>

          {/* 数据管理 */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Database size={16} /> 数据管理
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={onExport} className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 rounded-xl text-sm font-medium transition-all">
                <Download size={16} /> 备份元数据
              </button>
              <button onClick={handleImportClick} className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 rounded-xl text-sm font-medium transition-all">
                <Upload size={16} /> 恢复数据
              </button>
              <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileChange} />
            </div>
            <p className="text-xs text-slate-400 mt-1">* 备份功能仅导出知识库的元数据(索引、标签等)，不包含原始文件内容。</p>
            <button onClick={onClear} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-sm font-medium transition-all border border-red-100 mt-2">
              <Trash2 size={16} /> 清空所有知识库
            </button>
          </div>
        </div>

        <div className="p-4 bg-slate-50 text-right">
          <button onClick={onClose} className="px-6 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 font-medium text-sm shadow-lg shadow-slate-200 transition-all">
            完成
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 主组件 ---

const App = () => {
  // --- Staging Store (v3.0) ---
  const { workflowStatus, setWorkflowStatus, addFiles, files: stagingFiles } = useStagingStore();

  // 核心状态
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [fileTree, setFileTree] = useState<FileNode | null>(null); // New State for File Tree
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'mindmap'>('mindmap');
  const [isDragging, setIsDragging] = useState(false); // Global Drag State

  // 编辑交互状态 (取代 Prompt)
  const [editState, setEditState] = useState<{
    isOpen: boolean;
    type: 'single-category' | 'bulk-category' | 'edit-tag' | 'add-tag';
    itemId?: string; // 用于单条目修改
    targetValue?: string; // 用于批量修改的目标值(如旧分类名)或旧标签名
    initialValue: string; // 输入框初始值
    title: string;
  }>({
    isOpen: false,
    type: 'single-category',
    initialValue: '',
    title: ''
  });

  // 设置相关状态
  const [showSettings, setShowSettings] = useState(false);
  const [showTaxonomySettings, setShowTaxonomySettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [deepSeekApiKey, setDeepSeekApiKey] = useState(() => localStorage.getItem("deepseek_api_key") || "");
  const [provider, setProvider] = useState<'gemini' | 'deepseek'>(() => (localStorage.getItem("ai_provider") as any) || 'gemini');
  const [geminiModel, setGeminiModel] = useState(() => localStorage.getItem("gemini_model") || "gemini-2.0-flash-exp");
  const [deepSeekModel, setDeepSeekModel] = useState(() => localStorage.getItem("deepseek_model") || "deepseek-chat");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Electron Specific State
  const [rootPath, setRootPath] = useState<string>("");

  // Onboarding State
  const [isOnboarding, setIsOnboarding] = useState(() => localStorage.getItem("onboarding_complete") !== "true");

  // Auto-Organize State
  const [organizeState, setOrganizeState] = useState<{
    isOrganizing: boolean;
    previewMode: boolean; // Show results before moving
    pendingResults: { file: FileNode; analysis: Partial<KnowledgeItem> }[];
    progress: { current: number; total: number };
  }>({
    isOrganizing: false,
    previewMode: true,
    pendingResults: [],
    progress: { current: 0, total: 0 }
  });

  // --- 脑图交互逻辑 State ---
  const canvasRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // 初始化：加载数据
  useEffect(() => {
    const initData = async () => {
      const initialRootPath = localStorage.getItem("electron_root_path") || "";
      if (initialRootPath && storage.setRootPath) {
        storage.setRootPath(initialRootPath);
        setRootPath(initialRootPath);

        // 🧹 清理超过2小时的临时文件
        if (storage.cleanupTempFiles) {
          try {
            const deletedCount = await storage.cleanupTempFiles(2);
            if (deletedCount > 0) {
              console.log(`🧹 [Init] Cleaned up ${deletedCount} old temp files`);
            }
          } catch (e) {
            console.warn('Failed to cleanup temp files:', e);
          }
        }

        // Scan directory if in Electron
        if (storage.scanDirectory) {
          const tree = await storage.scanDirectory();
          setFileTree(tree);
        }
      }

      const loadedItems = await storage.loadAllItems();
      setItems(loadedItems);
    };
    initData();
  }, []); // Run only once

  // 🔧 监听知识库刷新事件（从 ReviewDashboard 返回时触发）
  useEffect(() => {
    const handleRefresh = async () => {
      console.log('🔄 [Main] Refreshing knowledge base...');
      const loadedItems = await storage.loadAllItems();
      setItems(loadedItems);
      if (storage.scanDirectory) {
        const tree = await storage.scanDirectory();
        setFileTree(tree);
      }
    };

    window.addEventListener('refresh-knowledge-base', handleRefresh);
    return () => window.removeEventListener('refresh-knowledge-base', handleRefresh);
  }, []);

  // 持久化：当 items 变化时保存
  // 🔧 修复：使用智能合并策略，避免覆盖 v3.0 格式中的 AI 分析结果
  useEffect(() => {
    const saveItems = async () => {
      if (items.length === 0 && !rootPath) return;

      if (storage.isElectron && storage.loadRawMetadata) {
        // Electron 环境：检查是否存在 v3.0 格式
        const rawMetadata = await storage.loadRawMetadata();

        if (rawMetadata && rawMetadata.version === '3.0' && rawMetadata.files) {
          // v3.0 格式已存在，使用合并策略
          console.log('📂 [Main] v3.0 metadata exists, using merge strategy');

          // 注意：这里不覆盖，因为 fileOps.persistMetadata 会负责更新 v3.0 格式
          // 主界面的 items 变化主要来自拖拽分类等操作
          // 这些操作应该通过专门的更新逻辑处理，而不是直接覆盖

          // 仅在没有 v3.0 files 时才保存（初始状态）
          if (Object.keys(rawMetadata.files).length === 0 && items.length > 0) {
            console.log('📂 [Main] v3.0 empty, saving items as fallback');
            await storage.saveAllItems(items);
          }
          // 否则跳过保存，让 fileOps 管理数据
          return;
        }
      }

      // Web 环境或无 v3.0 数据：使用原有逻辑
      console.log('📂 [Main] Saving items directly:', items.length);
      await storage.saveAllItems(items);
    };

    saveItems();
  }, [items, rootPath]);
  useEffect(() => { localStorage.setItem("ai_provider", provider); }, [provider]);
  useEffect(() => { localStorage.setItem("gemini_api_key", apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem("deepseek_api_key", deepSeekApiKey); }, [deepSeekApiKey]);
  useEffect(() => { localStorage.setItem("gemini_model", geminiModel); }, [geminiModel]);
  useEffect(() => { localStorage.setItem("deepseek_model", deepSeekModel); }, [deepSeekModel]);

  // Electron Mode: Open Folder
  const handleOpenFolder = async () => {
    if (storage.openDirectory) {
      const path = await storage.openDirectory();
      if (path) {
        setRootPath(path);
        const loadedItems = await storage.loadAllItems();
        setItems(loadedItems);
        // Scan new directory
        if (storage.scanDirectory) {
          const tree = await storage.scanDirectory();
          setFileTree(tree);
        }
      }
    }
  };

  // --- 智能整理逻辑 ---

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // 递归分析文件树
  const analyzeFileRecursive = async (
    node: FileNode,
    results: { file: FileNode; analysis: Partial<KnowledgeItem> }[],
    existingCategories: string[]
  ) => {
    if (node.type === 'file') {
      try {
        console.log(`[Batch] Analyzing File: ${node.path}`);

        // 1. 读取内容 (确保 readTextFile 存在)
        if (!storage.readTextFile) throw new Error("Storage layer does not support reading text files.");
        const { content, isText } = await storage.readTextFile!(node.path);

        // 2. 调用 AI 分析
        const currentKey = provider === 'gemini' ? apiKey : deepSeekApiKey;
        if (!currentKey) throw new Error("API_KEY_MISSING");

        let analysis: Partial<KnowledgeItem>;
        const mockFile = {
          name: node.name,
          type: isText ? 'text/plain' : 'application/octet-stream'
        } as File;

        // --- 频率节流 (Throttling) ---
        // 针对 Gemini 免费版，每分钟限制 10 次，建议间隔至少 6 秒
        if (provider === 'gemini') {
          await sleep(6500);
        }

        if (provider === 'deepseek') {
          analysis = await analyzeContentWithDeepSeek(mockFile, currentKey, deepSeekModel, content, node.path, existingCategories);
        } else {
          analysis = await analyzeContentWithGemini(mockFile, currentKey, geminiModel, content, node.path, existingCategories);
        }

        console.log(`[Batch] Success for ${node.name}:`, analysis.category);
        results.push({ file: node, analysis });
      } catch (err: any) {
        console.error(`[Batch] Failed for ${node.path}:`, err);
        results.push({
          file: node,
          analysis: {
            category: "未分类",
            summary: "分析失败",
            tags: [`错误: ${err.message || "未知错误"}`]
          }
        });
      } finally {
        // 无论成功失败，都更新进度条
        setOrganizeState(prev => ({
          ...prev,
          progress: { ...prev.progress, current: Math.min(prev.progress.total, prev.progress.current + 1) }
        }));
      }
    } else if (node.children) {
      for (const child of node.children) {
        await analyzeFileRecursive(child, results, existingCategories);
      }
    }
  };

  // 开始全量智能整理
  const handleStartAutoOrganize = async () => {
    console.log('🔍 handleStartAutoOrganize called', { fileTree: !!fileTree, isElectron: storage.isElectron });

    if (!storage.isElectron) {
      alert('此功能仅在桌面版可用');
      return;
    }

    if (!fileTree) {
      alert('请先选择一个文件夹');
      return;
    }

    // 🔧 P1 修复：收集所有文件并接入 stagingStore + batchProcessor
    const collectFiles = (node: FileNode): { name: string; path: string }[] => {
      if (node.type === 'file') {
        return [{ name: node.name, path: node.path }];
      }
      return (node.children || []).flatMap(child => collectFiles(child));
    };

    const fileInfos = collectFiles(fileTree);
    console.log('📁 收集到文件数:', fileInfos.length);

    if (fileInfos.length === 0) {
      alert('未找到可处理的文件');
      return;
    }

    // 🔧 新增：让用户选择分析模式（两步提示）
    const continueAnalysis = confirm(`发现 ${fileInfos.length} 个文件，是否开始智能整理？`);
    if (!continueAnalysis) {
      return; // 用户取消
    }

    // 第二步：选择分析模式
    const analyzeAll = confirm(
      `请选择分析模式：\n\n` +
      `【确定】→ 全部文件重新分析\n` +
      `【取消】→ 仅分析未分析的文件（跳过已有 AI 结果的）\n\n` +
      `提示：如果只是新增了文件，选择"取消"可节省时间和 API 调用`
    );

    console.log('📋 [AutoOrganize] User chose:', analyzeAll ? '全部重新分析' : '仅分析未分析文件');

    // 加载已保存的元数据，检查哪些文件已分析
    const savedMetadata = await storage.loadAllItems();
    const analyzedFiles = new Set<string>();

    console.log('📊 [AutoOrganize] Metadata loaded:', {
      isArray: Array.isArray(savedMetadata),
      length: Array.isArray(savedMetadata) ? savedMetadata.length : 0,
      type: typeof savedMetadata
    });

    if (!analyzeAll) {
      // loadAllItems() 返回的是数组格式
      if (Array.isArray(savedMetadata)) {
        console.log('📊 [AutoOrganize] 元数据数组，共', savedMetadata.length, '条');

        // 打印第一条数据结构作为参考
        if (savedMetadata.length > 0) {
          console.log('📊 [AutoOrganize] 第一条数据示例:', JSON.stringify(savedMetadata[0], null, 2));
        }

        savedMetadata.forEach((item: any) => {
          // 获取摘要 - 检查所有可能的字段
          const summary = item.summary || item.摘要 || item.AI建议?.summary || item.ai?.summary || '';
          const fileName = item.fileName || item.name || item.originalName || '';

          console.log('📊 [AutoOrganize] 检查文件:', fileName, '摘要字段:', {
            summary: item.summary?.substring(0, 50),
            摘要: item.摘要?.substring(0, 50),
            'AI建议.summary': item.AI建议?.summary?.substring(0, 50),
            'ai.summary': item.ai?.summary?.substring(0, 50)
          });

          // 🔧 排除占位摘要，只有真正的 AI 分析才算已分析
          const placeholderTexts = ['📌 新发现文件', '新发现文件', '待分析', '待 AI 分析', '文件路径：'];
          const isPlaceholder = !summary || placeholderTexts.some(p => summary.includes(p));

          if (!isPlaceholder && summary.length > 0) {
            analyzedFiles.add(fileName);
            console.log('✅ [AutoOrganize] 已分析:', fileName);
          } else {
            console.log('⏳ [AutoOrganize] 待分析:', fileName, '原因:', !summary ? '无摘要' : '占位摘要');
          }
        });
      } else if (savedMetadata && typeof savedMetadata === 'object' && 'files' in savedMetadata) {
        // v3.0 原始格式（备用）
        Object.entries((savedMetadata as any).files).forEach(([key, file]: [string, any]) => {
          const hasAIAnalysis =
            file.AI建议?.summary ||
            file.summary ||
            file.ai?.summary ||
            (file.tags && file.tags.length > 0);

          if (hasAIAnalysis) {
            const fileName = file.fileName || file.originalName || file.name;
            if (fileName) {
              analyzedFiles.add(fileName);
              console.log('✅ [AutoOrganize] Found analyzed file:', fileName);
            }
          }
        });
      }
      console.log('📋 已分析文件数:', analyzedFiles.size);
      console.log('📋 已分析文件列表:', Array.from(analyzedFiles));
    }

    // 根据用户选择过滤文件
    const filesToProcess = analyzeAll
      ? fileInfos  // 全部分析
      : fileInfos.filter(info => {
        const isAnalyzed = analyzedFiles.has(info.name);
        if (isAnalyzed) {
          console.log('⏭️ [AutoOrganize] Skipping analyzed file:', info.name);
        }
        return !isAnalyzed;
      }); // 仅分析未分析的

    console.log('📁 待处理文件数:', filesToProcess.length);
    console.log('📁 待处理文件:', filesToProcess.map(f => f.name));

    if (filesToProcess.length === 0) {
      alert('所有文件都已分析完成！');
      return;
    }

    if (!analyzeAll && filesToProcess.length < fileInfos.length) {
      const skippedCount = fileInfos.length - filesToProcess.length;
      console.log(`⏭️ 跳过 ${skippedCount} 个已分析文件`);
    }

    // 创建类似 File 的对象（Electron 环境下 File 构造函数不可用）
    const files = filesToProcess.map(info => {
      console.log('📁 [AutoOrganize] Creating mock file:', { name: info.name, path: info.path });

      // 创建一个 mock File 对象，包含必要的属性
      // 🔧 修复：确保 path 属性可被访问（不会被类型转换隐藏）
      const mockFile = {
        name: info.name,
        path: info.path,  // 完整的源文件路径
        size: 0,
        type: '',
        lastModified: Date.now(),
        // File 接口需要的方法（这里只是占位，实际处理文件时会通过 path 读取）
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => '',
        stream: () => new ReadableStream(),
        slice: () => new Blob()
      };

      // 验证 path 属性
      console.log('📁 [AutoOrganize] Mock file created:', {
        name: mockFile.name,
        path: mockFile.path,
        hasPath: !!mockFile.path
      });

      return mockFile as unknown as File;
    });

    // 添加到 stagingStore
    addFiles(files);

    if (workflowStatus === 'idle') {
      setWorkflowStatus('reviewing');
    }

    // 触发批处理
    setTimeout(() => {
      import('./services/batchProcessor').then(({ batchProcessor }) => {
        const currentStore = useStagingStore.getState();
        const pendingIds = currentStore.files
          .filter(f => f.status === 'pending' && !f.contentHash)
          .map(f => f.id);
        batchProcessor.processFiles(pendingIds);
      });
    }, 100);
  };

  // 旧的 executeOrganize 已由 ReviewDashboard 的 executeCommit 替代

  // 操作：下载文件
  const handleDownload = async (item: KnowledgeItem) => {
    try {
      if (storage.isElectron && storage.showItemInFolder) {
        // 在 Electron 中，item.id 通常存储了文件路径（或者我们应该优先使用 filePath）
        const path = item.filePath || item.id;
        await storage.showItemInFolder(path);
        return;
      }

      const fileBlob = await storage.getFile(item.id);
      if (fileBlob) {
        const url = URL.createObjectURL(fileBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert("无法下载：未找到源文件（可能是演示数据或已被删除）。");
      }
    } catch (e) {
      console.error(e);
      alert("下载/定位过程中发生错误");
    }
  };

  // 操作：触发修改分类 (单个) - 改为调用 Modal
  const handleEditCategory = (id: string, currentCategory: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditState({
      isOpen: true,
      type: 'single-category',
      itemId: id,
      initialValue: currentCategory,
      title: '修改分类名称'
    });
  };

  // 操作：触发批量重命名分类 (脑图模式) - 改为调用 Modal
  const handleRenameCategory = (oldCategory: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditState({
      isOpen: true,
      type: 'bulk-category',
      targetValue: oldCategory,
      initialValue: oldCategory,
      title: `批量重命名分类: ${oldCategory}`
    });
  };

  // 操作：触发修改标签 (单个) - 改为调用 Modal
  const handleEditTag = (id: string, oldTag: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditState({
      isOpen: true,
      type: 'edit-tag',
      itemId: id,
      targetValue: oldTag,
      initialValue: oldTag,
      title: '编辑标签 (清空则删除)'
    });
  };

  // 操作：触发添加标签 - 改为调用 Modal
  const handleAddTag = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditState({
      isOpen: true,
      type: 'add-tag',
      itemId: id,
      initialValue: '',
      title: '添加新标签'
    });
  }

  // 统一的保存处理逻辑
  const handleSaveEdit = (newValue: string) => {
    const val = newValue ? newValue.trim() : "";

    switch (editState.type) {
      case 'single-category':
        if (editState.itemId && val) {
          setItems(prev => prev.map(item =>
            item.id === editState.itemId ? { ...item, category: val } : item
          ));
        }
        break;

      case 'bulk-category':
        if (editState.targetValue && val && val !== editState.targetValue) {
          setItems(prev => prev.map(item =>
            item.category === editState.targetValue ? { ...item, category: val } : item
          ));
        }
        break;

      case 'edit-tag':
        if (editState.itemId && editState.targetValue) {
          if (val === "") {
            // 删除标签
            setItems(prev => prev.map(item =>
              item.id === editState.itemId ? { ...item, tags: item.tags.filter(t => t !== editState.targetValue) } : item
            ));
          } else {
            // 修改标签
            setItems(prev => prev.map(item =>
              item.id === editState.itemId ? { ...item, tags: item.tags.map(t => t === editState.targetValue ? val : t) } : item
            ));
          }
        }
        break;

      case 'add-tag':
        if (editState.itemId && val) {
          setItems(prev => prev.map(item =>
            item.id === editState.itemId && !item.tags.includes(val)
              ? { ...item, tags: [...item.tags, val] }
              : item
          ));
        }
        break;
    }
    setEditState(prev => ({ ...prev, isOpen: false }));
  };

  // 操作：拖拽文件改变分类
  const handleFileDragStart = (e: React.DragEvent, fileId: string) => {
    e.dataTransfer.setData('fileId', fileId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFileDropOnCategory = async (e: React.DragEvent, newCategoryOrPath: string) => {
    const fileIdOrPath = e.dataTransfer.getData('fileId');
    if (!fileIdOrPath || !newCategoryOrPath) return;

    // Electron Mode: Move File
    if (storage.isElectron && storage.moveFile && fileTree) {
      try {
        // 修复：使用正则匹配两种路径分隔符，确保在 Windows 下也能正确提取文件名
        const fileName = fileIdOrPath.split(/[/\\]/).pop();
        if (!fileName) return;
        const newPath = `${newCategoryOrPath}/${fileName}`;

        await storage.moveFile(fileIdOrPath, newPath);

        // Refresh Tree
        if (storage.scanDirectory) {
          const tree = await storage.scanDirectory();
          setFileTree(tree);
        }

        // Update items (optional, but good for sync)
        const loadedItems = await storage.loadAllItems();
        setItems(loadedItems);

      } catch (error: any) {
        alert(`Move failed: ${error.message}`);
      }
    } else {
      // Web Mode: Update Category
      setItems(prev => prev.map(item =>
        item.id === fileIdOrPath ? { ...item, category: newCategoryOrPath } : item
      ));
    }
  };

  // 操作：删除单个条目
  const handleDeleteItem = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (confirm("确定要删除这条知识索引吗？原始文件也将被移除。")) {
      setItems(prev => prev.filter(item => item.id !== id));
      await storage.deleteFile(id);
    }
  };

  // 操作：导出数据
  const handleExport = () => {
    const dataStr = JSON.stringify(items, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `knowledge_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 操作：导入数据
  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedItems = JSON.parse(e.target?.result as string);
        if (Array.isArray(importedItems)) {
          if (confirm(`确定要导入 ${importedItems.length} 条数据吗？当前数据将被合并。\n注意：导入的数据不包含原始文件内容。`)) {
            // 合并策略：保留旧数据，添加新数据 (根据ID去重)
            setItems(prev => {
              const existingIds = new Set(prev.map(i => i.id));
              const newItems = importedItems.filter((i: any) => !existingIds.has(i.id));
              return [...newItems, ...prev];
            });
            alert("导入成功！");
            setShowSettings(false);
          }
        } else {
          alert("文件格式错误：必须是 JSON 数组");
        }
      } catch (err) {
        alert("文件解析失败，请确保是有效的 JSON 备份文件");
      }
    };
    reader.readAsText(file);
  };

  // 操作：清空数据
  const handleClearAll = async () => {
    if (confirm("警告：此操作将永久清空所有本地知识库数据及已保存的文件！是否继续？")) {
      setItems([]);
      // 对于 Electron，可能需要清空 JSON 文件内容，而不是删除所有文件（或者删除所有文件）
      // 简单起见，我们保存空数组
      storage.saveAllItems([]);
      setShowSettings(false);
    }
  };

  // 模拟数据加载
  // 演示数据功能已移除

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);

    const currentKey = provider === 'gemini' ? apiKey : deepSeekApiKey;

    if (!currentKey) {
      setShowSettings(true);
      setErrorMessage(`请先配置 ${provider === 'gemini' ? 'Gemini' : 'DeepSeek'} API Key 才能开始分析文件。`);
      return;
    }

    if (e.target.files && e.target.files.length > 0) {
      const uploadedFiles: File[] = Array.from(e.target.files);

      // 🔧 修复：先将文件保存到磁盘，获取完整路径
      const filesWithPath: File[] = [];

      for (const file of uploadedFiles) {
        try {
          if (storage.isElectron && storage.saveFile) {
            // Electron 环境：保存文件到磁盘
            const savedPath = await storage.saveFile(file);
            console.log('📁 [Upload] File saved to:', savedPath);

            // 创建带有 path 属性的 mock File 对象
            const mockFile = {
              name: file.name,
              path: savedPath,  // 使用保存后的完整路径
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              arrayBuffer: () => file.arrayBuffer(),
              text: () => file.text(),
              stream: () => file.stream(),
              slice: (start?: number, end?: number) => file.slice(start, end)
            } as unknown as File;

            filesWithPath.push(mockFile);
          } else {
            // Web 环境：使用原始 File 对象
            filesWithPath.push(file);
          }
        } catch (err) {
          console.error('📁 [Upload] Failed to save file:', file.name, err);
          setErrorMessage(`文件 ${file.name} 保存失败`);
        }
      }

      if (filesWithPath.length > 0) {
        addFiles(filesWithPath);

        if (workflowStatus === 'idle') {
          setWorkflowStatus('reviewing');
        }

        // 延迟触发批处理
        setTimeout(() => {
          import('./services/batchProcessor').then(({ batchProcessor }) => {
            const currentStore = useStagingStore.getState();
            const pendingIds = currentStore.files
              .filter(f => f.status === 'pending' && !f.contentHash)
              .map(f => f.id);
            batchProcessor.processFiles(pendingIds);
          });
        }, 100);
      }

      e.target.value = '';
    }
  };

  // 🔧 修复问题 10：实现搜索权重排序（符合 PRD 3.1.1）
  // 权重：文件名匹配 (1.0) > 标签匹配 (0.8) > 摘要匹配 (0.6)
  const filteredItems = items
    .map(item => {
      const fileName = (item.fileName || item.name || '').toLowerCase();
      const summary = (item.summary || '').toLowerCase();
      const tags = item.tags || [];
      const query = searchQuery.toLowerCase();

      if (!query) return { item, score: 0, matched: true };

      let score = 0;
      let matched = false;

      // 文件名匹配权重 1.0
      if (fileName.includes(query)) {
        score += 1.0;
        matched = true;
      }
      // 标签匹配权重 0.8
      if (tags.some((tag: string) => (tag || '').toLowerCase().includes(query))) {
        score += 0.8;
        matched = true;
      }
      // 摘要匹配权重 0.6
      if (summary.includes(query)) {
        score += 0.6;
        matched = true;
      }

      return { item, score, matched };
    })
    .filter(({ matched }) => matched || !searchQuery)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);

  // --- 全局拖拽处理 ---
  // 🔧 修复问题 7：添加磁盘保存步骤
  const handleGlobalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const uploadedFiles = Array.from(e.dataTransfer.files);

      // 🔧 与 handleFileUpload 保持一致：先保存到磁盘
      const filesWithPath: File[] = [];

      for (const file of uploadedFiles) {
        try {
          if (storage.isElectron && storage.saveFile) {
            // Electron 环境：保存文件到磁盘
            const savedPath = await storage.saveFile(file);
            console.log('📁 [GlobalDrop] File saved to:', savedPath);

            // 创建带有 path 属性的 mock File 对象
            const mockFile = {
              name: file.name,
              path: savedPath,  // 使用保存后的完整路径
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              arrayBuffer: () => file.arrayBuffer(),
              text: () => file.text(),
              stream: () => file.stream(),
              slice: (start?: number, end?: number) => file.slice(start, end)
            } as unknown as File;

            filesWithPath.push(mockFile);
          } else {
            // Web 环境：使用原始 File 对象
            filesWithPath.push(file);
          }
        } catch (err) {
          console.error('📁 [GlobalDrop] Failed to save file:', file.name, err);
        }
      }

      if (filesWithPath.length > 0) {
        addFiles(filesWithPath);

        if (workflowStatus === 'idle') {
          setWorkflowStatus('reviewing');
        }

        setTimeout(() => {
          import('./services/batchProcessor').then(({ batchProcessor }) => {
            const currentStore = useStagingStore.getState();
            const pendingIds = currentStore.files
              .filter(f => f.status === 'pending' && !f.contentHash)
              .map(f => f.id);
            batchProcessor.processFiles(pendingIds);
          });
        }, 100);
      }
    }
  };

  // --- 画布事件处理 ---
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // 只有点击背景（或非交互元素）时才允许拖拽
    if ((e.target as HTMLElement).closest('.cursor-pointer') || (e.target as HTMLElement).closest('button')) return;

    setIsDraggingCanvas(true);
    dragStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingCanvas || !dragStartRef.current) return;

    // Capture values synchronously to avoid ref.current becoming null if update is deferred
    const dragStart = dragStartRef.current;

    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    }));
  };

  const handleCanvasMouseUp = () => {
    setIsDraggingCanvas(false);
    dragStartRef.current = null;
  };

  // --- 触摸事件处理 (Mobile Support) ---
  const handleCanvasTouchStart = (e: React.TouchEvent) => {
    // 只有点击背景（或非交互元素）时才允许拖拽
    if ((e.target as HTMLElement).closest('.cursor-pointer') || (e.target as HTMLElement).closest('button')) return;

    if (e.touches.length === 1) {
      setIsDraggingCanvas(true);
      dragStartRef.current = { x: e.touches[0].clientX - transform.x, y: e.touches[0].clientY - transform.y };
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingCanvas || !dragStartRef.current || e.touches.length !== 1) return;
    // 阻止默认滚动行为，提升拖拽体验
    // 注意：这可能需要设置 touch-action: none 在 CSS 中

    // Capture values synchronously
    const dragStart = dragStartRef.current;
    const touch = e.touches[0];

    setTransform(prev => ({
      ...prev,
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y
    }));
  };

  const handleCanvasTouchEnd = () => {
    setIsDraggingCanvas(false);
    dragStartRef.current = null;
  };

  // 使用 ref 手动绑定 wheel 事件以禁用 passive 模式，解决 preventDefault 报错问题


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomSensitivity = 0.001;
        const newScale = Math.min(Math.max(0.5, transform.scale - e.deltaY * zoomSensitivity), 3);
        setTransform(prev => ({ ...prev, scale: newScale }));
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [transform.scale]);

  const handleZoomIn = () => setTransform(prev => ({ ...prev, scale: Math.min(prev.scale + 0.2, 3) }));
  const handleZoomOut = () => setTransform(prev => ({ ...prev, scale: Math.max(prev.scale - 0.2, 0.5) }));
  const handleResetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  // 渲染脑图逻辑
  const renderMindMap = () => {
    // 1. Electron File Tree Mode
    if (fileTree && storage.isElectron) {
      const renderNode = (node: FileNode) => {
        // Matching metadata
        const item = items.find(i => i.fileName === node.name || i.filePath === node.path);
        // Or if not found, just show name

        if (node.type === 'directory') {
          return (
            <TreeNode
              key={node.path}
              type={node.path === rootPath ? 'root' : 'category'}
              dataId={node.path}
              onDropOnCategory={handleFileDropOnCategory}
              label={
                <div className="flex items-center gap-2 group/cat cursor-pointer hover:text-blue-600 transition-colors">
                  {node.path === rootPath ? <BrainCircuit size={20} /> : <FolderOpen size={16} />}
                  <span>{node.name}</span>
                </div>
              }
              childrenNodes={node.children ? node.children.map(child => renderNode(child)) : []}
              defaultCollapsed={false}
            />
          );
        } else {
          // File Node
          return (
            <TreeNode
              key={node.path}
              type="file"
              dataId={node.path}
              onDragStart={handleFileDragStart}
              label={
                <div className="flex flex-col gap-1 w-full relative group/node">
                  <div
                    className="flex items-start gap-2.5 cursor-pointer hover:bg-blue-50/50 rounded p-0.5 -m-0.5 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      const matchedItem = items.find(i => i.fileName === node.name); // Simple match
                      if (matchedItem) handleDownload(matchedItem);
                      else alert('File not found in index metadata'); // Fallback? Or open file?
                    }}
                    title="Drag to move / Click to download"
                  >
                    <div className="mt-0.5 shrink-0 bg-slate-50 p-1 rounded-md border border-slate-100">
                      {getFileIcon(node.name, "w-4 h-4")}
                    </div>
                    <span className="truncate font-medium text-slate-700 leading-tight group-hover/node:text-blue-600 transition-colors">{node.name}</span>
                  </div>
                </div>
              }
              childrenNodes={item?.tags ? Array.from(new Set(item.tags.filter(Boolean))).map((tag, idx) => (
                <TreeNode key={`elec-tag-${node.path}-${tag}-${idx}`} label={<div className="text-[10px]">#{tag}</div>} type="tag" />
              )) : []}
            />
          );
        }
      };

      return (
        <div
          ref={canvasRef}
          className="relative bg-slate-50/50 rounded-2xl border border-slate-200 shadow-inner h-[600px] overflow-hidden cursor-grab active:cursor-grabbing group select-none"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onTouchStart={handleCanvasTouchStart}
          onTouchMove={handleCanvasTouchMove}
          onTouchEnd={handleCanvasTouchEnd}
          style={{ touchAction: 'none' }}
        >
          <div className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              transform: `scale(${transform.scale}) translate(${transform.x / transform.scale}px, ${transform.y / transform.scale}px)`,
              transformOrigin: '0 0'
            }}>
          </div>
          <div className="absolute bottom-4 right-4 flex flex-col gap-2 bg-white p-1.5 rounded-xl shadow-lg border border-slate-100 z-50">
            <button onClick={handleZoomIn} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors" title="Zoom In"><ZoomIn size={18} /></button>
            <button onClick={handleResetView} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors" title="Reset"><RotateCcw size={18} /></button>
            <button onClick={handleZoomOut} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors" title="Zoom Out"><ZoomOut size={18} /></button>
          </div>
          <div
            className="absolute left-10 top-1/2 transition-transform duration-75 ease-out origin-top-left"
            style={{ transform: `translate(${transform.x}px, ${transform.y - 200}px) scale(${transform.scale})` }}
          >
            {renderNode(fileTree)}
          </div>
        </div>
      );
    }

    // 2. Fallback: Existing Flat Category Mode (Web)
    if (items.length === 0) return null;
    const categories = Array.from(new Set(filteredItems.map(i => i.category)));

    return (
      <div
        ref={canvasRef}
        className="relative bg-slate-50/50 rounded-2xl border border-slate-200 shadow-inner h-[600px] overflow-hidden cursor-grab active:cursor-grabbing group select-none"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        onTouchStart={handleCanvasTouchStart}
        onTouchMove={handleCanvasTouchMove}
        onTouchEnd={handleCanvasTouchEnd}
        style={{ touchAction: 'none' }} // 禁用浏览器默认触摸操作
      >
        {/* 背景点阵 */}
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
            backgroundSize: '20px 20px',
            transform: `scale(${transform.scale}) translate(${transform.x / transform.scale}px, ${transform.y / transform.scale}px)`,
            transformOrigin: '0 0'
          }}>
        </div>

        {/* 悬浮控制条 */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-2 bg-white p-1.5 rounded-xl shadow-lg border border-slate-100 z-50">
          <button onClick={handleZoomIn} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors" title="放大"><ZoomIn size={18} /></button>
          <button onClick={handleResetView} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors" title="重置视图"><RotateCcw size={18} /></button>
          <button onClick={handleZoomOut} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors" title="缩小"><ZoomOut size={18} /></button>
        </div>

        {/* 脑图节点渲染容器 */}
        <div
          className="absolute left-10 top-1/2 transition-transform duration-75 ease-out origin-top-left"
          style={{ transform: `translate(${transform.x}px, ${transform.y - 200}px) scale(${transform.scale})` }} // -200 to center vertically roughly
        >
          <TreeNode
            label={<span className="flex items-center gap-2"><BrainCircuit size={20} /> 我的知识大脑</span>}
            type="root"
            childrenNodes={categories.map(cat => (
              <TreeNode
                key={cat}
                type="category"
                dataId={cat}
                onDropOnCategory={handleFileDropOnCategory}
                label={
                  <div
                    className="flex items-center gap-2 group/cat cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={(e) => handleRenameCategory(cat as string, e)}
                    title="点击批量修改此分类名称"
                  >
                    <span>{cat}</span>
                    <Edit2 size={12} className="opacity-100 md:opacity-0 group-hover/cat:opacity-100 text-slate-400 cursor-pointer hover:text-blue-500 transition-opacity" />
                  </div>
                }
                childrenNodes={filteredItems.filter(i => i.category === cat).map(file => (
                  <TreeNode
                    key={file.id}
                    type="file"
                    dataId={file.id}
                    onDragStart={handleFileDragStart}
                    label={
                      <div className="flex flex-col gap-1 w-full relative group/node">
                        <div
                          className="flex items-start gap-2.5 cursor-pointer hover:bg-blue-50/50 rounded p-0.5 -m-0.5 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation(); // 阻止冒泡，防止触发节点折叠
                            handleDownload(file);
                          }}
                          title="拖拽可移动分类 / 点击下载"
                        >
                          <div className="mt-0.5 shrink-0 bg-slate-50 p-1 rounded-md border border-slate-100">
                            {getFileIcon(file.fileType, "w-4 h-4")}
                          </div>
                          <span className="truncate font-medium text-slate-700 leading-tight group-hover/node:text-blue-600 transition-colors" title={file.fileName}>{file.fileName}</span>
                        </div>
                        {/* 脑图模式下的删除按钮 (Hover 显示) */}
                        <button
                          onClick={(e) => handleDeleteItem(file.id, e)}
                          className="absolute -right-8 top-1/2 -translate-y-1/2 p-1.5 bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 rounded-full shadow-sm opacity-100 md:opacity-0 group-hover/node:opacity-100 transition-all scale-90 hover:scale-100 z-50"
                          title="删除此节点"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    }
                    childrenNodes={Array.from(new Set(file.tags.filter(Boolean))).map((tag, idx) => (
                      <TreeNode
                        key={`tag-${file.id}-${tag}-${idx}`}
                        label={
                          <div title="点击修改或删除标签" onClick={(e) => handleEditTag(file.id, tag as string, e)}>
                            #{tag}
                          </div>
                        }
                        type="tag"
                      />
                    ))}
                  />
                ))}
              />
            ))}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        apiKey={apiKey}
        setApiKey={setApiKey}
        deepSeekApiKey={deepSeekApiKey}
        setDeepSeekApiKey={setDeepSeekApiKey}
        provider={provider}
        setProvider={setProvider}
        geminiModel={geminiModel}
        setGeminiModel={setGeminiModel}
        deepSeekModel={deepSeekModel}
        setDeepSeekModel={setDeepSeekModel}
        onExport={handleExport}
        onImport={handleImport}
        onClear={handleClearAll}
        handleOpenFolder={handleOpenFolder}
        rootPath={rootPath}
        setShowTaxonomySettings={setShowTaxonomySettings}
      />

      <EditModal
        isOpen={editState.isOpen}
        onClose={() => setEditState(prev => ({ ...prev, isOpen: false }))}
        onSave={handleSaveEdit}
        title={editState.title}
        initialValue={editState.initialValue}
        placeholder={editState.type === 'edit-tag' ? "输入新名称，留空保存即为删除" : "请输入名称"}
      />

      {/* 旧的智能整理模态框已移除，统一使用 ReviewDashboard */}

      {/* 新手引导覆盖层 */}
      {isOnboarding && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[300] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full overflow-hidden border border-white/20">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-10 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
              <BrainCircuit size={64} className="mb-6 opacity-90" />
              <h2 className="text-3xl font-bold mb-3 tracking-tight">欢迎使用 MindSync</h2>
              <p className="text-blue-100 text-lg leading-relaxed">
                只需三步，即可将杂乱的文件夹变身为清晰的知识图谱。
              </p>
            </div>
            <div className="p-10 space-y-8 bg-white">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold shrink-0">1</div>
                <div>
                  <h4 className="font-bold text-slate-800">选择本地文件夹</h4>
                  <p className="text-sm text-slate-500">点击页面底部的“选择文件夹”，连接您的本地硬盘。</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold shrink-0">2</div>
                <div>
                  <h4 className="font-bold text-slate-800">配置 AI 助手</h4>
                  <p className="text-sm text-slate-500">在设置中输入 Gemini 或 DeepSeek 的 API Key。</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold shrink-0">3</div>
                <div>
                  <h4 className="font-bold text-slate-800">一键开启智能整理</h4>
                  <p className="text-sm text-slate-500">AI 将自动读取、总结、分类并物理移动文件。</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsOnboarding(false);
                  localStorage.setItem("onboarding_complete", "true");
                }}
                className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-95"
              >
                我知道了，开始探索
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部导航 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm/50 backdrop-blur-sm bg-white/90">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-blue-200 shadow-lg ring-1 ring-blue-700/10">
              <BrainCircuit size={20} />
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight hidden md:block">MindSync</h1>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight md:hidden">MindSync</h1>
          </div>
          <div className="flex items-center gap-3">

            {/* 🔧 优化：刷新按钮 - 保留已分析数据 */}
            <button
              onClick={async () => {
                console.log('🔄 [Main] Manual refresh triggered');

                // 如果没有选择文件夹，提示先选择
                const currentRoot = localStorage.getItem('electron_root_path');
                if (!currentRoot && storage.isElectron) {
                  alert('请先选择一个文件夹');
                  if (storage.openDirectory) {
                    const path = await storage.openDirectory();
                    if (path) {
                      setRootPath(path);
                    }
                  }
                  return;
                }

                // 1. 先加载已保存的元数据（包含 AI 分析结果）
                const loadedItems = await storage.loadAllItems();
                console.log(`🔄 [Main] Loaded ${loadedItems.length} saved items from metadata`);

                if (storage.scanDirectory) {
                  const tree = await storage.scanDirectory();
                  setFileTree(tree);

                  if (tree) {
                    const root = localStorage.getItem('electron_root_path') || '';

                    // 2. 收集当前文件系统中的所有文件
                    const collectFilesFromTree = (node: FileNode): { name: string; path: string }[] => {
                      if (node.type === 'file') {
                        return [{ name: node.name, path: node.path }];
                      }
                      return (node.children || []).flatMap(child => collectFilesFromTree(child));
                    };
                    const scannedFiles = collectFilesFromTree(tree);
                    const scannedPaths = new Set(scannedFiles.map(f => f.path));
                    const scannedNames = new Set(scannedFiles.map(f => f.name));

                    // 3. 🔧 合并策略：
                    // - 已保存的文件：保留 AI 分析数据
                    // - 新文件：创建临时条目（待分析）
                    // - 已删除文件：从结果中移除
                    const mergedItems: KnowledgeItem[] = [];

                    // 3a. 保留仍然存在的已分析文件
                    for (const savedItem of loadedItems) {
                      // 🔧 修复：通过文件名找到实际路径
                      const actualFile = scannedFiles.find(f => f.name === savedItem.fileName);

                      if (actualFile) {
                        // 更新为实际路径
                        mergedItems.push({
                          ...savedItem,
                          filePath: actualFile.path
                        });
                      } else {
                        console.log(`🔄 [Main] File removed from disk: ${savedItem.fileName}`);
                      }
                    }

                    // 3b. 添加新发现的文件（未在已保存数据中）
                    const savedPaths = new Set(loadedItems.map((i: any) => i.filePath));
                    const savedNames = new Set(loadedItems.map((i: any) => i.fileName));

                    for (const scannedFile of scannedFiles) {
                      const isNew = !savedPaths.has(scannedFile.path) && !savedNames.has(scannedFile.name);

                      if (isNew) {
                        // 计算相对路径作为分类
                        // 修复：兼容 Windows 路径分隔符
                        const relativePath = scannedFile.path.replace(root, '').replace(/^[/\\]/, '');
                        const parts = relativePath.split(/[/\\]/);
                        parts.pop(); // 移除文件名
                        const category = parts.length > 0 ? parts.join('/') : '';  // 统一在 UI 层使用 / 展示

                        // 获取文件扩展名
                        const ext = scannedFile.name.split('.').pop()?.toLowerCase() || '';
                        let fileType = 'file';
                        if (['pdf'].includes(ext)) fileType = 'pdf';
                        else if (['ppt', 'pptx'].includes(ext)) fileType = 'ppt';
                        else if (['xls', 'xlsx', 'csv'].includes(ext)) fileType = 'excel';
                        else if (['py', 'js', 'ts', 'java', 'cpp'].includes(ext)) fileType = 'code';
                        else if (['jpg', 'png', 'gif', 'webp'].includes(ext)) fileType = 'image';

                        mergedItems.push({
                          id: Math.random().toString(36).substring(7),
                          fileName: scannedFile.name,
                          fileType,
                          category,
                          summary: `📌 新发现文件，等待 AI 分析`,
                          tags: ['新文件', ext.toUpperCase()],
                          filePath: scannedFile.path,
                          addedAt: new Date().toISOString().split('T')[0],
                          applicability: '待 AI 分析'
                        });
                        console.log(`🔄 [Main] New file discovered: ${scannedFile.name}`);
                      }
                    }

                    setItems(mergedItems);
                    console.log(`🔄 [Main] Merged result: ${mergedItems.length} items (${loadedItems.length} saved + new files)`);
                  }
                } else {
                  // 没有 scanDirectory 功能时直接加载已保存的 items
                  setItems(loadedItems);
                }
              }}
              className="w-9 h-9 rounded-full border bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 p-1.5 transition-all"
              title="刷新数据（同步文件系统变更）"
            >
              <RefreshCw className="w-full h-full" />
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className={`w-9 h-9 rounded-full border p-1.5 transition-all ${(!apiKey && provider === 'gemini') || (!deepSeekApiKey && provider === 'deepseek')
                ? 'bg-red-50 border-red-200 text-red-500 animate-pulse'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              title="设置 API Key"
            >
              <Settings className="w-full h-full" />
            </button>

            <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 p-0.5 cursor-pointer hover:ring-2 ring-blue-100 transition-all">
              <img src="https://api.dicebear.com/7.x/notionists/svg?seed=Alex" alt="User" className="w-full h-full rounded-full" />
            </div>
          </div>
        </div>
      </header>

      {/* 主要内容区 */}
      {workflowStatus !== 'idle' ? (
        <ReviewDashboard />
      ) : (
        <main
          className="flex-1 max-w-7xl w-full mx-auto px-4 py-8"
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onDrop={handleGlobalDrop}
        >

          {/* 全局错误提示 */}
          {errorMessage && (
            <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-2">
              <AlertCircle size={16} />
              {errorMessage}
              {!apiKey && provider === 'gemini' && <button onClick={() => setShowSettings(true)} className="underline font-semibold hover:text-red-800 ml-1">去配置</button>}
              {!deepSeekApiKey && provider === 'deepseek' && <button onClick={() => setShowSettings(true)} className="underline font-semibold hover:text-red-800 ml-1">去配置</button>}
              <button onClick={() => setErrorMessage(null)} className="ml-auto text-red-400 hover:text-red-600"><X size={16} /></button>
            </div>
          )}

          {/* 🔧 待处理文件进度面板 */}
          {workflowStatus === 'idle' && stagingFiles.length > 0 && (
            <div className="mb-6 bg-blue-50 border border-blue-200 px-4 py-3 rounded-xl flex items-center gap-3 text-sm shadow-sm">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-blue-900 font-semibold mb-1">
                  <span className="text-lg">📋</span>
                  <span>有 {stagingFiles.length} 个文件待处理</span>
                </div>
                <div className="text-blue-700 text-xs flex gap-4">
                  <span>✅ 已就绪: {stagingFiles.filter(f => f.status === 'success').length}</span>
                  <span>⏳ 分析中: {stagingFiles.filter(f => f.status === 'analyzing').length}</span>
                  <span>⚠️ 待处理: {stagingFiles.filter(f => f.status === 'pending').length}</span>
                </div>
              </div>
              <button
                onClick={() => setWorkflowStatus('reviewing')}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold transition-colors"
              >
                返回人机协作
              </button>
            </div>
          )}

          {/* 控制栏 */}
          <div className="flex flex-col md:flex-row gap-4 mb-8 items-end md:items-center justify-between">
            {/* 搜索 */}
            <div className="relative w-full md:w-96 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={18} />
              <input
                type="text"
                placeholder="搜索知识点、标签或文件名..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-12 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-300"
              />
              <button
                onClick={() => setShowAdvancedSearch(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                title="高级筛选"
              >
                <MoreHorizontal size={18} />
              </button>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              {/* 视图切换 */}
              <div className="flex p-1.5 bg-slate-200/60 rounded-xl backdrop-blur-sm">
                <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} title="卡片视图"><LayoutGrid size={18} /></button>
                <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} title="列表视图"><List size={18} /></button>
                <button onClick={() => setViewMode('mindmap')} className={`p-2 rounded-lg transition-all ${viewMode === 'mindmap' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} title="脑图模式"><Network size={18} /></button>
              </div>

              {/* 智能整理按钮 (仅 Electron) */}
              {storage.isElectron && (
                <button
                  onClick={handleStartAutoOrganize}
                  disabled={organizeState.isOrganizing || isAnalyzing}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg hover:shadow-indigo-200 transition-all cursor-pointer active:scale-95 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Wand2 size={18} className={organizeState.isOrganizing ? 'animate-pulse' : ''} />
                  <span className="font-medium">智能一键整理</span>
                </button>
              )}

              {/* 上传按钮 */}
              <label className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-lg hover:shadow-slate-300 transition-all cursor-pointer active:scale-95 hover:-translate-y-0.5 ${!apiKey ? 'opacity-80' : ''}`}>
                <UploadCloud size={18} />
                <span className="font-medium">上传</span>
                <input type="file" className="hidden" onChange={handleFileUpload} disabled={isAnalyzing} />
              </label>
            </div>
          </div>

          {/* 内容展示区 */}

          {/* 🔧 修改：当没有 items 时显示空状态 */}
          {items.length === 0 && !isAnalyzing && (
            <div className="py-8">
              {/* 空状态引导 */}
              <div className="py-16 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50 hover:bg-slate-50 transition-colors">
                <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-100">
                  <BrainCircuit className="text-blue-500" size={40} />
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-3">构建您的第二大脑</h3>
                <p className="text-slate-500 max-w-md mb-8 leading-relaxed">
                  点击刷新按钮扫描文件夹，或上传文件。<br />
                  AI 将自动提取知识点，生成可视化的知识地图。
                </p>
                {!apiKey && provider === 'gemini' && (
                  <p className="text-amber-600 bg-amber-50 px-4 py-2 rounded-lg text-sm mb-6 flex items-center gap-2">
                    <AlertCircle size={16} /> 提示：开始前请先在右上角配置 Gemini API Key
                  </p>
                )}
                {!deepSeekApiKey && provider === 'deepseek' && (
                  <p className="text-amber-600 bg-amber-50 px-4 py-2 rounded-lg text-sm mb-6 flex items-center gap-2">
                    <AlertCircle size={16} /> 提示：开始前请先在右上角配置 DeepSeek API Key
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 加载中 */}
          {isAnalyzing && (
            <div className="py-24 flex flex-col items-center justify-center">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <BrainCircuit size={24} className="text-blue-600 animate-pulse" />
                </div>
              </div>
              <p className="mt-6 text-lg font-medium text-slate-800">Gemini 正在构建神经连接...</p>
              <p className="text-slate-500">正在分析文件内容并生成知识拓扑</p>
            </div>
          )}

          {/* 1. 脑图视图 */}
          {!isAnalyzing && viewMode === 'mindmap' && items.length > 0 && renderMindMap()}

          {/* 2. 卡片视图 (Grid) */}
          {!isAnalyzing && viewMode === 'grid' && items.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredItems.map(item => (
                <div key={item.id} className="relative bg-white rounded-xl border border-slate-200 p-5 hover:shadow-lg hover:border-blue-200 hover:-translate-y-1 transition-all flex flex-col h-full group duration-300">
                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => handleDeleteItem(item.id, e)}
                    className="absolute top-3 right-3 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>

                  <div className="flex justify-between items-start mb-4 pr-6">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-sm border border-slate-50
                    ${(item.fileType || '').includes('pdf') ? 'bg-red-50 text-red-500' :
                        (item.fileType || '').includes('ppt') ? 'bg-orange-50 text-orange-500' :
                          (item.fileType || '').includes('code') ? 'bg-blue-50 text-blue-500' :
                            'bg-emerald-50 text-emerald-600'
                      }
                  `}>
                      {getFileIcon(item.fileType)}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleEditCategory(item.id, item.category, e)}
                      className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] rounded-full font-semibold uppercase tracking-wide cursor-pointer hover:bg-blue-100 hover:text-blue-600 transition-colors flex items-center gap-1 group/cat border border-transparent hover:border-blue-200 relative z-10"
                      title="点击修改分类"
                    >
                      <span className="truncate max-w-[80px]">{item.category}</span>
                      <Edit2 size={10} className="opacity-100 md:opacity-0 group-hover/cat:opacity-100" />
                    </button>
                  </div>

                  <h3
                    className="font-bold text-slate-800 mb-2 line-clamp-1 group-hover:text-blue-600 transition-colors cursor-pointer"
                    title="点击下载源文件"
                    onClick={() => handleDownload(item)}
                  >
                    {item.fileName}
                  </h3>

                  <p className="text-sm text-slate-500 mb-4 line-clamp-3 flex-1 leading-relaxed">
                    {item.summary}
                  </p>

                  <div className="space-y-3 pt-4 border-t border-slate-100 mt-auto">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                      <span className="text-xs text-slate-600 font-medium">{item.applicability}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {item.tags.map(tag => (
                        <button
                          type="button"
                          key={tag}
                          onClick={(e) => handleEditTag(item.id, tag, e)}
                          className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md border border-blue-100 font-medium hover:bg-blue-100 hover:border-blue-200 transition-colors cursor-pointer"
                          title="点击修改或删除"
                        >
                          #{tag}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={(e) => handleAddTag(item.id, e)}
                        className="text-[10px] w-5 h-5 flex items-center justify-center bg-slate-50 text-slate-400 rounded-md border border-slate-200 hover:bg-blue-50 hover:text-blue-500 hover:border-blue-200 transition-colors"
                        title="添加新标签"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 3. 列表视图 (List) - 原有视图 */}
          {!isAnalyzing && viewMode === 'list' && items.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="overflow-x-auto">
                <div className="min-w-[800px]"> {/* 确保最小宽度，防止挤压 */}
                  <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-wider">
                    <div className="col-span-5">文件名称</div>
                    <div className="col-span-2">知识分类</div>
                    <div className="col-span-3">AI 分析状态</div>
                    <div className="col-span-2">核心标签</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {filteredItems.map(item => (
                      <div key={item.id} className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50 transition-colors group relative">
                        <div
                          className="col-span-5 pr-2 flex items-center gap-3 cursor-pointer"
                          onClick={() => handleDownload(item)}
                          title="点击下载源文件"
                        >
                          <div className="p-2 bg-slate-100 rounded-lg text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                            {getFileIcon(item.fileType, "w-4 h-4")}
                          </div>
                          <div className="overflow-hidden">
                            <div className="font-semibold text-slate-800 truncate group-hover:text-blue-600 transition-colors">{item.fileName}</div>
                            <div className="text-xs text-slate-500 truncate mt-0.5">{item.summary}</div>
                          </div>
                        </div>

                        {/* Electron: Open Folder Button in Settings or Header in Future. For now, add near File Upload if Root Path is missing */}
                        {storage.isElectron && !rootPath && (
                          <div className="col-span-12 mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-center justify-between">
                            <div className="text-sm text-yellow-800">
                              <strong>请先选择知识库文件夹</strong>
                              <p>所有数据将保存到此文件夹中。</p>
                            </div>
                            <button
                              onClick={handleOpenFolder}
                              className="flex items-center gap-2 px-4 py-2 bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200 transition-colors font-medium text-sm"
                            >
                              <FolderOpen size={16} /> 选择文件夹
                            </button>
                          </div>
                        )}

                        <div className="col-span-2 group/cat flex items-center relative z-10">
                          <button
                            type="button"
                            onClick={(e) => handleEditCategory(item.id, item.category, e)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 hover:bg-blue-100 hover:text-blue-600 hover:border-blue-200 transition-all cursor-pointer"
                            title="点击修改分类"
                          >
                            <span className="truncate max-w-[100px]">{item.category}</span>
                            <Edit2 size={12} className="shrink-0 opacity-100 md:opacity-0 group-hover/cat:opacity-100 text-slate-400 group-hover/cat:text-blue-500 transition-opacity" />
                          </button>
                        </div>
                        <div className="col-span-3 text-xs font-medium flex items-center gap-1.5">
                          {(item.summary && !item.summary.includes('📌 新发现文件') && !item.summary.includes('文件路径：')) ||
                            (item.applicability && item.applicability !== '待 AI 分析' && item.applicability !== '待分析') ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              <span className="text-emerald-600">已分析</span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                              <span className="text-slate-500">待分析</span>
                            </>
                          )}
                        </div>
                        <div className="col-span-2 flex flex-wrap gap-1 items-center justify-between relative z-10">
                          <div className="flex gap-1 flex-wrap items-center">
                            {item.tags.map(tag => (
                              <button
                                type="button"
                                key={tag}
                                onClick={(e) => handleEditTag(item.id, tag, e)}
                                className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 hover:bg-blue-100 hover:border-blue-200 transition-colors"
                                title="点击修改"
                              >
                                #{tag}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={(e) => handleAddTag(item.id, e)}
                              className="text-[10px] w-5 h-5 flex items-center justify-center bg-slate-50 text-slate-400 rounded border border-slate-200 hover:bg-blue-50 hover:text-blue-500 hover:border-blue-200 transition-colors"
                              title="添加新标签"
                            >
                              <Plus size={10} />
                            </button>
                          </div>
                          <button
                            onClick={(e) => handleDeleteItem(item.id, e)}
                            className="p-1.5 text-slate-300 hover:text-red-500 rounded hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      )}

      {/* 高级搜索模态框 */}
      {showAdvancedSearch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">高级搜索</h3>
              <button
                onClick={() => setShowAdvancedSearch(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="h-[60vh]">
              <SearchPanel
                items={items}
                onResultClick={(item) => {
                  setShowAdvancedSearch(false);
                  // 可以添加跳转到该文件的逻辑
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 分类控制中心模态框 */}
      {showTaxonomySettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
            <TaxonomySettingsPanel onClose={() => setShowTaxonomySettings(false)} />
          </div>
        </div>
      )}
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
