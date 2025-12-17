import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
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
  Move
} from 'lucide-react';

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  public state: { hasError: boolean, error: Error | null };

  constructor(props: { children: React.ReactNode }) {
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
    if (this.state.hasError) {
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
                {this.state.error?.message}
              </code>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"
              >
                刷新页面
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem("knowledge_items");
                  window.location.reload();
                }}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 shadow-lg shadow-red-200 transition-colors"
              >
                清除数据并重置
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

interface KnowledgeItem {
  id: string;
  fileName: string;
  fileType: string;
  summary: string;
  category: string;
  tags: string[];
  applicability: string; // 适用场景
  addedAt: string;
}

// --- IndexedDB 文件存储系统 ---
// 使用 IndexedDB 存储大文件，避免 localStorage 容量限制
const DB_NAME = "KnowledgeBaseDB";
const STORE_NAME = "files";
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

const saveFileToDB = async (id: string, file: File) => {
  try {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(file, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to save file to DB", e);
  }
};

const getFileFromDB = async (id: string): Promise<File | undefined> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to get file from DB", e);
    return undefined;
  }
};

const deleteFileFromDB = async (id: string) => {
  try {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to delete file from DB", e);
  }
};

const clearDB = async () => {
  try {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to clear DB", e);
  }
}

// --- 文件读取助手 ---
const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
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

