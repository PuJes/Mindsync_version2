import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock the scan function from electron/main.ts
const scanDirectoryRecursive = (dirPath) => {
    const results = {
        name: path.basename(dirPath),
        path: dirPath,
        type: 'directory',
        children: []
    };

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // Filter hidden files
            if (entry.name.startsWith('.')) continue;

            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                // Recursively scan children
                results.children.push(scanDirectoryRecursive(fullPath));
            } else {
                results.children.push({
                    name: entry.name,
                    path: fullPath,
                    type: 'file'
                });
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error);
    }

    return results;
};

// Create a test directory structure
const testRootDir = path.join(__dirname, 'test_scan_root');

const setupTestEnv = () => {
    if (fs.existsSync(testRootDir)) {
        fs.rmSync(testRootDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testRootDir);
    fs.mkdirSync(path.join(testRootDir, 'folder_a'));
    fs.writeFileSync(path.join(testRootDir, 'folder_a', 'file1.txt'), 'content');
    fs.mkdirSync(path.join(testRootDir, 'folder_b'));
    fs.mkdirSync(path.join(testRootDir, 'folder_b', 'subfolder'));
    fs.writeFileSync(path.join(testRootDir, 'folder_b', 'subfolder', 'file2.md'), 'content');
    fs.writeFileSync(path.join(testRootDir, 'root_file.pdf'), 'content');

    console.log('Test environment created at:', testRootDir);
};

const runTest = () => {
    setupTestEnv();
    console.log('Scanning directory...');
    const tree = scanDirectoryRecursive(testRootDir);
    console.log(JSON.stringify(tree, null, 2));

    // Basic verification
    const hasFolderA = tree.children.find(c => c.name === 'folder_a');
    const hasFolderB = tree.children.find(c => c.name === 'folder_b');
    const hasRootFile = tree.children.find(c => c.name === 'root_file.pdf');

    if (hasFolderA && hasFolderB && hasRootFile && hasFolderB.children[0].children[0].name === 'file2.md') {
        console.log('✅ Verification Passed: Structure matches expected output.');
    } else {
        console.error('❌ Verification Failed: Structure does not match.');
    }

    // Cleanup
    // fs.rmSync(testRootDir, { recursive: true, force: true });
};

runTest();
