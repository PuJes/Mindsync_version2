import { useStagingStore, StagedFile } from '../store/stagingStore';
import { calculateFileHash } from '../utils/fileHash';
import { storage } from '../utils/fileStorage';
import { FileMetadataV3 } from '../types/metadata.v3';
import { analyzeFile, AIServiceConfig } from './aiService';
import { taxonomyService } from './taxonomyService';

// 读取文件内容为文本（用于 AI 分析）
async function readFileContent(file: File): Promise<string | undefined> {
    // 在 Electron 中，可以尝试通过 storage 读取
    if (storage.isElectron && storage.readTextFile && (file as any).path) {
        try {
            const result = await storage.readTextFile((file as any).path);
            return result.isText ? result.content : undefined;
        } catch (e) {
            console.warn('Failed to read file via Electron IPC', e);
        }
    }

    // 回退到浏览器 FileReader
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(undefined);
        reader.readAsText(file);
    });
}

export class BatchProcessor {
    private aiConfig: AIServiceConfig | null = null;

    /**
     * 设置 AI 配置（需在处理前调用）
     */
    public setAIConfig(config: AIServiceConfig) {
        this.aiConfig = config;
    }

    /**
     * 从 localStorage 获取 AI 配置
     */
    private getAIConfigFromStorage(): AIServiceConfig | null {
        const provider = localStorage.getItem('ai_provider') as 'gemini' | 'deepseek' || 'gemini';
        const apiKey = provider === 'gemini'
            ? localStorage.getItem('gemini_api_key')
            : localStorage.getItem('deepseek_api_key');
        const model = provider === 'gemini'
            ? localStorage.getItem('gemini_model') || 'gemini-1.5-flash'
            : localStorage.getItem('deepseek_model') || 'deepseek-chat';

        if (!apiKey) return null;
        return { provider, apiKey, model };
    }

