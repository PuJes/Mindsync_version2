// 搜索结果接口
export interface SearchResult {
    item: any; // KnowledgeItem
    score: number;
    highlights: {
        field: 'fileName' | 'tags' | 'summary' | 'category';
        text: string;
    }[];
}

export interface SearchFilters {
    dateRange?: { start: Date; end: Date };
    fileTypes?: string[]; // ['doc', 'pdf', 'image', 'code', 'other']
    tags?: string[];
    categories?: string[];
}

export interface SearchOptions {
    query: string;
    filters?: SearchFilters;
    limit?: number;
}

// PRD 定义的权重
const WEIGHTS = {
    fileName: 1.0,
    tags: 0.8,
    summary: 0.6,
    category: 0.4
};

// 文件类型分组
const FILE_TYPE_GROUPS: Record<string, string[]> = {
    doc: ['txt', 'md', 'doc', 'docx', 'pdf', 'rtf'],
    spreadsheet: ['csv', 'xlsx', 'xls'],
    presentation: ['ppt', 'pptx'],
    image: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'],
    code: ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'html', 'css', 'json'],
    audio: ['mp3', 'wav', 'flac', 'aac'],
    video: ['mp4', 'mov', 'avi', 'mkv'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz']
};

export class SearchService {
    /**
     * 获取文件类型分组
     */
    private getFileTypeGroup(fileName: string): string {
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        for (const [group, extensions] of Object.entries(FILE_TYPE_GROUPS)) {
            if (extensions.includes(ext)) return group;
        }
        return 'other';
    }

    /**
     * 计算单个 item 的相关性分数
     */
    public calculateScore(item: any, query: string): { score: number; highlights: SearchResult['highlights'] } {
        if (!query.trim()) return { score: 1, highlights: [] };

        const lowerQuery = query.toLowerCase();
        let score = 0;
        const highlights: SearchResult['highlights'] = [];

        // 文件名匹配（权重最高）
        if (item.fileName?.toLowerCase().includes(lowerQuery)) {
            score += WEIGHTS.fileName * 10;
            highlights.push({ field: 'fileName', text: item.fileName });
        }

        // 标签匹配
        const matchedTags = (item.tags || []).filter((t: string) =>
            t.toLowerCase().includes(lowerQuery)
        );
        if (matchedTags.length > 0) {
            score += WEIGHTS.tags * matchedTags.length * 5;
            matchedTags.forEach((t: string) => highlights.push({ field: 'tags', text: t }));
        }

        // 摘要匹配
        if (item.summary?.toLowerCase().includes(lowerQuery)) {
            score += WEIGHTS.summary * 3;
            // 提取匹配上下文
            const idx = item.summary.toLowerCase().indexOf(lowerQuery);
            const start = Math.max(0, idx - 20);
            const end = Math.min(item.summary.length, idx + query.length + 20);
            highlights.push({ field: 'summary', text: '...' + item.summary.slice(start, end) + '...' });
        }

        // 分类匹配
        if (item.category?.toLowerCase().includes(lowerQuery)) {
            score += WEIGHTS.category * 2;
            highlights.push({ field: 'category', text: item.category });
        }

        return { score, highlights };
    }

    /**
     * 执行高级搜索
     */
    public search(items: any[], options: SearchOptions): SearchResult[] {
        const { query, filters, limit = 50 } = options;

        // 1. 应用过滤器
        let filtered = items.filter(item => {
            // 文件类型过滤
            if (filters?.fileTypes && filters.fileTypes.length > 0) {
                const itemGroup = this.getFileTypeGroup(item.fileName || '');
                if (!filters.fileTypes.includes(itemGroup)) return false;
            }

            // 标签过滤（AND 逻辑）
            if (filters?.tags && filters.tags.length > 0) {
                const hasAllTags = filters.tags.every(tag =>
                    (item.tags || []).some((t: string) => t.toLowerCase() === tag.toLowerCase())
                );
                if (!hasAllTags) return false;
            }

            // 分类过滤
            if (filters?.categories && filters.categories.length > 0) {
                if (!filters.categories.includes(item.category)) return false;
            }

            // 日期范围过滤
            if (filters?.dateRange) {
                const itemDate = new Date(item.addedAt);
                if (itemDate < filters.dateRange.start || itemDate > filters.dateRange.end) {
                    return false;
                }
            }

            return true;
        });

        // 2. 计算分数并排序
        const results: SearchResult[] = filtered.map(item => {
            const { score, highlights } = this.calculateScore(item, query);
            return { item, score, highlights };
        });

        // 3. 按分数降序排序
        results.sort((a, b) => b.score - a.score);

        // 4. 限制结果数量
        return results.slice(0, limit);
    }

    /**
     * 获取所有可用的筛选选项
     */
    public getFilterOptions(items: any[]): {
        categories: string[];
        tags: string[];
        fileTypes: string[];
    } {
        const categories = new Set<string>();
        const tags = new Set<string>();
        const fileTypes = new Set<string>();

        items.forEach(item => {
            if (item.category) categories.add(item.category);
            (item.tags || []).forEach((t: string) => tags.add(t));
            fileTypes.add(this.getFileTypeGroup(item.fileName || ''));
        });

        return {
            categories: Array.from(categories).sort(),
            tags: Array.from(tags).sort(),
            fileTypes: Array.from(fileTypes).sort()
        };
    }
}

export const searchService = new SearchService();

