import { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  MessageSquare,
  Trash2,
  MoreHorizontal,
  FolderPlus,
  Folder,
  LogOut,
  Settings,

  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useChatContext } from '../../contexts/ChatContext';
import {
  subscribeConversations,
  deleteConversation,
  subscribeProjects,
  createProject,
} from '../../services/database';
import { groupConversationsByDate } from '../../utils/helpers';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { currentConversationId, setCurrentConversationId, startNewChat, sidebarOpen, setSidebarOpen } = useChatContext();
  const [conversations, setConversations] = useState([]);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [showProjects, setShowProjects] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeMenu, setActiveMenu] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsub1 = subscribeConversations(user.uid, setConversations);
    const unsub2 = subscribeProjects(user.uid, setProjects);
    return () => { unsub1(); unsub2(); };
  }, [user]);

  const filtered = search
    ? conversations.filter((c) =>
        c.title?.toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  const grouped = groupConversationsByDate(filtered);

  async function handleDelete(convId, e) {
    e.stopPropagation();
    setActiveMenu(null);
    if (user) {
      await deleteConversation(user.uid, convId);
      if (currentConversationId === convId) {
        startNewChat();
      }
    }
  }

  async function handleCreateProject() {
    if (!newProjectName.trim() || !user) return;
    await createProject(user.uid, newProjectName.trim());
    setNewProjectName('');
    setShowNewProject(false);
  }

  if (!sidebarOpen) return null;

  return (
    <div className="w-72 bg-gray-950 border-r border-gray-800 flex flex-col h-full flex-shrink-0">
      {/* Header */}
      <div className="p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/mira-logo.png" alt="MIRA" className="w-8 h-8 rounded-lg object-cover" />
          <span className="font-semibold text-white text-sm">MIRA</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewChat}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
            title="New chat"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition lg:hidden"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 mb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 outline-none focus:border-gray-700 transition"
          />
        </div>
      </div>

      {/* Projects section */}
      <div className="px-3 mb-1">
        <button
          onClick={() => setShowProjects(!showProjects)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-400 transition"
        >
          {showProjects ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={12} />
          Projects
        </button>

        {showProjects && (
          <div className="ml-4 mt-1 space-y-1">
            {projects.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-400 hover:text-gray-200 rounded-lg hover:bg-gray-800 cursor-pointer transition"
              >
                <Folder size={14} />
                <span className="truncate">{p.name}</span>
              </div>
            ))}

            {showNewProject ? (
              <div className="flex items-center gap-1">
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                  placeholder="Project name"
                  autoFocus
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white outline-none focus:border-violet-500"
                />
                <button onClick={handleCreateProject} className="text-violet-400 hover:text-violet-300 p-1">
                  <Plus size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewProject(true)}
                className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-600 hover:text-gray-400 transition"
              >
                <FolderPlus size={12} />
                New project
              </button>
            )}
          </div>
        )}
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto px-2 space-y-4">
        {Object.entries(grouped).map(([label, convs]) => (
          <div key={label}>
            <div className="px-2 py-1 text-xs font-medium text-gray-600 sticky top-0 bg-gray-950">
              {label}
            </div>
            <div className="space-y-0.5">
              {convs.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setCurrentConversationId(conv.id)}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition relative ${
                    currentConversationId === conv.id
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
                  }`}
                >
                  <MessageSquare size={14} className="flex-shrink-0" />
                  <span className="truncate text-sm flex-1">{conv.title || 'New Chat'}</span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenu(activeMenu === conv.id ? null : conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-700 rounded transition"
                  >
                    <MoreHorizontal size={14} />
                  </button>

                  {activeMenu === conv.id && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px]">
                      <button
                        onClick={(e) => handleDelete(conv.id, e)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="px-3 py-8 text-center text-gray-600 text-sm">
            {search ? 'No chats found' : 'No conversations yet'}
          </div>
        )}
      </div>

      {/* User section */}
      <div className="p-3 border-t border-gray-800 relative">
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="flex items-center gap-3 w-full px-2 py-2 rounded-lg hover:bg-gray-800 transition"
        >
          <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
            {user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-sm text-white truncate">
              {user?.displayName || 'User'}
            </div>
            <div className="text-xs text-gray-500 truncate">{user?.email}</div>
          </div>
        </button>

        {showUserMenu && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-50">
            <button
              onClick={() => {
                setShowUserMenu(false);
                logout();
              }}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
