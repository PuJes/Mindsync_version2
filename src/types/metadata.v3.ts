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
