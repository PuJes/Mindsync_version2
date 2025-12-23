export interface CategoryNode {
    id: string;
    name: string;
    path: string; // 完整路径，例如 /Work/Projects
    children?: CategoryNode[];
    description?: string;
}

export interface TaxonomyConfig {
    mode: 'strict' | 'flexible'; // 严格模式 | 灵活模式
    maxDepth: number;     // 最大深度
    maxChildren: number;  // 单层最大子项
    ignorePatterns: string[]; // 忽略名单
    // 新增: 目标分类数量控制
    targetCategoryCount?: number; // 期望的分类数量 (e.g., 5-10)
    // 新增: 强制深度分析模式
    forceDeepAnalysis?: boolean; // 如果为 true，强制 Phase 2 分析所有文件
    // 新增: 分类词汇表
    categoryVocabulary?: string[]; // 允许的分类名称列表
    // 新增: 分类语言
    categoryLanguage?: 'zh' | 'en' | 'auto'; // 中文 | 英文 | 自动
}

// 新增: 用户纠正学习记录
export interface CorrectionRecord {
    aiSuggested: string;  // AI 建议的分类
    userChosen: string;   // 用户最终选择的分类
    fileName: string;     // 文件名 (用于匹配相似文件)
    timestamp: number;
}

export interface FileMetadataV3 {
    version: "3.0";
    config: TaxonomyConfig;
    taxonomy: {
        root: CategoryNode[];
    };
    // 新增：基于哈希的索引
    files: {
        [fileHash: string]: {
            id: string;
            originalName: string;
            currentPath: string; // 相对 root 的路径
            size: number;
            mtime: number;
            contentHash: string; // MD5

            ai: {
                summary: string;
                tags: string[];
                reasoning: string;
                confidence: number; // 0.0 - 1.0
            };

            userOverride: boolean; // 是否人工修正过
        }
    };
    // 保持兼容性的旧结构映射（可选，或在迁移脚本中处理）
}

// ==========================================
// 3.3 AI 自主决策内容提取协议 (Protocol Types)
// ==========================================

export interface ManifestItem {
    id: string;      // 对应 StagedFile.id
    name: string;    // 文件名
    size: number;    // 文件大小 (bytes)
    mimeType?: string; // 可选，MIME类型
}

export type AIInstructionType = 'Direct' | 'Need_Info';

export interface AIProtocolResponse {
    items: {
        [fileId: string]: {
            instruction: AIInstructionType;
            // 如果 Direct
            category?: string;
            summary?: string;
            tags?: string[];
            reasoning?: string;
            confidence?: number;
            // 如果 Need_Info
            reason?: string; // 为什么需要更多信息
            requestType?: 'text_preview' | 'image_vision' | 'full_text'; // 需要什么
        }
    };
}
