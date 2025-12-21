import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock the move function from electron/main.ts
const movePath = (oldPath, newPath) => {
    try {
        const targetDir = path.dirname(newPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.renameSync(oldPath, newPath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Test directory structure
const testRootDir = path.join(__dirname, 'test_move_root');

const setupTestEnv = () => {
    if (fs.existsSync(testRootDir)) {
        fs.rmSync(testRootDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testRootDir);
    fs.mkdirSync(path.join(testRootDir, 'source_folder'));
    fs.mkdirSync(path.join(testRootDir, 'target_folder'));
    fs.writeFileSync(path.join(testRootDir, 'source_folder', 'move_me.txt'), 'content');

    console.log('Test environment created at:', testRootDir);
};

const runTest = () => {
    setupTestEnv();

    const sourceFile = path.join(testRootDir, 'source_folder', 'move_me.txt');
    const targetFile = path.join(testRootDir, 'target_folder', 'moved_file.txt');
    const nestedTargetFile = path.join(testRootDir, 'new_parent/nested/final_file.txt');

    console.log(`Testing simple move: ${sourceFile} -> ${targetFile}`);
    let result = movePath(sourceFile, targetFile);

    if (result.success && fs.existsSync(targetFile) && !fs.existsSync(sourceFile)) {
        console.log('✅ Simple move passed.');
    } else {
        console.error('❌ Simple move failed:', result.error);
    }

    console.log(`Testing nested move with auto-dir creation: ${targetFile} -> ${nestedTargetFile}`);
    result = movePath(targetFile, nestedTargetFile);

    if (result.success && fs.existsSync(nestedTargetFile) && fs.existsSync(path.dirname(nestedTargetFile))) {
        console.log('✅ Nested move with auto-dir creation passed.');
    } else {
        console.error('❌ Nested move failed:', result.error);
    }

    // Cleanup
    // fs.rmSync(testRootDir, { recursive: true, force: true });
};

runTest();
