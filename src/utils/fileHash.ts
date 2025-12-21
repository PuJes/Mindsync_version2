import SparkMD5 from 'spark-md5';

import { storage } from './fileStorage';

/**
 * 计算文件的 MD5 哈希
 * 对于大文件（> 10MB），使用分块读取以避免内存溢出
 */
export const calculateFileHash = async (file: File): Promise<string> => {
    // 1. Electron 优化：如果可用，使用主进程计算 Hash（极快且无内存限制）
    if (storage.isElectron && storage.computeHash && (file as any).path) {
        try {
            return await storage.computeHash((file as any).path);
        } catch (e) {
            console.warn("Electron native hash failed, falling back to JS implementation", e);
        }
    }

    // 2. JS 回退方案
    return new Promise((resolve, reject) => {
        const blobSlice = File.prototype.slice || (File.prototype as any).mozSlice || (File.prototype as any).webkitSlice;
        const chunkSize = 2097152; // Read in chunks of 2MB
        const chunks = Math.ceil(file.size / chunkSize);
        let currentChunk = 0;
        const spark = new SparkMD5.ArrayBuffer();
        const fileReader = new FileReader();

        fileReader.onload = function (e) {
            if (!e.target?.result) return;
            spark.append(e.target.result as ArrayBuffer); // Append array buffer
            currentChunk++;

            if (currentChunk < chunks) {
                loadNext();
            } else {
                // Compute hash
                const hash = spark.end();
                resolve(hash);
            }
        };

        fileReader.onerror = function () {
            reject(new Error("文件读取失败"));
        };

        function loadNext() {
            const start = currentChunk * chunkSize;
            const end = ((start + chunkSize) >= file.size) ? file.size : start + chunkSize;

            // 注意：这里我们读取的是本地文件（通过 Electron 或 Input 选择的 File 对象）
            // File 对象在浏览器环境中是指向磁盘文件的引用（在 Electron 中也是类似的封装）
            fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
        }

        loadNext();
    });
};

/**
 * 计算字符串内容的 MD5
 */
export const calculateContentHash = (content: string): string => {
    return SparkMD5.hash(content);
};
