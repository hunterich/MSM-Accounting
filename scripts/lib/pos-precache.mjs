/** Follow Rollup's POS dependency graph rather than guessing chunk filenames. */
export function collectPosAssets(bundle) {
  const assets = new Set();
  const visit = (fileName) => {
    if (assets.has(fileName)) return;
    assets.add(fileName);
    const chunk = bundle[fileName];
    if (chunk?.type !== 'chunk') return;
    for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) visit(dependency);
    for (const file of chunk.viteMetadata?.importedCss ?? []) assets.add(file);
    for (const file of chunk.viteMetadata?.importedAssets ?? []) assets.add(file);
  };
  const entry = Object.values(bundle).find(chunk => chunk.type === 'chunk' && chunk.isEntry && chunk.name === 'pos');
  if (!entry) throw new Error('POS entry chunk is missing; cannot build its offline cache.');
  visit(entry.fileName);
  return assets;
}
