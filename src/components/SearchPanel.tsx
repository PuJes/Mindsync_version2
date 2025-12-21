import React, { useState, useMemo } from 'react';
import { Search, Filter, Calendar, Tag, Folder, FileType, X, ChevronDown, ChevronUp } from 'lucide-react';
import { searchService, SearchFilters, SearchResult } from '../services/searchService';
import './SearchPanel.css';

interface SearchPanelProps {
    items: any[];
    onResultClick: (item: any) => void;
}

// 文件类型显示名称
const FILE_TYPE_LABELS: Record<string, string> = {
    doc: '📄 文档',
    spreadsheet: '📊 表格',
    presentation: '📽️ 演示',
    image: '🖼️ 图片',
    code: '💻 代码',
    audio: '🎵 音频',
    video: '🎬 视频',
    archive: '📦 压缩包',
    other: '📁 其他'
};

// 快捷时间范围
const TIME_RANGES = [
    { label: '今天', days: 1 },
    { label: '本周', days: 7 },
    { label: '本月', days: 30 },
    { label: '今年', days: 365 },
    { label: '全部', days: 0 }
];

export const SearchPanel: React.FC<SearchPanelProps> = ({ items, onResultClick }) => {
    const [query, setQuery] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState<SearchFilters>({});
    const [selectedTimeRange, setSelectedTimeRange] = useState('全部');

    // 获取可用的筛选选项
    const filterOptions = useMemo(() => {
        return searchService.getFilterOptions(items);
    }, [items]);

    // 执行搜索
    const results = useMemo(() => {
        if (!query.trim() && !filters.fileTypes?.length && !filters.tags?.length && !filters.categories?.length && !filters.dateRange) {
            return items.map(item => ({ item, score: 1, highlights: [] }));
        }
        return searchService.search(items, { query, filters });
    }, [items, query, filters]);

    // 处理时间范围选择
    const handleTimeRangeSelect = (label: string, days: number) => {
        setSelectedTimeRange(label);
        if (days === 0) {
            setFilters(prev => ({ ...prev, dateRange: undefined }));
        } else {
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - days);
            setFilters(prev => ({ ...prev, dateRange: { start, end } }));
        }
    };

    // 切换文件类型筛选
    const toggleFileType = (type: string) => {
        setFilters(prev => {
            const current = prev.fileTypes || [];
            const updated = current.includes(type)
                ? current.filter(t => t !== type)
                : [...current, type];
            return { ...prev, fileTypes: updated.length > 0 ? updated : undefined };
        });
    };

    // 切换分类筛选
    const toggleCategory = (category: string) => {
        setFilters(prev => {
            const current = prev.categories || [];
            const updated = current.includes(category)
                ? current.filter(c => c !== category)
                : [...current, category];
            return { ...prev, categories: updated.length > 0 ? updated : undefined };
        });
    };

    // 清除所有筛选
    const clearFilters = () => {
        setFilters({});
        setSelectedTimeRange('全部');
    };

    const hasActiveFilters = filters.fileTypes?.length || filters.tags?.length || filters.categories?.length || filters.dateRange;

    return (
        <div className="search-panel">
            {/* 搜索栏 */}
            <div className="search-bar">
                <Search size={18} className="search-icon" />
                <input
                    type="text"
                    placeholder="搜索文件名、标签、摘要..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <button
                    className={`filter-toggle ${showFilters ? 'active' : ''}`}
                    onClick={() => setShowFilters(!showFilters)}
                >
                    <Filter size={16} />
                    {hasActiveFilters && <span className="filter-badge" />}
                </button>
            </div>

            {/* 高级筛选面板 */}
            {showFilters && (
                <div className="filter-panel">
                    {/* 时间范围 */}
                    <div className="filter-section">
                        <div className="filter-label">
                            <Calendar size={14} />
                            <span>时间范围</span>
                        </div>
                        <div className="filter-chips">
                            {TIME_RANGES.map(range => (
                                <button
                                    key={range.label}
                                    className={`chip ${selectedTimeRange === range.label ? 'active' : ''}`}
                                    onClick={() => handleTimeRangeSelect(range.label, range.days)}
                                >
                                    {range.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 文件类型 */}
                    <div className="filter-section">
                        <div className="filter-label">
                            <FileType size={14} />
                            <span>文件类型</span>
                        </div>
                        <div className="filter-chips">
                            {filterOptions.fileTypes.map(type => (
                                <button
                                    key={type}
                                    className={`chip ${filters.fileTypes?.includes(type) ? 'active' : ''}`}
                                    onClick={() => toggleFileType(type)}
                                >
                                    {FILE_TYPE_LABELS[type] || type}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 分类 */}
                    {filterOptions.categories.length > 0 && (
                        <div className="filter-section">
                            <div className="filter-label">
                                <Folder size={14} />
                                <span>分类</span>
                            </div>
                            <div className="filter-chips scrollable">
                                {filterOptions.categories.slice(0, 10).map(category => (
                                    <button
                                        key={category}
                                        className={`chip ${filters.categories?.includes(category) ? 'active' : ''}`}
                                        onClick={() => toggleCategory(category)}
                                    >
                                        {category}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 清除筛选 */}
                    {hasActiveFilters && (
                        <button className="clear-filters" onClick={clearFilters}>
                            <X size={14} /> 清除所有筛选
                        </button>
                    )}
                </div>
            )}

            {/* 搜索结果统计 */}
            <div className="search-stats">
                找到 <strong>{results.length}</strong> 个结果
                {query && <span className="query-badge">"{query}"</span>}
            </div>

            {/* 结果列表 */}
            <div className="search-results">
                {results.map((result, index) => (
                    <div
                        key={result.item.id || index}
                        className="result-card"
                        onClick={() => onResultClick(result.item)}
                    >
                        <div className="result-header">
                            <span className="result-name">{result.item.fileName}</span>
                            {result.score > 0 && query && (
                                <span className="score-badge">匹配度 {Math.min(100, Math.round(result.score * 10))}%</span>
                            )}
                        </div>
                        <p className="result-summary">{result.item.summary || '无摘要'}</p>
                        <div className="result-meta">
                            <span className="result-category">{result.item.category}</span>
                            {result.item.tags?.slice(0, 3).map((tag: string, i: number) => (
                                <span key={i} className="result-tag">{tag}</span>
                            ))}
                        </div>
                        {/* 高亮匹配 */}
                        {result.highlights.length > 0 && (
                            <div className="result-highlights">
                                {result.highlights.slice(0, 2).map((h, i) => (
                                    <span key={i} className={`highlight-${h.field}`}>
                                        {h.text}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
