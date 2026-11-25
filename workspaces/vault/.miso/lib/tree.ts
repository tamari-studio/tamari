// The vault's note paths as a folder tree, for the Vault view.
export interface FolderNode {
  name: string
  path: string
  notes: string[]
  folders: FolderNode[]
}

export function buildTree(paths: string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', notes: [], folders: [] }
  for (const path of [...paths].sort()) {
    const parts = path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join('/')
      let next = node.folders.find(f => f.path === folderPath)
      if (!next) node.folders.push((next = { name: parts[i], path: folderPath, notes: [], folders: [] }))
      node = next
    }
    node.notes.push(path)
  }
  return root
}

export function countNotes(node: FolderNode): number {
  return node.notes.length + node.folders.reduce((sum, f) => sum + countNotes(f), 0)
}
