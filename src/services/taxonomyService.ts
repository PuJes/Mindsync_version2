import { CategoryNode, TaxonomyConfig, FileMetadataV3 } from '../types/metadata.v3';
import { storage } from '../utils/fileStorage';

// 默认配置
const DEFAULT_CONFIG: TaxonomyConfig = {
    mode: 'strict',
    maxDepth: 3,
    maxChildren: 10,
    ignorePatterns: ['.DS_Store', 'node_modules', '*.tmp', '.git']
};

// 默认分类树
const DEFAULT_TAXONOMY_ROOT: CategoryNode[] = [
    { id: 'work', name: 'Work', path: '/Work', children: [] },
    { id: 'life', name: 'Life', path: '/Life', children: [] },
    { id: 'archive', name: 'Archive', path: '/Archive', children: [] },
    { id: 'unclassified', name: '_Unclassified', path: '/_Unclassified', children: [] }
];

// localStorage 键名
const CONFIG_STORAGE_KEY = 'taxonomy_config';

export class TaxonomyService {
    private config: TaxonomyConfig;
    private root: CategoryNode[];

    constructor(metadata?: FileMetadataV3) {
        // 优先从 localStorage 加载配置
        const savedConfig = this.loadConfigFromStorage();

        if (metadata) {
            this.config = savedConfig || metadata.config;
            this.root = metadata.taxonomy.root;
        } else {
            this.config = savedConfig || { ...DEFAULT_CONFIG };
            this.root = JSON.parse(JSON.stringify(DEFAULT_TAXONOMY_ROOT));
        }
    }

