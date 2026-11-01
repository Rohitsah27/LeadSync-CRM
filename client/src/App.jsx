import { Route, Routes } from 'react-router';
import AuthLayout from './layouts/AuthLayout.jsx';
import DashboardLayout from './layouts/DashboardLayout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import FacebookConnections from './pages/FacebookConnections.jsx';
import FacebookPages from './pages/FacebookPages.jsx';
import LeadDetails from './pages/LeadDetails.jsx';
import LeadForms from './pages/LeadForms.jsx';
import Leads from './pages/Leads.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Profile from './pages/Profile.jsx';
import Register from './pages/Register.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
      </Route>

      <Route element={<DashboardLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="connections" element={<FacebookConnections />} />
        <Route path="pages" element={<FacebookPages />} />
        <Route path="forms" element={<LeadForms />} />
        <Route path="leads" element={<Leads />} />
        <Route path="leads/:leadId" element={<LeadDetails />} />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