    /**
     * 处理新加入的文件：计算 Hash -> 查重 -> (如果不是重复) 触发 AI 分析
     */
    public async processFiles(fileIds: string[]) {
        const store = useStagingStore.getState();
        const filesToProcess = store.files.filter(f => fileIds.includes(f.id));

        // 获取 AI 配置
        const config = this.aiConfig || this.getAIConfigFromStorage();

        // 1. 加载现有索引用于查重
        let existingHashes: Set<string> = new Set();
        let existingCategories: string[] = [];
        try {
            const rawData = await storage.loadAllItems();
            if (rawData && !Array.isArray(rawData) && (rawData as any).version === '3.0') {
                const metadata = rawData as unknown as FileMetadataV3;
                if (metadata.files) {
                    existingHashes = new Set(Object.keys(metadata.files));
                    // 🔧 P0 修复：从 v3.0 格式提取分类
                    existingCategories = [...new Set(
                        Object.values(metadata.files)
                            .map((f: any) => f.category || (f.ai && f.ai.category))
                            .filter(Boolean)
                    )];
                }
            } else if (Array.isArray(rawData)) {
                // v1/v2 数组格式，提取现有分类
                existingCategories = [...new Set(rawData.map((item: any) => item.category).filter(Boolean))];
            }
        } catch (e) {
            console.warn('Failed to load metadata for duplicate check', e);
        }

        // 🔧 新增：从实际文件夹结构提取分类
        try {
            const rootPath = storage.isElectron
                ? localStorage.getItem('electron_root_path')
                : null;

            console.log('📂 [BatchProcessor] 检查文件夹结构...');
            console.log('📂 [BatchProcessor] rootPath:', rootPath);
            console.log('📂 [BatchProcessor] isElectron:', storage.isElectron);
            console.log('📂 [BatchProcessor] hasAPI:', !!window.electronAPI?.scanDirectory);

            if (rootPath && window.electronAPI?.scanDirectory) {
                console.log('📂 [BatchProcessor] 开始扫描目录:', rootPath);
                const result = await window.electronAPI.scanDirectory(rootPath);
                console.log('📂 [BatchProcessor] 扫描结果:', {
                    success: result.success,
                    hasData: !!result.data,
                    dataType: result.data?.type,
                    childrenCount: result.data?.children?.length
                });

                if (result.success && result.data) {
                    // 递归提取所有文件夹名称
                    const extractFolders = (node: any, isRoot: boolean = true): string[] => {
                        console.log('📂 [extractFolders] 处理节点:', {
                            name: node.name,
                            type: node.type,
                            isRoot,
                            childrenCount: node.children?.length || 0
                        });

                        if (node.type !== 'directory') return [];

                        const folders: string[] = [];

                        // 如果不是根目录，则添加当前文件夹为分类
                        if (!isRoot) {
                            folders.push(node.name);
                            console.log('📂 [extractFolders] 添加分类:', node.name);
                        }

                        // 递归处理子文件夹
                        if (node.children) {
                            for (const child of node.children) {
                                if (child.type === 'directory') {
                                    const childFolders = extractFolders(child, false);
                                    // 对于非根目录的子文件夹，添加完整路径
                                    if (!isRoot) {
                                        folders.push(...childFolders.map(f => `${node.name}/${f}`));
                                    } else {
                                        folders.push(...childFolders);
                                    }
                                }
                            }
                        }

                        return folders;
                    };

                    const folderCategories = extractFolders(result.data);
                    console.log('📂 [BatchProcessor] 从文件夹结构提取的分类:', folderCategories);

                    // 合并：index.json 分类 + 文件夹分类
                    existingCategories = [...new Set([...existingCategories, ...folderCategories])];
                }
            } else {
                console.log('📂 [BatchProcessor] 跳过文件夹扫描 - 条件不满足');
            }
        } catch (e) {
            console.warn('Failed to extract categories from folder structure', e);
        }

        // 🔧 优化严格模式：不强制使用默认分类
        // 如果没有历史分类，严格模式下文件将被放在根目录，仅添加标签和摘要
        console.log('📋 [BatchProcessor] 最终历史分类列表:', existingCategories);

        // 2. 处理每个文件
        for (const file of filesToProcess) {
            if (file.status !== 'pending') continue;

            try {
                store.updateFileStatus(file.id, 'analyzing');

                // 计算 MD5
                const hash = await calculateFileHash(file.file);
                store.updateFileHash(file.id, hash);

                // 查重
                if (existingHashes.has(hash)) {
                    store.updateFileStatus(file.id, 'duplicate');

                    // 🔧 修复问题 4：增强去重检测，区分完全重复和同内容不同名
                    // 查找已存在的同 hash 文件信息
                    const rawData = await storage.loadAllItems();
                    let existingFileName = '未知文件';
                    if (rawData && !Array.isArray(rawData) && (rawData as any).version === '3.0') {
                        const existingFile = (rawData as any).files[hash];
                        if (existingFile) {
                            existingFileName = existingFile.originalName || existingFile.fileName || '未知文件';
                        }
                    }

                    const isSameName = existingFileName === file.file.name;

                    store.updateFileProposal(file.id, {
                        targetPath: '已存在/跳过',
                        summary: isSameName
                            ? `文件完全重复（同名同内容）`
                            : `发现同内容不同名文件：已有 "${existingFileName}"，建议统一命名`,
                        tags: isSameName ? ['完全重复'] : ['内容重复', '不同文件名'],
                        reasoning: isSameName
                            ? 'MD5 Hash 完全一致：文件名和内容都相同。'
                            : `MD5 Hash 一致但文件名不同：当前 "${file.file.name}" vs 已有 "${existingFileName}"`,
                        confidence: 1.0
                    });
                    continue;
                }

                // 非重复，触发 AI 分析
                if (config) {
                    const content = await readFileContent(file.file);

                    // 🔧 严格模式：必须从历史分类中选择；灵活模式：可创建新分类
                    const taxonomyConfig = taxonomyService.getConfig();

                    console.log('📋 [严格模式] ========== 开始分析 ==========');
                    console.log('📋 [严格模式] 文件名:', file.file.name);
                    console.log('📋 [严格模式] 当前模式:', taxonomyConfig.mode);
                    console.log('📋 [严格模式] 历史分类列表:', existingCategories);
                    console.log('📋 [严格模式] 历史分类数量:', existingCategories.length);

                    const categoriesToPass = taxonomyConfig.mode === 'strict'
                        ? existingCategories  // 严格模式：必须从已有分类中选择
                        : [];  // 灵活模式：AI 可自由创建新分类

                    console.log('📋 [严格模式] 传递给 AI 的分类列表:', categoriesToPass);

                    const analysis = await analyzeFile(file.file, config, content, categoriesToPass);

                    console.log('📋 [严格模式] AI 返回的原始分类:', analysis.category);

                    // 根据严格/灵活模式处理分类
                    let finalCategory = analysis.category || '未分类';

                    // 🔧 优化：严格模式下无历史分类时，文件放根目录
                    if (taxonomyConfig.mode === 'strict' && existingCategories.length === 0) {
                        console.log('📋 [严格模式] 无历史分类，文件将放在根目录（不分类）');
                        finalCategory = '';  // 空字符串表示根目录
                    } else if (taxonomyConfig.mode === 'strict' && existingCategories.length > 0) {
                        console.log('📋 [严格模式] ========== 开始后处理 ==========');

                        // Level 1: 精确匹配
                        if (existingCategories.includes(finalCategory)) {
                            console.log('✅ [严格模式] Level 1 - 精确匹配成功');
                            console.log('✅ [严格模式] 直接使用:', finalCategory);
                        } else {
                            console.log('❌ [严格模式] Level 1 - 精确匹配失败');
                            console.log('❌ [严格模式] "' + finalCategory + '" 不在历史分类中');
                            console.log('🔍 [严格模式] 进入 Level 2 - 模糊匹配...');

                            // Level 2: 模糊匹配（相似度阈值 0.3）
                            const bestMatch = taxonomyService.findBestMatch(finalCategory, 0.3);
                            console.log('🔍 [严格模式] Level 2 结果:', {
                                输入: finalCategory,
                                最佳匹配: bestMatch.path,
                                相似度: bestMatch.similarity,
                                阈值: 0.3
                            });

                            if (bestMatch.similarity > 0) {
                                console.log('✅ [严格模式] Level 2 - 模糊匹配成功');
                                console.log('✅ [严格模式] 使用最相似的分类:', bestMatch.path);
                                finalCategory = bestMatch.path;
                            } else {
                                console.log('❌ [严格模式] Level 2 - 模糊匹配失败（相似度不足）');
                                console.log('⚠️ [严格模式] 进入 Level 3 - 强制回退...');

                                // Level 3: 强制回退到第一个历史分类
                                if (existingCategories.length > 0) {
                                    console.log('⚠️ [严格模式] Level 3 - 强制使用第一个历史分类');
                                    console.log('⚠️ [严格模式] 从 "' + finalCategory + '" 回退到 "' + existingCategories[0] + '"');
                                    finalCategory = existingCategories[0];
                                }
                            }
                        }

                        console.log('📋 [严格模式] ========== 处理完成 ==========');
                        console.log('📋 [严格模式] 最终分类:', finalCategory);
                    } else if (taxonomyConfig.mode === 'flexible') {
                        console.log('📋 [灵活模式] 应用深度限制 (maxDepth=' + taxonomyConfig.maxDepth + ')');

                        // 灵活模式：应用深度限制
                        const parts = finalCategory.split('/');
                        if (parts.length > taxonomyConfig.maxDepth) {
                            const truncated = parts.slice(0, taxonomyConfig.maxDepth).join('/');
                            console.log('📋 [灵活模式] 深度超限，截断:', finalCategory, '→', truncated);
                            finalCategory = truncated;
                        } else {
                            console.log('📋 [灵活模式] 深度正常，直接使用:', finalCategory);
                        }
                    }

                    console.log('🎯 [最终结果]', {
                        文件: file.file.name,
                        模式: taxonomyConfig.mode,
                        AI返回: analysis.category,
                        最终分类: finalCategory,
                        摘要预览: analysis.summary?.substring(0, 30) + '...',
                        标签: analysis.tags
                    });
                    console.log(''); // 空行分隔

                    store.updateFileProposal(file.id, {
                        targetPath: finalCategory,
                        summary: analysis.summary || '',
                        tags: analysis.tags || [],
                        reasoning: `${analysis.reasoning || 'AI 自动分析完成'}${taxonomyConfig.mode === 'strict' ? ' (严格模式)' : ' (灵活模式)'}`,
                        confidence: analysis.confidence || 0.8
                    });
                } else {
                    // 无 AI 配置，标记为待人工处理
                    console.warn(`⚠️ [BatchProcessor] 未配置 AI API Key，文件 ${file.file.name} 需要手动分类`);
                    store.updateFileProposal(file.id, {
                        targetPath: '未分类',
                        summary: '⚠️ 未配置 AI API Key！请在设置中配置 Gemini 或 DeepSeek API Key 后重新分析。',
                        tags: ['需配置API'],
                        reasoning: '未检测到 AI 服务配置，请点击右上角设置按钮配置 API Key',
                        confidence: 0
                    });
                }
            } catch (error: any) {
                console.error(`Error processing file ${file.file.name}:`, error);
                store.updateFileStatus(file.id, 'error', error.message);
            }
        }

        // 处理完成后，更新工作流状态
        store.setWorkflowStatus('reviewing');
    }
}

export const batchProcessor = new BatchProcessor();

