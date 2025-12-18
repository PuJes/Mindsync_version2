import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Global Reference ---
let mainWindow: BrowserWindow | null = null;

// --- Window Creation ---
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'), // Fix: use .mjs
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    const url = process.env.VITE_DEV_SERVER_URL;
    console.log('--- Electron Startup ---');
    console.log('Preload Path:', path.join(__dirname, 'preload.mjs'));
    console.log('Dev Server URL:', url);
    console.log('__dirname:', __dirname);

    if (url) {
        mainWindow.loadURL(url);
        mainWindow.webContents.openDevTools();
    } else {
        // Check if dist/index.html exists
        const indexPath = path.join(__dirname, '../dist/index.html');
        console.log('Loading local file:', indexPath);
        mainWindow.loadFile(indexPath);
    }
}

// --- App Lifecycle ---
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers (Backend Logic) ---

// 1. Open Directory Dialog
ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory', 'createDirectory']
    });
    return result.filePaths[0]; // Returns undefined or path string
});

// 2. Read File
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
        // Security Check: simple check, can be enhanced
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return { success: true, data: content };
    } catch (error: any) {
        console.error('Read File Error:', error);
        return { success: false, error: error.message };
    }
});

// 3. Write File
ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
        await fs.promises.writeFile(filePath, content, 'utf-8');
        return { success: true };
    } catch (error: any) {
        console.error('Write File Error:', error);
        return { success: false, error: error.message };
    }
});

// 4. List Files (Simple scan)
ipcMain.handle('fs:listFiles', async (_event, dirPath: string) => {
    try {
        const files = await fs.promises.readdir(dirPath);
        // Filter to only include files we care about (optional)
        return { success: true, data: files };
    } catch (error: any) {
        console.error('List Files Error:', error);
        return { success: false, error: error.message };
    }
});

// 5. Read Binary (for images/pdf) - Returns Base64
ipcMain.handle('fs:readBinary', async (_event, filePath: string) => {
    try {
        const buffer = await fs.promises.readFile(filePath);
        return { success: true, data: buffer.toString('base64') };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

// 6. Write Binary (for saving uploaded files)
ipcMain.handle('fs:writeBinary', async (_event, filePath: string, base64Data: string) => {
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(filePath, buffer);
        return { success: true };
    } catch (error: any) {
        console.error('Write Binary Error:', error);
        return { success: false, error: error.message };
    }
});

// 7. Ensure Directory Exists (create if not exists)
ipcMain.handle('fs:ensureDir', async (_event, dirPath: string) => {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        return { success: true };
    } catch (error: any) {
        console.error('Ensure Dir Error:', error);
        return { success: false, error: error.message };
    }
});

// 8. Scan Directory Recursively
ipcMain.handle('fs:scanDirectory', async (_event, dirPath: string) => {
    try {
        // Helper to recursively scan
        const scan = async (currentPath: string): Promise<any> => {
            const stats = await fs.promises.stat(currentPath);
            const name = path.basename(currentPath);

            if (stats.isDirectory()) {
                const dirents = await fs.promises.readdir(currentPath, { withFileTypes: true });
                const children = await Promise.all(dirents.map(dirent => {
                    const childPath = path.join(currentPath, dirent.name);
                    // Filter out system files
                    if (dirent.name.startsWith('.') || dirent.name === 'knowledge_index.json') return null;
                    return scan(childPath);
                }));
                const validChildren = children.filter(c => c !== null);
                return { name, path: currentPath, type: 'directory', children: validChildren };
            } else {
                return { name, path: currentPath, type: 'file' };
            }
        };

        const result = await scan(dirPath);
        return { success: true, data: result };
    } catch (error: any) {
        console.error('Scan Directory Error:', error);
        return { success: false, error: error.message };
    }
});

// 9. Move/Rename File or Directory
ipcMain.handle('fs:movePath', async (_event, oldPath: string, newPath: string) => {
    try {
        await fs.promises.rename(oldPath, newPath);
        return { success: true };
    } catch (error: any) {
        console.error('Move Path Error:', error);
        return { success: false, error: error.message };
    }
});

// 10. Read Text File for AI Analysis
ipcMain.handle('fs:readTextFile', async (_event, filePath: string, maxChars: number = 30000) => {
    try {
        const stats = await fs.promises.stat(filePath);
        const ext = path.extname(filePath).toLowerCase();

        // Text-based extensions
        const textExtensions = ['.txt', '.md', '.py', '.js', '.ts', '.tsx', '.json', '.csv', '.sql', '.html', '.css', '.xml', '.yaml', '.yml', '.log', '.ini', '.cfg'];

        if (textExtensions.includes(ext)) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return { success: true, data: content.slice(0, maxChars), isText: true };
        } else {
            // Return metadata for binary files
            return {
                success: true,
                data: `[Binary File] Name: ${path.basename(filePath)}, Size: ${stats.size} bytes, Extension: ${ext}`,
                isText: false
            };
        }
    } catch (error: any) {
        console.error('Read Text File Error:', error);
        return { success: false, error: error.message };
    }
});
