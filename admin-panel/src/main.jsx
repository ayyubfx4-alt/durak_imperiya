import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Users from './pages/Users.jsx';
import Rooms from './pages/Rooms.jsx';
import GameHistory from './pages/GameHistory.jsx';
import Economy from './pages/Economy.jsx';
import Stickers from './pages/Stickers.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import Settings from './pages/Settings.jsx';
import Ranking from './pages/Ranking.jsx';
import Messages from './pages/Messages.jsx';
import Telegram from './pages/Telegram.jsx';
import SupportTickets from './pages/SupportTickets.jsx';
import GoldCoins from './pages/GoldCoins.jsx';
import Shop from './pages/Shop.jsx';
import Tournaments from './pages/Tournaments.jsx';
import Promotions from './pages/Promotions.jsx';
import Reports from './pages/Reports.jsx';
import Analytics from './pages/Analytics.jsx';
import Security from './pages/Security.jsx';
import Backups from './pages/Backups.jsx';
import Roles from './pages/Roles.jsx';
import Antibot from './pages/Antibot.jsx';
import Audit from './pages/Audit.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { ConfirmProvider } from './components/ConfirmDialog.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<App />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="rooms" element={<Rooms />} />
              <Route path="games" element={<GameHistory />} />
              <Route path="economy" element={<Economy />} />
              <Route path="stickers" element={<Stickers />} />
              <Route path="decks" element={<CatalogPage kind="decks" title="Decklar" itemType="card_skin" />} />
              <Route path="chests" element={<CatalogPage kind="chests" title="Chestlar" itemType="chest" />} />
              <Route path="emoji-packs" element={<CatalogPage kind="emoji-packs" title="Emoji packlar" itemType="emoji_pack" />} />
              <Route path="frames" element={<CatalogPage kind="frames" title="Profil ramkalari" itemType="avatar_frame" />} />
              <Route path="tasks" element={<CatalogPage kind="tasks" title="Task va missiyalar" itemType="task" />} />
              <Route path="ranking" element={<Ranking />} />
              <Route path="messages" element={<Messages />} />
              <Route path="telegram" element={<Telegram />} />
              <Route path="support" element={<SupportTickets />} />
              <Route path="gold" element={<GoldCoins />} />
              <Route path="shop" element={<Shop />} />
              <Route path="tournaments" element={<Tournaments />} />
              <Route path="promotions" element={<Promotions />} />
              <Route path="reports" element={<Reports />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="security" element={<Security />} />
              <Route path="antibot" element={<Antibot />} />
              <Route path="backups" element={<Backups />} />
              <Route path="roles" element={<Roles />} />
              <Route path="settings" element={<Settings />} />
              <Route path="audit" element={<Audit />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>
);