const analyzeContentWithDeepSeek = async (file: File, apiKey: string): Promise<Partial<KnowledgeItem>> => {
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const SYSTEM_PROMPT = `
You are a professional personal knowledge base administrator. The user has uploaded a file. Please analyze its content and extract metadata.

Output Requirement (JSON):
1. summary: A one-sentence summary of the core knowledge point (within 50 words).
2. category: Classification (e.g., Automation Control, Scripting, Project Management, Device Manual).
3. tags: 3-5 key skill tags (e.g., PLC, Python, PID, Modbus).
4. applicability: In what work scenario is this file most useful? (e.g., On-site debugging, Report writing).

Return ONLY the JSON object.
`;

  try {
    let content = "";
    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    // DeepSeek (via OpenAI-compatible endpoint) typically handles text best.
    // For binaries/images, we will just send metadata unless we implement OCR here (skipping for MVP).

    if (fileType.startsWith('text/') ||
      fileName.endsWith('.py') || fileName.endsWith('.js') || fileName.endsWith('.ts') ||
      fileName.endsWith('.tsx') || fileName.endsWith('.json') || fileName.endsWith('.md') ||
      fileName.endsWith('.csv') || fileName.endsWith('.sql')) {
      content = await readFileAsText(file);
      // Truncate to avoid context limit issues (DeepSeek V3 is 64k/128k but safe side 30k chars)
      content = content.slice(0, 30000);
    } else {
      content = `[Binary File] Filename: ${file.name}, Type: ${file.type}. Please infer content from filename.`;
    }

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `File Name: ${file.name}\n\nFile Content:\n${content}` }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`DeepSeek API Error: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const jsonStr = data.choices[0].message.content;
    return JSON.parse(jsonStr);

  } catch (error) {
    console.error("DeepSeek Analysis Failed:", error);
    throw error;
  }
};

// --- API 调用逻辑 (现在接受动态 Key) ---
const analyzeContentWithGemini = async (file: File, apiKey: string): Promise<Partial<KnowledgeItem>> => {
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const ai = new GoogleGenAI({ apiKey: apiKey });

  const systemPrompt = `
    你是一个专业的个人知识库管理员。用户上传了一个文件，请分析其内容并提取元数据。
    
    输出要求 (JSON):
    1. summary: 一句话总结核心知识点 (50字以内)。
    2. category: 归类 (例如: 自动化控制, 编程脚本, 项目管理, 设备手册)。
    3. tags: 3-5个关键技能标签 (例如: PLC, Python, PID, Modbus)。
    4. applicability: 这个文件在什么工作场景下最有用？(例如: 现场调试时, 写报告时)。
  `;

  let parts: any[] = [{ text: systemPrompt }];

  try {
    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    // 1. PDF 和 图片
    if (fileType === 'application/pdf' || fileType.startsWith('image/')) {
      const base64Data = await readFileAsBase64(file);
      parts.push({ text: `文件名为: ${file.name}。请根据附带的文件内容进行分析。` });
      parts.push({ inlineData: { mimeType: fileType, data: base64Data } });
    }
    // 2. 文本和代码
    else if (
      fileType.startsWith('text/') ||
      fileName.endsWith('.py') || fileName.endsWith('.js') || fileName.endsWith('.ts') ||
      fileName.endsWith('.tsx') || fileName.endsWith('.json') || fileName.endsWith('.md') ||
      fileName.endsWith('.csv') || fileName.endsWith('.sql')
    ) {
      const textContent = await readFileAsText(file);
      const truncatedText = textContent.slice(0, 20000);
      parts.push({ text: `文件名为: ${file.name}。\n\n文件文本内容如下:\n${truncatedText}` });
    }
    // 3. 其他二进制
    else {
      parts.push({
        text: `用户上传了一个文件名为 "${file.name}" 的文件。
               由于当前环境无法读取此二进制格式的内容，请你仅根据文件名猜测它可能的内容、分类和标签。`
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            category: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            applicability: { type: Type.STRING },
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    return JSON.parse(text) as Partial<KnowledgeItem>;

  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    throw error;
  }
};

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
  const type = fileType.toLowerCase();
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
  onExport,
  onImport,
  onClear
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

            {/* Gemini Key Input */}
            {provider === 'gemini' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                <div className="relative">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="请输入 Gemini API Key"
                    className="w-full pl-4 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-blue-500 hover:underline">获取 Gemini Key</a>
                </p>
              </div>
            )}

            {/* DeepSeek Key Input */}
            {provider === 'deepseek' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                <div className="relative">
                  <input
                    type="password"
                    value={deepSeekApiKey}
                    onChange={(e) => setDeepSeekApiKey(e.target.value)}
                    placeholder="请输入 DeepSeek API Key"
                    className="w-full pl-4 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  <a href="https://platform.deepseek.com/api_keys" target="_blank" className="text-blue-500 hover:underline">获取 DeepSeek Key</a>
                </p>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100 my-2"></div>

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
  // 核心状态
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'mindmap'>('mindmap');

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

  // 脑图画布状态
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // 设置相关状态
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("gemini_api_key") || process.env.API_KEY || "");
  const [deepSeekApiKey, setDeepSeekApiKey] = useState(() => localStorage.getItem("deepseek_api_key") || "");
  const [provider, setProvider] = useState<'gemini' | 'deepseek'>(() => (localStorage.getItem("ai_provider") as any) || 'gemini');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 初始化：从 localStorage 加载数据
  useEffect(() => {
    const savedData = localStorage.getItem("knowledge_items");
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        if (Array.isArray(parsedData)) {
          // 数据清洗：确保 tags 等必填字段存在
          const validData = parsedData.map((item: any) => ({
            ...item,
            tags: Array.isArray(item.tags) ? item.tags : [], // 确保 tags 是数组
            summary: item.summary || "",
            category: item.category || "未分类",
            fileName: item.fileName || "未知文件"
          }));
          setItems(validData);
        }
      } catch (e) {
        console.error("Failed to load local data", e);
      }
    }
  }, []);

  // 持久化：当 items 变化时保存
  useEffect(() => {
    localStorage.setItem("knowledge_items", JSON.stringify(items));
  }, [items]);

  // 持久化：当 API Key 变化时保存
  useEffect(() => {
    localStorage.setItem("gemini_api_key", apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem("deepseek_api_key", deepSeekApiKey);
  }, [deepSeekApiKey]);

  useEffect(() => {
    localStorage.setItem("ai_provider", provider);
  }, [provider]);

  // 操作：下载文件
  const handleDownload = async (item: KnowledgeItem) => {
    try {
      const fileBlob = await getFileFromDB(item.id);
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
        alert("无法下载：未找到源文件（可能是演示数据或本地缓存已被清理）。");
      }
    } catch (e) {
      console.error(e);
      alert("下载过程中发生错误");
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

  const handleFileDropOnCategory = (e: React.DragEvent, newCategory: string) => {
    const fileId = e.dataTransfer.getData('fileId');
    if (fileId && newCategory) {
      setItems(prev => prev.map(item =>
        item.id === fileId ? { ...item, category: newCategory } : item
      ));
    }
  };

  // 操作：删除单个条目
  const handleDeleteItem = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (confirm("确定要删除这条知识索引吗？原始文件也将被移除。")) {
      setItems(prev => prev.filter(item => item.id !== id));
      await deleteFileFromDB(id);
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
      await clearDB();
      setShowSettings(false);
    }
  };

  // 模拟数据加载
  const loadDemoData = () => {
    setIsAnalyzing(true);
    setViewMode('mindmap');

    setTimeout(() => {
      const demoData: KnowledgeItem[] = [
        { id: "1", fileName: "西门子S7-1200_PID调试指南.pdf", fileType: "pdf", summary: "S7-1200 PLC PID Compact指令参数整定与故障排除。", category: "自动化控制", tags: ["PLC", "PID", "调试", "Siemens"], applicability: "现场设备调试", addedAt: "2023-10-15" },
        { id: "2", fileName: "生产线数据采集脚本_v2.py", fileType: "code", summary: "基于Modbus TCP的Python采集脚本，存入MySQL。", category: "编程脚本", tags: ["Python", "Modbus", "SQL", "后端"], applicability: "上位机开发", addedAt: "2023-11-02" },
        { id: "3", fileName: "2024Q1_自动化部门复盘报告.pptx", fileType: "ppt", summary: "Q1项目进度、AGV调度系统难点复盘及Q2规划。", category: "项目管理", tags: ["复盘", "AGV", "规划", "PPT"], applicability: "季度汇报", addedAt: "2024-04-10" },
        { id: "4", fileName: "Fanuc机器人故障代码表.xlsx", fileType: "excel", summary: "Fanuc R-2000iC系列机器人SRVO报警代码索引。", category: "设备维护", tags: ["Fanuc", "机器人", "运维", "故障表"], applicability: "产线抢修", addedAt: "2023-09-20" },
        { id: "5", fileName: "电气原理图_V3.0.pdf", fileType: "pdf", summary: "总装车间电气柜接线图及IO分配表。", category: "自动化控制", tags: ["电气图", "EPLAN", "IO表"], applicability: "接线施工", addedAt: "2024-01-12" }
      ];
      setItems(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        const newItems = demoData.filter(i => !existingIds.has(i.id));
        return [...newItems, ...prev];
      });
      setIsAnalyzing(false);
    }, 800);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);

    const currentKey = provider === 'gemini' ? apiKey : deepSeekApiKey;

    if (!currentKey) {
      setShowSettings(true);
      setErrorMessage(`请先配置 ${provider === 'gemini' ? 'Gemini' : 'DeepSeek'} API Key 才能开始分析文件。`);
      return;
    }

    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setIsAnalyzing(true);

      try {
        let analysis: Partial<KnowledgeItem>;

        if (provider === 'deepseek') {
          analysis = await analyzeContentWithDeepSeek(file, currentKey);
        } else {
          analysis = await analyzeContentWithGemini(file, currentKey);
        }

        // 生成唯一ID，并保存文件到 IndexedDB
        const id = Date.now().toString();
        await saveFileToDB(id, file);

        const fileExtension = file.name.split('.').pop();
        const fileType = file.type || fileExtension || 'unknown';

        const newItem: KnowledgeItem = {
          id: id,
          fileName: file.name,
          fileType: fileType,
          summary: analysis.summary || "未能生成摘要",
          category: analysis.category || "未分类",
          tags: analysis.tags || [],
          applicability: analysis.applicability || "通用",
          addedAt: new Date().toISOString().split('T')[0]
        };
        setItems(prev => [newItem, ...prev]);
      } catch (error: any) {
        setErrorMessage(error.message === "API_KEY_MISSING" ? "请先配置 API Key" : `分析失败：${error.message || "未知错误"}`);
        if (error.message === "API_KEY_MISSING") setShowSettings(true);
      } finally {
        setIsAnalyzing(false);
        e.target.value = '';
      }
    }
  };

  const filteredItems = items.filter(item =>
    item.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())) ||
    item.summary.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // --- 画布事件处理 ---
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // 只有点击背景（或非交互元素）时才允许拖拽
    if ((e.target as HTMLElement).closest('.cursor-pointer') || (e.target as HTMLElement).closest('button')) return;

    setIsDraggingCanvas(true);
    dragStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingCanvas || !dragStartRef.current) return;
    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStartRef.current!.x,
      y: e.clientY - dragStartRef.current!.y
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

    setTransform(prev => ({
      ...prev,
      x: e.touches[0].clientX - dragStartRef.current!.x,
      y: e.touches[0].clientY - dragStartRef.current!.y
    }));
  };

  const handleCanvasTouchEnd = () => {
    setIsDraggingCanvas(false);
    dragStartRef.current = null;
  };

  const handleCanvasWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      e.preventDefault();
      const zoomSensitivity = 0.001;
      const newScale = Math.min(Math.max(0.5, transform.scale - e.deltaY * zoomSensitivity), 3);
      setTransform(prev => ({ ...prev, scale: newScale }));
    } else {
      // Pan (Optional: map wheel to pan if needed, but standard is vertical scroll)
      // Here we just let standard scroll behavior happen or stop propagation if we want "infinite canvas" feel
      // For this implementation, we rely on drag to pan.
    }
  };

  const handleZoomIn = () => setTransform(prev => ({ ...prev, scale: Math.min(prev.scale + 0.2, 3) }));
  const handleZoomOut = () => setTransform(prev => ({ ...prev, scale: Math.max(prev.scale - 0.2, 0.5) }));
  const handleResetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  // 渲染脑图逻辑
  const renderMindMap = () => {
    if (items.length === 0) return null;
    const categories = Array.from(new Set(filteredItems.map(i => i.category)));

    return (
      <div
        className="relative bg-slate-50/50 rounded-2xl border border-slate-200 shadow-inner h-[600px] overflow-hidden cursor-grab active:cursor-grabbing group select-none"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        onWheel={handleCanvasWheel}
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
                    onClick={(e) => handleRenameCategory(cat, e)}
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
                    childrenNodes={file.tags.map(tag => (
                      <TreeNode
                        key={tag}
                        label={
                          <div title="点击修改或删除标签" onClick={(e) => handleEditTag(file.id, tag, e)}>
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
        onExport={handleExport}
        onImport={handleImport}
        onClear={handleClearAll}
      />

      <EditModal
        isOpen={editState.isOpen}
        onClose={() => setEditState(prev => ({ ...prev, isOpen: false }))}
        onSave={handleSaveEdit}
        title={editState.title}
        initialValue={editState.initialValue}
        placeholder={editState.type === 'edit-tag' ? "输入新名称，留空保存即为删除" : "请输入名称"}
      />

      {/* 顶部导航 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm/50 backdrop-blur-sm bg-white/90">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-blue-200 shadow-lg ring-1 ring-blue-700/10">
              <BrainCircuit size={20} />
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight hidden md:block">知识碎片索引助手</h1>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight md:hidden">知识助手</h1>
          </div>
          <div className="flex items-center gap-3">
            {items.length === 0 && (
              <button
                onClick={loadDemoData}
                disabled={isAnalyzing}
                className="text-sm bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors border border-blue-100"
              >
                {isAnalyzing ? <Loader2 className="animate-spin" size={14} /> : <Database size={14} />}
                <span className="hidden sm:inline">演示数据</span>
              </button>
            )}

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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">

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
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-300"
            />
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            {/* 视图切换 */}
            <div className="flex p-1.5 bg-slate-200/60 rounded-xl backdrop-blur-sm">
              <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} title="卡片视图"><LayoutGrid size={18} /></button>
              <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} title="列表视图"><List size={18} /></button>
              <button onClick={() => setViewMode('mindmap')} className={`p-2 rounded-lg transition-all ${viewMode === 'mindmap' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`} title="脑图模式"><Network size={18} /></button>
            </div>

            {/* 上传按钮 */}
            <label className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-lg hover:shadow-slate-300 transition-all cursor-pointer active:scale-95 hover:-translate-y-0.5 ${!apiKey ? 'opacity-80' : ''}`}>
              <UploadCloud size={18} />
              <span className="font-medium">上传</span>
              <input type="file" className="hidden" onChange={handleFileUpload} disabled={isAnalyzing} />
            </label>
          </div>
        </div>

        {/* 内容展示区 */}

        {/* 空状态 */}
        {items.length === 0 && !isAnalyzing && (
          <div className="py-24 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50 hover:bg-slate-50 transition-colors">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-100">
              <BrainCircuit className="text-blue-500" size={40} />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-3">构建您的第二大脑</h3>
            <p className="text-slate-500 max-w-md mb-8 leading-relaxed">
              上传原本杂乱的 PPT、PDF 或 Excel。<br />
              Gemini AI 将自动提取知识点，生成可视化的知识地图。
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
            <button
              onClick={loadDemoData}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all font-medium shadow-blue-200 shadow-lg flex items-center gap-2 hover:-translate-y-0.5 active:translate-y-0"
            >
              <Database size={18} />
              体验 "自动化技术" 知识库
            </button>
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
                    ${item.fileType.includes('pdf') ? 'bg-red-50 text-red-500' :
                      item.fileType.includes('ppt') ? 'bg-orange-50 text-orange-500' :
                        item.fileType.includes('code') ? 'bg-blue-50 text-blue-500' :
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
                  <div className="col-span-3">应用场景</div>
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
                      <div className="col-span-3 text-xs text-slate-600 font-medium flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        {item.applicability}
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
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
