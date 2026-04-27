export function buildAnnotatedFilename(filename?: string) {
  const basename = filename?.trim().split(/[\\/]/).pop() || 'plot-preview.png';
  const normalized = basename.replace(/\.[a-z0-9]+$/i, '');
  return `${normalized}-annotated.png`;
}

export function summarizeImageSource(source: string) {
  if (source.startsWith('data:')) {
    const commaIndex = source.indexOf(',')
    return {
      kind: 'data-url',
      mediaType: commaIndex > 0 ? source.slice(5, commaIndex).split(';')[0] : 'unknown',
      length: source.length,
    }
  }

  return source.length > 180 ? `${source.slice(0, 177)}...` : source
}
