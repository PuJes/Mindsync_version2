import { storage } from '../utils/fileStorage';
// 🔧 修复问题 5：使用单例替代新建实例
import { taxonomyService } from './taxonomyService';
import { StagedFile, useStagingStore } from '../store/stagingStore';

export interface MoveResult {
    fileId: string;
    success: boolean;
    sourcePath: string;
    targetPath: string;
    error?: string;
}

export interface UndoLog {
    timestamp: number;
    operations: { source: string; target: string }[];
}

export class FileOpsService {
    // 🔧 修复：移除私有 taxonomyService 实例，使用全局单例
    private undoLog: UndoLog | null = null;

    constructor() {
        // 不再创建新实例
    }

    /**
     * 执行单个文件的移动/归档操作
     */
    public async executeMove(file: StagedFile): Promise<MoveResult> {
        // 🔧 修复：优先使用 originalPath（addFiles 时保存的完整路径）
        const sourcePath = file.originalPath || (file.file as any).path;
        const targetPath = file.userEdit?.targetPath || file.proposal?.targetPath;

        console.log('📁 [FileOps] executeMove:', {
            fileName: file.file.name,
            sourcePath,
            targetPath,
            originalPath: file.originalPath,
            filePath: (file.file as any).path
        });

        if (!targetPath) {
            console.error('📁 [FileOps] Error: 未指定目标路径');
            return { fileId: file.id, success: false, sourcePath, targetPath: '', error: '未指定目标路径' };
        }

        // 🔧 修复：检查是否有有效的源路径
        if (!sourcePath || sourcePath === file.file.name) {
            console.error('📁 [FileOps] Error: 无有效源文件路径');
            return { fileId: file.id, success: false, sourcePath, targetPath, error: '无有效源文件路径，请重新扫描文件夹' };
        }

        try {
            const root = localStorage.getItem('electron_root_path');
            if (!root) throw new Error('Root path not set');

            const cleanTarget = targetPath.replace(/^\/+/, '');
            const fullTargetDir = `${root}/${cleanTarget}`;
            const fileName = file.file.name;
            const fullTargetFile = `${fullTargetDir}/${fileName}`;

            console.log('📁 [FileOps] Paths:', { root, cleanTarget, fullTargetDir, fullTargetFile });

            await storage.ensureDir!(fullTargetDir);

            // 🔧 修复：只要有有效的 sourcePath 就尝试移动
            if (sourcePath === fullTargetFile) {
                console.log('📁 [FileOps] Skipped: source === target');
                return { fileId: file.id, success: true, sourcePath, targetPath: fullTargetFile };
            }

            if (storage.moveFile) {
                console.log('📁 [FileOps] Moving file...');
                await storage.moveFile(sourcePath, fullTargetFile);
                console.log('📁 [FileOps] Move success!');
            } else {
                throw new Error('storage.moveFile not supported');
            }

            return { fileId: file.id, success: true, sourcePath, targetPath: fullTargetFile };
        } catch (e: any) {
            console.error('📁 [FileOps] Execute Move Failed:', e);
            return { fileId: file.id, success: false, sourcePath, targetPath, error: e.message };
        }
    }

    /**
     * 批量执行待处理文件的移动操作
     * @param selectedIds 可选，如果传入则只处理选中的文件
     */
    public async executeCommit(selectedIds?: Set<string>): Promise<{ successCount: number; failCount: number; results: MoveResult[] }> {
        const store = useStagingStore.getState();

        // 🔧 修复：支持只执行选中的文件
        let filesToCommit = store.files.filter(f => f.status === 'success' && !f.proposal?.targetPath?.includes('跳过'));

        if (selectedIds && selectedIds.size > 0) {
            filesToCommit = filesToCommit.filter(f => selectedIds.has(f.id));
            console.log('📁 [FileOps] Executing only selected files:', selectedIds.size);
        }

        store.setWorkflowStatus('executing');

        const results: MoveResult[] = [];
        const undoOperations: { source: string; target: string }[] = [];
        const committedFiles: StagedFile[] = [];

        for (const file of filesToCommit) {
            const result = await this.executeMove(file);
            results.push(result);

            if (result.success) {
                undoOperations.push({ source: result.targetPath, target: result.sourcePath });
                committedFiles.push(file);
                store.removeFile(file.id);
            }
        }

        // 🔧 P1-2: 持久化元数据到 index.json
        if (committedFiles.length > 0) {
            await this.persistMetadata(committedFiles, results);
        }

        // 保存撤销日志
        this.undoLog = {
            timestamp: Date.now(),
            operations: undoOperations
        };

        // 可选：持久化撤销日志到文件
        await this.saveUndoLog();

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        store.setWorkflowStatus(failCount > 0 ? 'reviewing' : 'done');

        return { successCount, failCount, results };
    }

