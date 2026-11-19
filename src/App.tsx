import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppStore';
import { UndoProvider } from './store/undoStore';
import { ConfirmProvider, ToastProvider } from './components/UI';
import { StorageNotices } from './components/StorageNotices';
import { BootstrapScreen } from './components/BootstrapScreen';
import { BlockedScreen } from './components/BlockedScreen';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './features/today/DashboardPage';
import { TasksPage } from './features/tasks/TasksPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { HabitsPage } from './features/habits/HabitsPage';
import { AssistantPage } from './features/assistant/AssistantPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { ProjectDetailPage } from './features/projects/ProjectDetailPage';
import { OnboardingWizard } from './features/onboarding/OnboardingWizard';

/** 路由根：数据未就绪时展示启动屏（UI 与初始化逻辑分离）。 */
function AppRoot() {
  const { storage } = useApp();
  // Phase 5.0-a D0：安全阻断（数据版本不兼容 / 读取失败 / IndexedDB 不可用）优先于一切路由渲染
  if (storage.blocked) return <BlockedScreen blocked={storage.blocked} />;
  if (!storage.ready) return <BootstrapScreen />;
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<DashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/habits" element={<HabitsPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
      <OnboardingWizard />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <StorageNotices />
        <ConfirmProvider>
          <AppProvider>
            <UndoProvider>
              <AppRoot />
            </UndoProvider>
          </AppProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