    /**
     * 从 localStorage 加载配置
     */
    private loadConfigFromStorage(): TaxonomyConfig | null {
        try {
            const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    }

    /**
     * 保存配置到 localStorage
     */
    private saveConfigToStorage(): void {
        try {
            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.config));
        } catch (e) {
            console.warn('Failed to save taxonomy config', e);
        }
    }

    /**
     * 更新配置
     */
    public updateConfig(newConfig: Partial<TaxonomyConfig>): void {
        this.config = { ...this.config, ...newConfig };
        this.saveConfigToStorage();
    }

    /**
     * 获取当前的分类树
     */
    public getRoot(): CategoryNode[] {
        return this.root;
    }

    /**
     * 获取当前配置（每次从 localStorage 重新加载以确保获取最新值）
     */
    public getConfig(): TaxonomyConfig {
        // 🔧 修复：每次都从 localStorage 读取，确保获取用户最新设置
        const savedConfig = this.loadConfigFromStorage();
        if (savedConfig) {
            this.config = savedConfig;
        }
        console.log('🔧 [TaxonomyService] getConfig:', this.config);
        return this.config;
    }

    /**
     * 获取所有可用的分类路径（扁平化）
     */
    public getAllCategoryPaths(): string[] {
        const paths: string[] = [];
        const traverse = (nodes: CategoryNode[]) => {
            nodes.forEach(node => {
                paths.push(node.path);
                if (node.children?.length) {
                    traverse(node.children);
                }
            });
        };
        traverse(this.root);
        return paths;
    }

    /**
     * 计算文本相似度（简单版 Jaccard）
     */
    private calculateSimilarity(text1: string, text2: string): number {
        const words1 = new Set(text1.toLowerCase().split(/[\s\/]+/));
        const words2 = new Set(text2.toLowerCase().split(/[\s\/]+/));

        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);

        return union.size > 0 ? intersection.size / union.size : 0;
    }

    /**
     * 找到最相似的已有分类
     */
    public findBestMatch(suggestedPath: string, threshold: number = 0.3): { path: string; similarity: number } {
        const allPaths = this.getAllCategoryPaths();
        let bestMatch = { path: '/_Unclassified', similarity: 0 };

        for (const path of allPaths) {
            const similarity = this.calculateSimilarity(suggestedPath, path);
            if (similarity > bestMatch.similarity) {
                bestMatch = { path, similarity };
            }
        }

        // 如果最佳匹配低于阈值，返回未分类
        if (bestMatch.similarity < threshold) {
            return { path: '/_Unclassified', similarity: 0 };
        }

        return bestMatch;
    }

    /**
     * 根据 AI 的建议路径，决定最终的目标路径
     */
    public resolvePath(suggestedPath: string): string {
        const normalizedPath = suggestedPath.replace(/^\/+/, '').replace(/\/+$/, '');
        const parts = normalizedPath.split('/');

        // Flexible 模式：直接采纳（检查深度）
        if (this.config.mode === 'flexible') {
            return this.enforceDepthLimit(normalizedPath);
        }

        // Strict 模式：必须匹配现有目录树
        const match = this.findMatchingNode(parts, this.root);

        if (match.exact) {
            return match.path;
        } else {
            // 尝试找最相似的分类
            const similar = this.findBestMatch(suggestedPath);
            return similar.path;
        }
    }

    /**
     * 辅助方法：在树中查找匹配节点
     */
    private findMatchingNode(pathParts: string[], nodes: CategoryNode[], currentPathStr: string = ''): { exact: boolean, path: string } {
        if (pathParts.length === 0) {
            return { exact: true, path: currentPathStr };
        }

        const [head, ...tail] = pathParts;
        const node = nodes.find(n => n.name.toLowerCase() === head.toLowerCase());

        if (node) {
            return this.findMatchingNode(tail, node.children || [], node.path);
        } else {
            return { exact: false, path: currentPathStr };
        }
    }

    /**
     * 强制深度限制
     */
    private enforceDepthLimit(path: string): string {
        const parts = path.split('/');
        if (parts.length > this.config.maxDepth) {
            return parts.slice(0, this.config.maxDepth).join('/');
        }
        return path;
    }

    /**
     * 添加新分类到根目录
     */
    public addCategory(name: string, parentPath?: string): boolean {
        // 检查子项数量限制
        const targetNodes = parentPath ? this.findNodeByPath(parentPath)?.children : this.root;
        if (!targetNodes) return false;

        if (targetNodes.length >= this.config.maxChildren) {
            console.warn('Max children limit reached');
            return false;
        }

        const newNode: CategoryNode = {
            id: `cat_${Date.now()}`,
            name,
            path: parentPath ? `${parentPath}/${name}` : `/${name}`,
            children: []
        };

        targetNodes.push(newNode);
        return true;
    }

    /**
     * 根据路径查找节点
     */
    private findNodeByPath(path: string): CategoryNode | null {
        const parts = path.replace(/^\/+/, '').split('/');
        let current: CategoryNode[] = this.root;
        let found: CategoryNode | null = null;

        for (const part of parts) {
            found = current.find(n => n.name.toLowerCase() === part.toLowerCase()) || null;
            if (!found) return null;
            current = found.children || [];
        }

        return found;
    }

    /**
     * 检查文件是否应该被忽略
     */
    public shouldIgnore(filename: string): boolean {
        return this.config.ignorePatterns.some(pattern => {
            if (pattern.startsWith('*.')) {
                return filename.endsWith(pattern.slice(1));
            }
            return filename === pattern || filename.includes(pattern);
        });
    }

    /**
     * 添加忽略规则
     */
    public addIgnorePattern(pattern: string): void {
        if (!this.config.ignorePatterns.includes(pattern)) {
            this.config.ignorePatterns.push(pattern);
            this.saveConfigToStorage();
        }
    }

    /**
     * 移除忽略规则
     */
    public removeIgnorePattern(pattern: string): void {
        this.config.ignorePatterns = this.config.ignorePatterns.filter(p => p !== pattern);
        this.saveConfigToStorage();
    }
}

// 导出默认实例
export const taxonomyService = new TaxonomyService();