    /**
     * 持久化元数据到 index.json
     */
    private async persistMetadata(files: StagedFile[], results: MoveResult[]): Promise<void> {
        try {
            // 加载现有元数据
            let metadata: any = await storage.loadAllItems();

            // 确保是 v3.0 格式
            if (!metadata || Array.isArray(metadata) || metadata.version !== '3.0') {
                metadata = {
                    version: '3.0',
                    config: { taxonomyMode: 'flexible', maxDepth: 3, maxChildren: 10, ignorePatterns: [] },
                    taxonomy: { root: [] },
                    files: {}
                };
            }

            // 添加/更新文件元数据
            for (const file of files) {
                const result = results.find(r => r.fileId === file.id);
                if (!result?.success) continue;

                // 🔧 修复问题 3：优先使用 contentHash，否则使用文件路径作为稳定 key
                // 避免使用随机 id 导致 key 不稳定
                const stableKey = file.contentHash ||
                    result.targetPath.replace(/^.*\//, '').replace(/\s+/g, '_') ||
                    file.file.name.replace(/\s+/g, '_');

                metadata.files[stableKey] = {
                    id: file.id,
                    originalName: file.file.name,
                    currentPath: result.targetPath,
                    contentHash: file.contentHash || '',
                    category: file.userEdit?.targetPath || file.proposal?.targetPath || '未分类',
                    ai: {
                        summary: file.userEdit?.summary || file.proposal?.summary || '',
                        tags: file.userEdit?.tags || file.proposal?.tags || [],
                        reasoning: file.proposal?.reasoning || '',
                        confidence: file.proposal?.confidence || 0
                    },
                    userOverride: !!file.userEdit
                };
            }

            // 保存
            await storage.saveAllItems(metadata);
            console.log(`✅ 元数据已持久化: ${files.length} 个文件`);
        } catch (e) {
            console.error('Failed to persist metadata', e);
        }
    }

    /**
     * 保存撤销日志到文件
     */
    private async saveUndoLog(): Promise<void> {
        if (!this.undoLog || !storage.isElectron) return;

        const root = localStorage.getItem('electron_root_path');
        if (!root) return;

        try {
            const logPath = `${root}/.undo_log.json`;
            const content = JSON.stringify(this.undoLog, null, 2);
            // 使用 writeFile IPC
            await (window as any).electronAPI?.writeFile(logPath, content);
        } catch (e) {
            console.warn('Failed to save undo log', e);
        }
    }

    /**
     * 执行撤销操作
     */
    public async executeUndo(): Promise<{ successCount: number; failCount: number }> {
        if (!this.undoLog) {
            // 尝试从文件加载
            await this.loadUndoLog();
        }

        if (!this.undoLog || this.undoLog.operations.length === 0) {
            return { successCount: 0, failCount: 0 };
        }

        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        for (const op of this.undoLog.operations) {
            try {
                if (storage.moveFile) {
                    // 检查源文件是否存在
                    const sourceExists = await this.checkFileExists(op.source);
                    if (!sourceExists) {
                        errors.push(`文件不存在: ${op.source}`);
                        failCount++;
                        continue;
                    }

                    // 确保目标目录存在
                    const targetDir = op.target.substring(0, op.target.lastIndexOf('/'));
                    if (storage.ensureDir) {
                        await storage.ensureDir(targetDir);
                    }

                    await storage.moveFile(op.source, op.target);
                    successCount++;

                    // 🔧 新增：撤销成功后，重新添加文件到待处理列表
                    try {
                        const fileName = op.target.split('/').pop() || '';
                        const mockFile = new File([], fileName, { type: 'application/octet-stream' });
                        // 为 mock File 添加 path 属性
                        Object.defineProperty(mockFile, 'path', {
                            value: op.target,
                            writable: false
                        });

                        const store = useStagingStore.getState();
                        store.addFiles([mockFile]);
                        console.log('🔄 [FileOps] Re-added undone file to staging:', fileName);
                    } catch (addError) {
                        console.warn('Failed to re-add file to staging:', addError);
                    }
                }
            } catch (e: any) {
                console.error('Undo operation failed', e);
                errors.push(`${op.source}: ${e.message}`);
                failCount++;
            }
        }

        // 清除日志
        this.undoLog = null;

        if (errors.length > 0) {
            console.warn('Undo errors:', errors);
        }

        return { successCount, failCount };
    }

    /**
     * 检查文件是否存在
     */
    private async checkFileExists(path: string): Promise<boolean> {
        try {
            const api = (window as any).electronAPI;
            if (api?.fileExists) {
                return await api.fileExists(path);
            }
            // 回退：尝试读取文件
            if (storage.readTextFile) {
                await storage.readTextFile(path);
                return true;
            }
            return true; // 假设存在
        } catch {
            return false;
        }
    }

    /**
     * 从文件加载撤销日志
     */
    private async loadUndoLog(): Promise<void> {
        if (!storage.isElectron) return;

        const root = localStorage.getItem('electron_root_path');
        if (!root) return;

        try {
            const logPath = `${root}/.undo_log.json`;
            const result = await (window as any).electronAPI?.readFile(logPath);
            if (result?.success && result.data) {
                this.undoLog = JSON.parse(result.data);
            }
        } catch (e) {
            console.warn('Failed to load undo log', e);
        }
    }
}

export const fileOpsService = new FileOpsService();

