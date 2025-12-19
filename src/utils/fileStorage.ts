// 抽象存储层：自动判断是 Electron 环境还是 Web 环境
// 如果是 Electron，使用文件系统；否则使用 IndexedDB/LocalStorage

// --- Electron 类型定义 ---
interface ElectronAPI {
    openDirectory: () => Promise<string | undefined>;
    readFile: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
    writeBinary: (path: string, data: string) => Promise<{ success: boolean; error?: string }>;
    listFiles: (path: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
    readBinary: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    ensureDir: (path: string) => Promise<{ success: boolean; error?: string }>;
    scanDirectory: (path: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    movePath: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
    readTextFile: (filePath: string, maxChars?: number) => Promise<{ success: boolean; data?: string; isText?: boolean; error?: string }>;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

// --- 存储接口 ---
export interface StorageLayer {
    isElectron: boolean;
    init: () => Promise<void>;
    setRootPath?: (path: string) => void;
    saveItem: (item: any) => Promise<void>; // 保存单条元数据
    saveAllItems: (items: any[]) => Promise<void>; // 保存所有元数据 (index.json)
    loadAllItems: () => Promise<any[]>;
    saveFile: (file: File) => Promise<string>; // 返回文件 ID 或 路径
    getFile: (idOrPath: string) => Promise<File | Blob | undefined>;
    deleteFile: (idOrPath: string) => Promise<void>;
    openDirectory?: () => Promise<string | undefined>;
    scanDirectory?: () => Promise<any>; // Return tree structure
    moveFile?: (oldPath: string, newPath: string) => Promise<void>;
    readTextFile?: (filePath: string) => Promise<{ content: string; isText: boolean }>;
    ensureDir?: (dirPath: string) => Promise<void>;
}

// --- IndexedDB Helper (Copied from index.tsx) ---
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

// --- 实现：Web (IndexedDB) ---
const WebStorage: StorageLayer = {
    isElectron: false,
    init: async () => { },
    saveItem: async () => { },
    saveAllItems: async (items) => {
        localStorage.setItem("knowledge_items", JSON.stringify(items));
    },
    loadAllItems: async () => {
        const data = localStorage.getItem("knowledge_items");
        return data ? JSON.parse(data) : [];
    },
    saveFile: async (file) => {
        try {
            const db = await openDB();
            // Use timestamp + filename as ID to avoid duplicates
            const id = `${Date.now()}_${file.name}`;
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const request = store.put(file, id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            return id;
        } catch (e) {
            console.error("WebStorage Save Failed", e);
            throw e;
        }
    },
    getFile: async (id) => {
        try {
            const db = await openDB();
            return new Promise<File | undefined>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, "readonly");
                const store = tx.objectStore(STORE_NAME);
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error("WebStorage Get Failed", e);
            return undefined;
        }
    },
    deleteFile: async (id) => {
        try {
            const db = await openDB();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error("WebStorage Delete Failed", e);
        }
    }
};

// --- 实现：Electron ---
let rootPath = localStorage.getItem("electron_root_path") || "";
const INDEX_FILE = "knowledge_index.json";

const ElectronStorage: StorageLayer = {
    isElectron: true,
    init: async () => { },
    setRootPath: (path: string) => {
        rootPath = path;
        localStorage.setItem("electron_root_path", path);
    },
    saveItem: async () => {
        // Electron 模式下不需要单独保存，使用 saveAllItems
    },
    openDirectory: async () => {
        const path = await window.electronAPI?.openDirectory();
        if (path) ElectronStorage.setRootPath!(path);
        return path;
    },
    saveAllItems: async (items) => {
        if (!rootPath) return;
        const content = JSON.stringify(items, null, 2);
        await window.electronAPI?.writeFile(`${rootPath}/${INDEX_FILE}`, content);
    },
    loadAllItems: async () => {
        if (!rootPath) return [];
        const result = await window.electronAPI?.readFile(`${rootPath}/${INDEX_FILE}`);
        if (result?.success && result.data) {
            return JSON.parse(result.data);
        }
        return [];
    },
    saveFile: async (file) => {
        if (!rootPath) throw new Error("请先选择知识库文件夹");

        try {
            // 1. 确保 files 子目录存在
            const filesDir = `${rootPath}/files`;
            const ensureResult = await window.electronAPI?.ensureDir(filesDir);
            if (!ensureResult?.success) {
                throw new Error(ensureResult?.error || "无法创建文件存储目录");
            }

            // 2. 生成唯一文件名（时间戳 + 原文件名）
            const timestamp = Date.now();
            const fileName = `${timestamp}_${file.name}`;
            const filePath = `${filesDir}/${fileName}`;

            // 3. 读取文件并转换为 base64
            const reader = new FileReader();
            return new Promise((resolve, reject) => {
                reader.onload = async () => {
                    try {
                        const base64 = (reader.result as string).split(',')[1];

                        // 4. 通过 IPC 写入文件
                        const result = await window.electronAPI?.writeBinary(filePath, base64);

                        if (result?.success) {
                            resolve(filePath); // 返回完整路径
                        } else {
                            reject(new Error(result?.error || "文件保存失败"));
                        }
                    } catch (e) {
                        reject(e);
                    }
                };
                reader.onerror = () => reject(new Error("文件读取失败"));
                reader.readAsDataURL(file);
            });
        } catch (e) {
            console.error("ElectronStorage Save Failed:", e);
            throw e;
        }
    },
    getFile: async (path) => {
        // Electron usually reads directly via FS in main process or handled by `file://` protocol in renderer if allowed
        // But for "downloading" via Blob, we might need to read it into memory
        const result = await window.electronAPI?.readBinary(path);
        if (result?.success && result.data) {
            // Data is base64
            const byteCharacters = atob(result.data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            return new Blob([byteArray]);
        }
        return undefined;
    },
    deleteFile: async (path) => {
        // In a real app, delete the file from disk using IPC
        // await window.electronAPI?.deleteFile(path);
        console.log("Mock delete file from disk:", path);
    },
    scanDirectory: async () => {
        if (!rootPath) return null;
        const result = await window.electronAPI?.scanDirectory(rootPath);
        if (result?.success) {
            return result.data;
        }
        return null;
    },
    moveFile: async (oldPath: string, newPath: string) => {
        const result = await window.electronAPI?.movePath(oldPath, newPath);
        if (!result?.success) {
            throw new Error(result?.error || "移动文件失败");
        }
    },
    readTextFile: async (filePath: string) => {
        const result = await window.electronAPI?.readTextFile(filePath);
        if (!result?.success) {
            throw new Error(result?.error || "读取文件失败");
        }
        return { content: result.data || "", isText: result.isText || false };
    },
    ensureDir: async (dirPath: string) => {
        const result = await window.electronAPI?.ensureDir(dirPath);
        if (!result?.success) {
            throw new Error(result?.error || "创建目录失败");
        }
    }
};

// --- 工厂 ---
export const storage: StorageLayer = window.electronAPI ? ElectronStorage : WebStorage;
