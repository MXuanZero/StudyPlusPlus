import { useState } from 'react'
import type { ProgressStatus } from '../../api/progress'
import { useProgressStore } from '../../store/progressStore'

const OPTIONS: { value: ProgressStatus; label: string }[] = [
  { value: 'not_started', label: '未开始' },
  { value: 'learning', label: '学习中' },
  { value: 'completed', label: '已完成' },
]

interface ProgressControlProps {
  topicId: string
  onChanged?: (status: ProgressStatus) => void
}

/** 知识点学习状态控件，写入后端并同步到目录树。 */
export function ProgressControl({ topicId, onChanged }: ProgressControlProps) {
  const status = useProgressStore((state) => state.items[topicId]?.status ?? 'not_started')
  const setStatus = useProgressStore((state) => state.setStatus)
  const [saving, setSaving] = useState(false)

  const change = async (next: ProgressStatus) => {
    if (next === status || saving) return
    setSaving(true)
    try {
      await setStatus(topicId, next)
      onChanged?.(next)
    } catch {
      /* store 已提示错误并回滚 */
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="segmented status-segmented" role="group" aria-label="学习状态" aria-busy={saving}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          data-status={option.value}
          className={option.value === status ? 'active' : ''}
          disabled={saving}
          onClick={() => void change(option.value)}
        >
          <span className="status-dot" />
          {option.label}
        </button>
      ))}
    </div>
  )
}
