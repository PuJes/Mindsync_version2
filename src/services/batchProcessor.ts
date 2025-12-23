import { useStagingStore, StagedFile } from '../store/stagingStore';
import { calculateFileHash } from '../utils/fileHash';
import { storage } from '../utils/fileStorage';
import { FileMetadataV3 } from '../types/metadata.v3';
import { taxonomyService } from './taxonomyService';
import { analyzeManifest, analyzeWithSupplements, AIServiceConfig } from './aiService';
import { ManifestItem } from '../types/metadata.v3';

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

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(undefined);
        reader.readAsText(file);
    });
}

// 读取文件为 Base64 (用于 Vision / 图片分析)
// 读取文件为 Base64 (用于 Vision / 图片分析)
async function readFileAsBase64(file: File): Promise<string> {
    // 1. Electron 环境下且有 path 属性 (Mock File from Smart Organize)
    if (storage.isElectron && (file as any).path && window.electronAPI?.readBinary) {
        try {
            const result = await window.electronAPI.readBinary((file as any).path);
            if (result.success && result.data) {
                return result.data; // 直接返回 Base64
            }
        } catch (e) {
            console.warn('Failed to read binary via Electron IPC', e);
        }
    }

    // 2. Web 环境或 fallback
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data:xxx;base64, prefix
            const base64 = result.split(',')[1] || result;
            resolve(base64);
        };
        reader.onerror = () => reject(new Error("Failed to read file as Base64"));
        reader.readAsDataURL(file);
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
            ? localStorage.getItem('gemini_model') || 'gemini-2.0-flash-exp'
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
            // 🔧 修复：使用 loadRawMetadata 获取原始 v3.0 格式
            const rawData = storage.loadRawMetadata
                ? await storage.loadRawMetadata()
                : await storage.loadAllItems();

            console.log('📂 [BatchProcessor] Loaded metadata:', {
                hasData: !!rawData,
                isArray: Array.isArray(rawData),
                version: rawData?.version,
                fileCount: rawData?.files ? Object.keys(rawData.files).length : 0
            });

            if (rawData && !Array.isArray(rawData) && rawData.version === '3.0') {
                const metadata = rawData as unknown as FileMetadataV3;
                if (metadata.files) {
                    existingHashes = new Set(Object.keys(metadata.files));
                    // 🔧 P0 修复：从 v3.0 格式提取分类
                    existingCategories = [...new Set(
                        Object.values(metadata.files)
                            .map((f: any) => f.category || (f.ai && f.ai.category))
                            .filter(Boolean)
                    )];
                    console.log('📂 [BatchProcessor] Extracted from v3.0:', {
                        hashCount: existingHashes.size,
                        categoryCount: existingCategories.length
                    });
                }
            } else if (Array.isArray(rawData)) {
                // v1/v2 数组格式，提取现有分类
                existingCategories = [...new Set(rawData.map((item: any) => item.category).filter(Boolean))];
                console.log('📂 [BatchProcessor] Extracted from array format:', { categoryCount: existingCategories.length });
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

        // 2. 预处理：计算 Hash & 准备 Manifest
        const manifestItems: ManifestItem[] = [];
        const filesToAnalyze: StagedFile[] = [];

        for (const file of filesToProcess) {
            if (file.status !== 'pending') continue;

            try {
                store.updateFileStatus(file.id, 'analyzing');

                // 计算 MD5
                const hash = await calculateFileHash(file.file);
                store.updateFileHash(file.id, hash);

                // 🔧 如果是重新分析，跳过重复检测
                if (file.isReanalysis) {
                    console.log(`🔄 [BatchProcessor] 跳过重复检测（重新分析模式）: ${file.file.name}`);
                } else if (existingHashes.has(hash)) {
                    // 查重（仅对新文件）
                    store.updateFileStatus(file.id, 'duplicate');

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

                // 非重复，加入待分析列表
                manifestItems.push({
                    id: file.id,
                    name: file.file.name,
                    size: file.file.size,
                    mimeType: file.file.type
                });
                filesToAnalyze.push(file);

            } catch (error: any) {
                console.error(`Error processing file ${file.file.name}:`, error);
                store.updateFileStatus(file.id, 'error', error.message);
            }
        }

        if (filesToAnalyze.length === 0) {
            store.setWorkflowStatus('reviewing');
            return;
        }

        // 3. Phase 1: 批量元数据分析 (Manifest Analysis)
        if (config) {
            try {
                const taxonomyConfig = taxonomyService.getConfig();
                // 严格模式传递分类，灵活模式传递空 (或也传递以供参考)
                const categoriesToPass = existingCategories;

                console.log('🚀 [BatchProcessor] Phase 1 - Sending Manifest:', manifestItems.length, 'files');
                console.log('🚀 [BatchProcessor] Categories:', categoriesToPass);
                console.log('🚀 [BatchProcessor] Taxonomy Config:', taxonomyConfig);

                const protocolResponse = await analyzeManifest(manifestItems, config, categoriesToPass, taxonomyConfig);
                console.log('🚀 [BatchProcessor] Phase 1 Result:', protocolResponse);

                // 4. Phase 2: 处理每个文件的指令
                let deepSeekVisionAlertShown = false; // Flag to prevent multiple alerts

                for (const file of filesToAnalyze) {
                    try {
                        const instruction = protocolResponse.items[file.id];
                        if (!instruction) {
                            console.warn(`⚠️ No instruction for file ${file.id}`);
                            continue;
                        }

                        let finalAnalysis: any = null;

                        if (instruction.instruction === 'Direct') {
                            console.log(`✅ [${file.file.name}] Phase 1 Direct Hit`);
                            finalAnalysis = {
                                category: instruction.category,
                                summary: instruction.summary,
                                tags: instruction.tags,
                                reasoning: instruction.reasoning,
                                confidence: instruction.confidence
                            };
                        } else if (instruction.instruction === 'Need_Info') {
                            console.log(`🔍 [${file.file.name}] Phase 2 Need Info:`, instruction.requestType);

                            // 获取补充内容
                            let supplementContent = '';
                            // 🔧 P0: 检查是否为 PDF (不依赖 requestType，自动检测)
                            const isPdf = file.file.name.toLowerCase().endsWith('.pdf');

                            if (instruction.requestType === 'image_vision' || isPdf) {
                                // 图片或 PDF 都作为二进制 Base64 读取
                                supplementContent = await readFileAsBase64(file.file);
                            } else {
                                // default to text preview (first 5KB)
                                const fullText = await readFileContent(file.file);
                                supplementContent = fullText ? fullText.substring(0, 8000) : '';
                            }

                            // 二次分析
                            // 🔧 修复：如果无法读取文本内容（如视频、音频、无法解析的二进制），构造元数据描述替代
                            // 注意：PDF 读取失败也会进入这里 (supplementContent 为空时)
                            if (!supplementContent && instruction.requestType !== 'image_vision' && !isPdf) {
                                console.log(`⚠️ [${file.file.name}] Content not readable, using metadata fallback.`);
                                supplementContent = `[系统提示]: 该文件 (${file.file.type || '未知格式'}) 无法读取文本内容。请仅根据文件名 "${file.file.name}" 和文件类型进行分类。`;
                            }

                            if (supplementContent) {
                                finalAnalysis = await analyzeWithSupplements(
                                    file.file,
                                    supplementContent,
                                    // 如果是 PDF，传递 'pdf_document' 类型，否则透传原有类型
                                    isPdf ? 'pdf_document' : (instruction.requestType || 'text_preview'),
                                    config,
                                    categoriesToPass,
                                    taxonomyConfig
                                );
                            } else {
                                // 只有图片读取失败（supplementContent仍为空）才会走到这里
                                console.warn(`⚠️ [${file.file.name}] Failed to read content for Phase 2`);
                                finalAnalysis = {
                                    category: '/_Unclassified',
                                    summary: '无法读取文件内容进行深入分析',
                                    tags: ['读取失败'],
                                    reasoning: 'Phase 2 Content Read Failed',
                                    confidence: 0
                                };
                            }
                        }

                        // 应用分类规则（严格/灵活模式后处理）
                        if (finalAnalysis) {
                            this.applyAnalysisResult(file, finalAnalysis, store, existingCategories);
                        }

                    } catch (err: any) {
                        console.error(`❌ [${file.file.name}] Analysis Failed:`, err);

                        // 1. 通用模型不支持错误处理 (Vision, PDF, etc.)
                        // 匹配关键字: "不支持", "not support"
                        const errorMessage = err.message || '';
                        if (errorMessage.includes('不支持') || errorMessage.toLowerCase().includes('not support')) {
                            const isDeepSeek = errorMessage.toLowerCase().includes('deepseek');

                            store.updateFileProposal(file.id, {
                                targetPath: '未分类/Error',
                                summary: `⚠️ 模型不支持此文件类型: ${errorMessage}`,
                                tags: ['模型不支持', isDeepSeek ? 'DeepSeek' : 'Compat'],
                                reasoning: `Model Capability Limit: ${errorMessage}`,
                                confidence: 0
                            });

                            if (!deepSeekVisionAlertShown) {
                                alert(`⚠️ 当前模型不支持某些文件分析\n\n原因: ${errorMessage}\n\n建议前往设置切换至 Gemini Pro Vision 或其他更强大的模型。`);
                                deepSeekVisionAlertShown = true;
                            }
                        } else {
                            // 2. 其他错误
                            store.updateFileStatus(file.id, 'error', `Analysis Error: ${err.message}`);
                        }
                    }
                }

            } catch (e: any) {
                console.error('❌ [BatchProcessor] Critical Batch Failure:', e);
                // 仅针对未处理的文件进行 fallback
                // ... (由于 loop 内已有 try-catch，这里主要是捕获 loop 外的 analyzeManifest 错误)

                for (const file of filesToAnalyze) {
                    store.updateFileStatus(file.id, 'error', `AI Analysis Failed: ${e.message}`);
                }
            }
        } else {
            // 无 API Key
            for (const file of filesToAnalyze) {
                store.updateFileProposal(file.id, {
                    targetPath: '未分类',
                    summary: '⚠️ 未配置 AI API Key',
                    tags: ['需配置API'],
                    reasoning: '未检测到 AI 服务配置',
                    confidence: 0
                });
            }
        }

        // 处理完成后，更新工作流状态
        store.setWorkflowStatus('reviewing');
    }

    /**
     * 应用 AI 分析结果并执行分类规则（严格/灵活模式）
     */
    private applyAnalysisResult(file: StagedFile, analysis: any, store: any, existingCategories: string[]) {
        const taxonomyConfig = taxonomyService.getConfig();
        let finalCategory = analysis.category || '未分类';
        const originalAISuggestion = finalCategory; // 保存原始建议用于纠正学习

        console.log(`📋 [${file.file.name}] Applying Rules (${taxonomyConfig.mode}). Raw Category: ${finalCategory}`);

        // 0. 检查用户纠正历史 - 如果有历史纠正，优先应用
        const correction = taxonomyService.findApplicableCorrection(file.file.name);
        if (correction) {
            console.log(`🔄 [${file.file.name}] Applying learned correction: ${finalCategory} → ${correction.userChosen}`);
            finalCategory = correction.userChosen;
            // 跳过后续处理，直接使用用户历史选择
            store.updateFileProposal(file.id, {
                targetPath: finalCategory.replace(/^\/+/, '').replace(/\/+$/, ''),
                summary: analysis.summary || '',
                tags: analysis.tags || [],
                reasoning: `📝 基于历史纠正自动应用 (原建议: ${originalAISuggestion})`,
                confidence: 0.95
            });
            return;
        }

        // 1. 强制深度限制 (maxDepth) - 两种模式都适用
        const parts = finalCategory.replace(/^\/+/, '').split('/').filter(Boolean);
        if (parts.length > taxonomyConfig.maxDepth) {
            const truncated = parts.slice(0, taxonomyConfig.maxDepth).join('/');
            console.log(`✂️ [${file.file.name}] Depth limit (${taxonomyConfig.maxDepth}): ${finalCategory} → ${truncated}`);
            finalCategory = truncated;
        }

        // 1.5 词汇表检查 - 如果不在词汇表中，尝试匹配最接近的
        if (!taxonomyService.isInVocabulary(finalCategory)) {
            const vocab = taxonomyConfig.categoryVocabulary || [];
            if (vocab.length > 0) {
                const bestVocabMatch = taxonomyService.findBestMatch(finalCategory, 0.2);
                if (vocab.some(v => bestVocabMatch.path.includes(v) || v.includes(bestVocabMatch.path.split('/')[0]))) {
                    console.log(`📚 [${file.file.name}] Vocabulary enforcement: ${finalCategory} → ${bestVocabMatch.path}`);
                    finalCategory = bestVocabMatch.path;
                }
            }
        }

        // 2. 强制同级数量限制 (maxChildren) - 仅灵活模式需要检查
        if (taxonomyConfig.mode === 'flexible' && parts.length > 0) {
            const parentPath = parts.slice(0, -1).join('/') || ''; // 父路径
            const siblingCategories = existingCategories.filter(cat => {
                const catParts = cat.replace(/^\/+/, '').split('/').filter(Boolean);
                const catParent = catParts.slice(0, -1).join('/');
                return catParent === parentPath;
            });

            // 如果当前分类不在已有分类中，检查是否超出限制
            if (!existingCategories.includes(finalCategory) && !existingCategories.includes('/' + finalCategory)) {
                if (siblingCategories.length >= taxonomyConfig.maxChildren) {
                    // 超出限制，强制归入最相似的已有分类
                    const bestMatch = taxonomyService.findBestMatch(finalCategory, 0.2);
                    console.log(`⚠️ [${file.file.name}] MaxChildren limit (${taxonomyConfig.maxChildren}): ${finalCategory} → ${bestMatch.path}`);
                    finalCategory = bestMatch.path.replace(/^\/+/, '');
                }
            }
        }

        if (taxonomyConfig.mode === 'strict') {
            // 严格模式逻辑
            if (existingCategories.length === 0) {
                finalCategory = ''; // Root
            } else if (existingCategories.includes(finalCategory) || existingCategories.includes('/' + finalCategory)) {
                // Exact match
            } else {
                // Fuzzy Match
                const bestMatch = taxonomyService.findBestMatch(finalCategory, 0.3);
                if (bestMatch.similarity > 0) {
                    finalCategory = bestMatch.path;
                } else {
                    finalCategory = existingCategories[0] || '';
                }
            }
        }

        // Remove leading/trailing slashes for clean path
        finalCategory = finalCategory.replace(/^\/+/, '').replace(/\/+$/, '');

        store.updateFileProposal(file.id, {
            targetPath: finalCategory,
            summary: analysis.summary || '',
            tags: analysis.tags || [],
            reasoning: analysis.reasoning || 'AI Analysis',
            confidence: analysis.confidence || 0.8
        });
    }
}

export const batchProcessor = new BatchProcessor();

