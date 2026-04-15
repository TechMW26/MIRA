import { Menu } from 'lucide-react';
import { useChatContext } from '../../contexts/ChatContext';
import Sidebar from '../Sidebar/Sidebar';
import ChatWindow from '../Chat/ChatWindow';

export default function MainLayout() {
  const { sidebarOpen, setSidebarOpen } = useChatContext();

  return (
    <div className="flex h-screen bg-gray-900 overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        {!sidebarOpen && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-medium text-gray-300">MIRA</span>
          </div>
        )}

        {/* Chat */}
        <ChatWindow />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
