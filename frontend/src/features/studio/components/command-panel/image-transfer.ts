export function extractImageFilesFromDataTransfer(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) {
    return []
  }

  const items = Array.from(dataTransfer.items ?? [])
  const imageFilesFromItems = items
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))

  if (imageFilesFromItems.length > 0) {
    return imageFilesFromItems
  }

  return Array.from(dataTransfer.files ?? []).filter((file) => file.type.startsWith('image/'))
}
