import { contextBridge, ipcRenderer } from 'electron';

// --- Expose API to Renderer ---
contextBridge.exposeInMainWorld('electronAPI', {
    // Dialogs
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

    // File System
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
    writeBinary: (path: string, data: string) => ipcRenderer.invoke('fs:writeBinary', path, data),
    listFiles: (path: string) => ipcRenderer.invoke('fs:listFiles', path),
    readBinary: (path: string) => ipcRenderer.invoke('fs:readBinary', path),
    ensureDir: (path: string) => ipcRenderer.invoke('fs:ensureDir', path),
    scanDirectory: (path: string) => ipcRenderer.invoke('fs:scanDirectory', path),
    movePath: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:movePath', oldPath, newPath),
    readTextFile: (filePath: string, maxChars?: number) => ipcRenderer.invoke('fs:readTextFile', filePath, maxChars),
    computeHash: (filePath: string) => ipcRenderer.invoke('fs:computeHash', filePath),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
    cleanupTempFiles: (dirPath: string, maxAgeHours?: number) => ipcRenderer.invoke('fs:cleanupTempFiles', dirPath, maxAgeHours),
});
