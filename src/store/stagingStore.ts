import { create } from 'zustand';
import { FileMetadataV3 } from '../types/metadata.v3';

// 扩展 File 对象，加入我们需要的临时状态
export interface StagedFile {
    id: string; // unique internal ID
    file: File;
    status: 'pending' | 'analyzing' | 'success' | 'error' | 'duplicate';
    originalPath: string; // 来源路径（如果是拖入的，可能是 file.path 或 undefined）
    contentHash?: string; // MD5 Hash

    // AI 建议
    proposal?: {
        targetPath: string;
        summary: string;
        tags: string[];
        reasoning: string;
        confidence: number;
    };

    // 用户编辑（覆盖 AI）
    userEdit?: {
        targetPath?: string;
        summary?: string;
        tags?: string[];
    };

    error?: string;
}

interface StagingState {
    // 当前工作流状态
    workflowStatus: 'idle' | 'analyzing' | 'reviewing' | 'executing' | 'done';

    // 待处理文件列表
    files: StagedFile[];

    // 当前选中的文件 ID (用于右侧编辑器显示)
    selectedFileId: string | null;

    // 🔧 P2: 多选状态
    selectedFileIds: Set<string>;

    // Actions
    setWorkflowStatus: (status: StagingState['workflowStatus']) => void;
    addFiles: (files: File[]) => void;
    updateFileStatus: (id: string, status: StagedFile['status'], error?: string) => void;
    updateFileHash: (id: string, hash: string) => void;
    updateFileProposal: (id: string, proposal: StagedFile['proposal']) => void;
    updateUserEdit: (id: string, edit: Partial<Exclude<StagedFile['userEdit'], undefined>>) => void;
    selectFile: (id: string | null) => void;
    removeFile: (id: string) => void;
    clearAll: () => void;

    // 🔧 P2: 多选操作
    toggleFileSelection: (id: string, multiSelect?: boolean) => void;
    selectAllFiles: () => void;
    clearSelection: () => void;
    batchUpdateTargetPath: (targetPath: string) => void;
    batchAddTag: (tag: string) => void;
    batchRemoveFiles: () => void;

    // 🔧 新增：重新分析功能
    reanalyzeFiles: (fileIds?: Set<string>) => void;
}

export const useStagingStore = create<StagingState>((set, get) => ({
    workflowStatus: 'idle',
    files: [],
    selectedFileId: null,
    selectedFileIds: new Set(),

    setWorkflowStatus: (status) => set({ workflowStatus: status }),

    addFiles: (newFiles) => set((state) => {
        const stagedFiles: StagedFile[] = newFiles.map(f => {
            const filePath = (f as any).path;
            console.log('📁 [StagingStore] addFiles:', {
                name: f.name,
                path: filePath,
                hasPath: !!filePath
            });
            return {
                id: Math.random().toString(36).substring(7), // Simple ID
                file: f,
                status: 'pending' as const,
                originalPath: filePath || f.name // Electron File object usually has path
            };
        });
        return { files: [...state.files, ...stagedFiles] };
    }),

    updateFileStatus: (id, status, error) => set((state) => ({
        files: state.files.map(f => f.id === id ? { ...f, status, error } : f)
    })),

    updateFileHash: (id, hash) => set((state) => ({
        files: state.files.map(f => f.id === id ? { ...f, contentHash: hash } : f)
    })),

    updateFileProposal: (id, proposal) => set((state) => ({
        files: state.files.map(f => f.id === id ? { ...f, proposal, status: 'success' } : f)
    })),

    updateUserEdit: (id, edit) => set((state) => ({
        files: state.files.map(f => f.id === id ? {
            ...f,
            userEdit: { ...f.userEdit, ...edit }
        } : f)
    })),

    selectFile: (id) => set({ selectedFileId: id }),

    removeFile: (id) => set((state) => {
        const newSelectedIds = new Set(state.selectedFileIds);
        newSelectedIds.delete(id);
        return {
            files: state.files.filter(f => f.id !== id),
            selectedFileId: state.selectedFileId === id ? null : state.selectedFileId,
            selectedFileIds: newSelectedIds
        };
    }),

    clearAll: () => set({ files: [], selectedFileId: null, selectedFileIds: new Set(), workflowStatus: 'idle' }),

    // 🔧 P2: 多选操作
    toggleFileSelection: (id, multiSelect = false) => set((state) => {
        const newSet = multiSelect ? new Set(state.selectedFileIds) : new Set<string>();
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        return {
            selectedFileIds: newSet,
            selectedFileId: id // 同时更新单选以显示编辑器
        };
    }),

    selectAllFiles: () => set((state) => ({
        selectedFileIds: new Set(state.files.map(f => f.id))
    })),

    clearSelection: () => set({ selectedFileIds: new Set() }),

    batchUpdateTargetPath: (targetPath) => set((state) => ({
        files: state.files.map(f =>
            state.selectedFileIds.has(f.id)
                ? { ...f, userEdit: { ...f.userEdit, targetPath } }
                : f
        )
    })),

    batchAddTag: (tag) => set((state) => ({
        files: state.files.map(f => {
            if (!state.selectedFileIds.has(f.id)) return f;
            const currentTags = f.userEdit?.tags || f.proposal?.tags || [];
            if (currentTags.includes(tag)) return f;
            return { ...f, userEdit: { ...f.userEdit, tags: [...currentTags, tag] } };
        })
    })),

    batchRemoveFiles: () => set((state) => ({
        files: state.files.filter(f => !state.selectedFileIds.has(f.id)),
        selectedFileIds: new Set(),
        selectedFileId: state.selectedFileIds.has(state.selectedFileId || '') ? null : state.selectedFileId
    })),

    // 🔧 新增：重新分析选中的文件
    reanalyzeFiles: (fileIds) => set((state) => {
        const idsToReanalyze = fileIds || state.selectedFileIds;
        if (idsToReanalyze.size === 0) return state;

        return {
            files: state.files.map(f => {
                if (idsToReanalyze.has(f.id)) {
                    // 清除 AI 建议和用户编辑，重置为待分析状态
                    return {
                        ...f,
                        status: 'pending' as const,
                        proposal: undefined,
                        userEdit: undefined,
                        error: undefined
                    };
                }
                return f;
            })
        };
    })
}));
