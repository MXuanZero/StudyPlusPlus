/** 后端章节标题可能已包含“第X章”，避免前端再次拼接造成重复。 */
export function chapterHeading(id: string, title: string): string {
  if (/^第\s*\d+\s*章/.test(title)) return title
  const match = /(\d+)$/.exec(id)
  return match ? `第 ${match[1]} 章 · ${title}` : title
}
