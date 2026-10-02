import { Route, Routes } from 'react-router-dom'
import { ChatDock } from './components/chat/ChatDock'
import { AppLayout } from './components/layout/AppLayout'
import { ToastHost } from './components/ui/ToastHost'
import { ChapterPage } from './pages/ChapterPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/learn/:chapterId" element={<ChapterPage />} />
          <Route path="/learn/:chapterId/:topicId" element={<ChapterPage />} />
          <Route path="/learn/:chapterId/:topicId/assistant" element={<ChapterPage assistantMode />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <ChatDock />
      <ToastHost />
    </>
  )
}
